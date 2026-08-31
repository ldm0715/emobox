// Phase 16: raw access to clipboard formats beyond decoded RGBA bitmaps via
// the Win32 clipboard API. The tauri clipboard plugin only exposes
// `read_image` (decoded RGBA), which destroys GIF animation at the first step.
//
// Read side: Firefox places the original GIF bytes under the registered
// "image/gif" format; QQ (and Explorer) place the local file path under
// CF_HDROP — both channels let us recover the animated original.
//
// Write side: WeChat/QQ do NOT consume "image/gif" — they paste animated GIFs
// from the CF_HDROP file-list format (same as Explorer Ctrl+C), so the copy
// path appends both: the raw bytes and a file drop of the managed .gif.
//
// Ownership rules (Win32 contract, load-bearing):
// - `GetClipboardData`: the returned HGLOBAL belongs to the system — never free.
// - `SetClipboardData`: on success the HGLOBAL ownership transfers to the
//   system — never free after a successful call. Only the failure path frees.
//
// All failures degrade silently: readers return `None`, writers return `Err`
// with a short reason, and neither ever panics.

use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock,
};
use windows::Win32::System::Ole::CF_HDROP;
use windows::core::{HSTRING, PCWSTR};

/// OpenClipboard 重试参数：剪贴板是全局互斥资源，可能被其他进程短暂占用。
const OPEN_RETRY_COUNT: usize = 5;
const OPEN_RETRY_INTERVAL_MS: u64 = 10;

/// Drop guard 保证 `CloseClipboard` 在所有路径（含 early return / Err）都执行。
struct ClipboardGuard {
    closed: bool,
}

impl ClipboardGuard {
    /// 打开剪贴板（不带 owner 窗口）。带重试；失败返回最后一次的 Win32 错误。
    fn open() -> Result<Self, windows::core::Error> {
        let mut last_error = None;
        for attempt in 0..OPEN_RETRY_COUNT {
            match unsafe { OpenClipboard(None) } {
                Ok(()) => return Ok(Self { closed: false }),
                Err(error) => {
                    last_error = Some(error);
                }
            }
            if attempt + 1 < OPEN_RETRY_COUNT {
                std::thread::sleep(std::time::Duration::from_millis(OPEN_RETRY_INTERVAL_MS));
            }
        }
        let error = last_error.expect("至少尝试了一次 OpenClipboard");
        log::debug!(
            "[clipboard-raw] OpenClipboard failed after {OPEN_RETRY_COUNT} attempts: {error}"
        );
        Err(error)
    }
}

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        if !self.closed {
            let _ = unsafe { CloseClipboard() };
            self.closed = true;
        }
    }
}

/// 注册（或查到已有的）自定义剪贴板格式 id。返回 0 视为失败。
fn register_format(format_name: &str) -> Option<u32> {
    let wide = HSTRING::from(format_name);
    let format = unsafe { RegisterClipboardFormatW(PCWSTR(wide.as_ptr())) };
    if format == 0 {
        log::debug!("[clipboard-raw] RegisterClipboardFormatW({format_name}) failed");
        return None;
    }
    Some(format)
}

/// 读注册剪贴板格式（如 "image/gif"）的原始字节。
///
/// 任何失败（剪贴板被占 / 格式不存在 / 锁定失败）都返回 `None` —— 这是
/// 正常路径（如 Chrome 复制 GIF 时不放 image/gif 格式），调用方静默降级，
/// 绝不当错误处理。
pub fn read_registered_format_bytes(format_name: &str) -> Option<Vec<u8>> {
    let format = register_format(format_name)?;
    let _guard = ClipboardGuard::open().ok()?;

    if unsafe { IsClipboardFormatAvailable(format) }.is_err() {
        return None; // 格式不在剪贴板上：最常见的"降级"情形，不记日志。
    }

    // 数据所有权属系统：只拷贝，绝不 GlobalFree。
    let handle = unsafe { GetClipboardData(format) }.ok()?;
    if handle.is_invalid() {
        return None;
    }
    let global = HGLOBAL(handle.0);
    let size = unsafe { GlobalSize(global) };
    if size == 0 {
        return None;
    }
    let pointer = unsafe { GlobalLock(global) };
    if pointer.is_null() {
        log::debug!("[clipboard-raw] GlobalLock failed for format {format_name}");
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), size) }.to_vec();
    let _ = unsafe { GlobalUnlock(global) };
    Some(bytes)
}

/// 读 `CF_HDROP` 文件列表（资源管理器 Ctrl+C / QQ 复制图片时放置）。
///
/// 任何失败（剪贴板被占 / 格式不存在 / 列表为空 / ANSI 列表）→ `None`，
/// 调用方静默降级。**只读路径，绝不写源文件。**
pub fn read_file_drop() -> Option<Vec<std::path::PathBuf>> {
    let _guard = ClipboardGuard::open().ok()?;

    if unsafe { IsClipboardFormatAvailable(CF_HDROP.0 as u32) }.is_err() {
        return None;
    }
    // 数据所有权属系统：只拷贝，绝不 GlobalFree。
    let handle = unsafe { GetClipboardData(CF_HDROP.0 as u32) }.ok()?;
    if handle.is_invalid() {
        return None;
    }
    let global = HGLOBAL(handle.0);
    let size = unsafe { GlobalSize(global) };
    if size == 0 {
        return None;
    }
    let pointer = unsafe { GlobalLock(global) };
    if pointer.is_null() {
        log::debug!("[clipboard-raw] GlobalLock failed for CF_HDROP");
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), size) }.to_vec();
    let _ = unsafe { GlobalUnlock(global) };
    parse_drop_files(&bytes)
}

/// 解析 `DROPFILES`（20 字节头：pFiles / pt / fNC / fWide）+ 双 NUL 结尾的
/// 路径列表。仅支持宽字符（`fWide=1`，QQ / 资源管理器均如此）；ANSI → None。
fn parse_drop_files(bytes: &[u8]) -> Option<Vec<std::path::PathBuf>> {
    if bytes.len() < 20 {
        return None;
    }
    let p_files = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    let f_wide = i32::from_le_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]) != 0;
    if !f_wide || p_files < 20 || p_files >= bytes.len() {
        return None;
    }
    let wide: Vec<u16> = bytes[p_files..]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|chunk| u16::from_le_bytes(*chunk))
        .collect();
    let mut paths: Vec<std::path::PathBuf> = Vec::new();
    let mut current: Vec<u16> = Vec::new();
    for unit in wide {
        if unit == 0 {
            if current.is_empty() {
                break; // 双 NUL：列表结束
            }
            paths.push(std::path::PathBuf::from(String::from_utf16_lossy(&current)));
            current.clear();
        } else {
            current.push(unit);
        }
    }
    if paths.is_empty() {
        return None;
    }
    Some(paths)
}

/// 追加剪贴板格式，**不** `EmptyClipboard` —— 保留其他调用方（剪贴板插件）
/// 刚写入的 DIB/PNG 格式。调用前提：剪贴板插件已完成写入（其内部已
/// CloseClipboard），本函数独立开/关一次剪贴板；多个格式共享同一次打开。
///
/// 成功后 HGLOBAL 所有权转移给系统（不得 free）；失败路径内部 `GlobalFree`
/// 并返回 `Err(reason)`。空字节条目直接拒绝。
pub fn write_registered_format_bytes(format_name: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("写入剪贴板的数据为空".to_string());
    }
    let format =
        register_format(format_name).ok_or_else(|| format!("无法注册剪贴板格式 {format_name}"))?;
    set_formats_bytes(&[(format, bytes)])
}

/// 把文件路径列表写成 `CF_HDROP`（资源管理器 Ctrl+C 的同款格式）。
///
/// 微信 / QQ 粘贴该格式时按**文件**处理 —— GIF 动画由此保真（它们不消费
/// `image/gif` 位图格式）。路径须指向此刻存在的文件。
pub fn write_file_drop(paths: &[std::path::PathBuf]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("文件列表为空".to_string());
    }

    // DROPFILES 头（20 字节）：pFiles=20（文件列表偏移）、pt=(0,0)、fNC=0、
    // fWide=1（宽字符）。列表 = 每个路径 NUL 结尾 + 额外一个 NUL 收尾。
    let mut list: Vec<u16> = Vec::new();
    for path in paths {
        use std::os::windows::ffi::OsStrExt;
        list.extend(path.as_os_str().encode_wide());
        list.push(0);
    }
    list.push(0);

    let mut blob = Vec::with_capacity(20 + list.len() * 2);
    blob.extend_from_slice(&20u32.to_le_bytes()); // pFiles
    blob.extend_from_slice(&0i32.to_le_bytes()); // pt.x
    blob.extend_from_slice(&0i32.to_le_bytes()); // pt.y
    blob.extend_from_slice(&0i32.to_le_bytes()); // fNC
    blob.extend_from_slice(&1i32.to_le_bytes()); // fWide（Unicode）
    for unit in list {
        blob.extend_from_slice(&unit.to_le_bytes());
    }

    set_formats_bytes(&[(CF_HDROP.0 as u32, &blob)])
}

/// 单次剪贴板会话内依次写入多个 `(format, bytes)`，第一个失败即中止。
/// 所有权规则见 `write_registered_format_bytes` 文档。
fn set_formats_bytes(entries: &[(u32, &[u8])]) -> Result<(), String> {
    if entries.is_empty() {
        return Err("没有要写入的剪贴板格式".to_string());
    }
    let _guard = ClipboardGuard::open().map_err(|error| format!("无法打开剪贴板：{error}"))?;

    for (format, bytes) in entries {
        // GMEM_MOVEABLE 是 SetClipboardData 对内存对象的要求。
        let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }
            .map_err(|error| format!("GlobalAlloc 失败：{error}"))?;
        let global = HGLOBAL(handle.0);
        let pointer = unsafe { GlobalLock(global) };
        if pointer.is_null() {
            let _ = unsafe { GlobalFree(Some(global)) };
            return Err("GlobalLock 失败".to_string());
        }
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast::<u8>(), bytes.len()) };
        let _ = unsafe { GlobalUnlock(global) };

        match unsafe { SetClipboardData(*format, Some(HANDLE(global.0))) } {
            // 成功：所有权已转移给系统，绝不能再 free。
            Ok(_) => {}
            Err(error) => {
                let _ = unsafe { GlobalFree(Some(global)) };
                return Err(format!("SetClipboardData(格式 {format}) 失败：{error}"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Win32 剪贴板是全局状态，并行测试 / CI 无桌面会话时会被占或失败，
    /// 因此标记 `#[ignore]`，手动 `cargo test -- --ignored` 验证。
    #[cfg(windows)]
    #[test]
    #[ignore = "touches the real system clipboard; run manually with --ignored"]
    fn registered_format_write_read_roundtrip() {
        let payload: Vec<u8> = b"GIF89a-fake-payload-for-roundtrip".to_vec();
        write_registered_format_bytes("image/emobox-test", &payload).expect("write should succeed");

        let read = read_registered_format_bytes("image/emobox-test");
        assert_eq!(read, Some(payload));

        // 未知格式读不到。
        assert!(read_registered_format_bytes("image/emobox-missing").is_none());

        // 空字节被拒绝。
        assert!(write_registered_format_bytes("image/emobox-test", &[]).is_err());
    }

    /// CF_HDROP 写入后可用 PowerShell `Get-Clipboard -Format FileDropList`
    /// 人工验证；这里只断言写入本身成功（读取需要 Shell API，不为测试加 feature）。
    #[cfg(windows)]
    #[test]
    #[ignore = "touches the real system clipboard; run manually with --ignored"]
    fn file_drop_write_succeeds() {
        let temp = std::env::temp_dir().join("emobox-cbraw-filedrop-probe.gif");
        std::fs::write(&temp, b"GIF89a-probe").expect("write probe file");
        write_file_drop(&[temp.clone()]).expect("file drop should succeed");
        // 写入后能自己读回来（read_file_drop 与 write_file_drop 闭环）。
        let read = read_file_drop();
        assert!(
            read.as_ref().is_some_and(|paths| paths.contains(&temp)),
            "read_file_drop 应读到刚写入的路径：{read:?}"
        );
        let _ = std::fs::remove_file(temp);
    }

    fn dropfiles_blob(paths: &[&str], f_wide: bool) -> Vec<u8> {
        let mut blob = Vec::new();
        blob.extend_from_slice(&20u32.to_le_bytes()); // pFiles
        blob.extend_from_slice(&0i32.to_le_bytes()); // pt.x
        blob.extend_from_slice(&0i32.to_le_bytes()); // pt.y
        blob.extend_from_slice(&0i32.to_le_bytes()); // fNC
        blob.extend_from_slice(&(f_wide as i32).to_le_bytes()); // fWide
        for path in paths {
            if f_wide {
                for unit in path.encode_utf16() {
                    blob.extend_from_slice(&unit.to_le_bytes());
                }
                blob.extend_from_slice(&0u16.to_le_bytes());
            } else {
                blob.extend_from_slice(path.as_bytes());
                blob.push(0);
            }
        }
        blob.extend_from_slice(&0u16.to_le_bytes()); // 列表结尾的额外 NUL
        blob
    }

    #[test]
    fn parse_drop_files_reads_wide_list() {
        let blob = dropfiles_blob(&[r"C:\a\开心.gif", r"C:\b\second.gif"], true);
        let parsed = parse_drop_files(&blob).expect("wide list should parse");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].to_string_lossy(), r"C:\a\开心.gif");
        assert_eq!(parsed[1].to_string_lossy(), r"C:\b\second.gif");
    }

    #[test]
    fn parse_drop_files_rejects_ansi_and_malformed() {
        // ANSI（fWide=0）不支持 → None。
        let ansi = dropfiles_blob(&[r"C:\a\x.gif"], false);
        assert!(parse_drop_files(&ansi).is_none());
        // 头不足 20 字节 / 只有头没有列表 / pFiles 越界 → None。
        assert!(parse_drop_files(&[0u8; 8]).is_none());
        assert!(parse_drop_files(&dropfiles_blob(&[], true)).is_none());
        let mut bad_offset = dropfiles_blob(&[r"C:\a.gif"], true);
        bad_offset[0..4].copy_from_slice(&99u32.to_le_bytes());
        assert!(parse_drop_files(&bad_offset).is_none());
    }
}
