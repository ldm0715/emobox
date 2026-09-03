//! Tesseract OCR 引擎（Phase 34）：调用外部 `tesseract` 命令行识别。
//!
//! Tesseract 是用户自行安装的第三方本地 OCR（Windows 安装包由 UB-Mannheim
//! 维护）。EmoBox 不内嵌它，只负责：定位可执行文件 → 把统一管线的 PNG 字节
//! 写临时文件 → `tesseract <input> stdout -l <langs> --psm N` → 读 stdout。
//!
//! 语言策略：不从设置里让用户填语言，而是探测已安装语言（`--list-langs`）
//! 后按 `chi_sim` + `eng` 的优先级求交——表情包场景中文为主、英文兜底；
//! 都没有就报错引导安装语言包。探测结果缓存在进程内（键 = 自定义路径），
//! 设置页的能力探测（`probe`）会刷新缓存，避免每张图都多 spawn 一次进程。

use std::ffi::OsStr;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::process::Stdio;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use std::time::Instant;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

/// 单张识别超时：Tesseract 首次加载语言模型可能要数秒，放宽到 30 秒。
const PROCESS_TIMEOUT: Duration = Duration::from_secs(30);
/// 子进程轮询间隔。
const POLL_INTERVAL: Duration = Duration::from_millis(50);
/// 页面分割模式：6 = 假定整图是单一均匀文本块。表情图多为少量短句直接铺
/// 在画面上，跳过 Tesseract 的版面分析（默认 psm 3）在小图上更稳。
const PSM: &str = "6";
/// 期望语言按优先级排列，与已安装语言求交后以 `+` 连接（Tesseract 多语言语法）。
const PREFERRED_LANGUAGES: [&str; 2] = ["chi_sim", "eng"];

#[cfg(windows)]
const EXE_NAME: &str = "tesseract.exe";
#[cfg(not(windows))]
const EXE_NAME: &str = "tesseract";

// ---------- 可执行文件定位 ----------

/// 依次尝试：设置里的自定义路径（存在才用，允许填安装目录）→ 常见安装
/// 位置 → PATH 逐目录查找。
pub fn resolve_exe(custom_path: &str) -> Option<PathBuf> {
    normalize_custom(custom_path)
        .filter(|path| is_executable_file(path))
        .or_else(|| {
            common_install_paths()
                .into_iter()
                .find(|path| is_executable_file(path))
        })
        .or_else(search_path_env)
}

/// 自定义路径归一化：空串视为未配置；目录则补上可执行文件名。
fn normalize_custom(custom_path: &str) -> Option<PathBuf> {
    let trimmed = custom_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    Some(if path.is_dir() {
        path.join(EXE_NAME)
    } else {
        path
    })
}

/// UB-Mannheim 安装器的常见位置（x64 默认 Program Files，x86 与每用户安装兜底）。
fn common_install_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = std::env::var_os(key) {
            candidates.push(PathBuf::from(base).join("Tesseract-OCR").join(EXE_NAME));
        }
    }
    if let Some(base) = std::env::var_os("LocalAppData") {
        candidates.push(
            PathBuf::from(base)
                .join("Programs")
                .join("Tesseract-OCR")
                .join(EXE_NAME),
        );
    }
    candidates
}

fn search_path_env() -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    std::env::split_paths(&path_var)
        .map(|dir| dir.join(EXE_NAME))
        .find(|path| is_executable_file(path))
}

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

// ---------- 子进程执行 ----------

struct ProgramOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

impl ProgramOutput {
    /// Tesseract 的 `--version` / `--list-langs` 在不同构建里输出到 stdout
    /// 或 stderr 不一，探测类调用合并两路再解析。
    fn combined(&self) -> String {
        format!("{}{}", self.stdout, self.stderr)
    }
}

/// 运行 tesseract 并等待退出。stdout/stderr 走管道且不边跑边读——单张识别
/// 文本与版本信息均远小于管道缓冲区，不会撑爆；超时后 kill 并报错。
fn run_tesseract(exe: &Path, args: &[&OsStr]) -> Result<ProgramOutput, String> {
    let mut child = Command::new(exe)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 Tesseract（{}）：{error}", exe.display()))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if started.elapsed() >= PROCESS_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "Tesseract 执行超时（{} 秒）",
                        PROCESS_TIMEOUT.as_secs()
                    ));
                }
                thread::sleep(POLL_INTERVAL);
            }
            Err(error) => return Err(format!("等待 Tesseract 退出失败：{error}")),
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("读取 Tesseract 输出失败：{error}"))?;
    Ok(ProgramOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

// ---------- 探测与缓存 ----------

/// 设置页能力探测结果。
pub struct TesseractProbe {
    pub available: bool,
    pub exe_path: Option<PathBuf>,
    pub version: Option<String>,
    pub languages: Vec<String>,
}

#[derive(Clone)]
struct ResolutionCache {
    /// 缓存键 = 配置里的自定义路径原值（空串 = 自动检测），路径配置变了缓存失效。
    custom_path: String,
    exe_path: PathBuf,
    languages: Vec<String>,
}

static RESOLUTION_CACHE: Mutex<Option<ResolutionCache>> = Mutex::new(None);

fn update_resolution_cache(custom_path: &str, exe_path: PathBuf, languages: &[String]) {
    let mut cache = RESOLUTION_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cache = Some(ResolutionCache {
        custom_path: custom_path.to_string(),
        exe_path,
        languages: languages.to_vec(),
    });
}

fn cached_resolution(custom_path: &str) -> Option<(PathBuf, Vec<String>)> {
    let cache = RESOLUTION_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = cache.as_ref()?;
    (entry.custom_path == custom_path).then(|| (entry.exe_path.clone(), entry.languages.clone()))
}

/// 探测本机 Tesseract：定位可执行文件 → `--version` → `--list-langs`。
/// 探测成功会刷新运行期缓存。
pub fn probe(custom_path: &str) -> TesseractProbe {
    let Some(exe_path) = resolve_exe(custom_path) else {
        return TesseractProbe {
            available: false,
            exe_path: None,
            version: None,
            languages: Vec::new(),
        };
    };
    let version = run_tesseract(&exe_path, &[OsStr::new("--version")])
        .ok()
        .and_then(|output| parse_version_line(&output.combined()));
    let languages = run_tesseract(&exe_path, &[OsStr::new("--list-langs")])
        .map(|output| parse_list_languages(&output.combined()))
        .unwrap_or_default();
    let available = version.is_some() || !languages.is_empty();
    if available {
        update_resolution_cache(custom_path, exe_path.clone(), &languages);
    }
    TesseractProbe {
        available,
        exe_path: Some(exe_path),
        version,
        languages,
    }
}

/// 识别前的运行期解析：优先读缓存（省一次 `--list-langs` spawn）；缓存里
/// 没有可用语言（如用户刚装语言包）时重新探测。
fn resolve_runtime(custom_path: &str) -> Result<(PathBuf, String), String> {
    if let Some((exe_path, languages)) = cached_resolution(custom_path)
        && let Some(languages_arg) = pick_languages(&languages)
    {
        return Ok((exe_path, languages_arg));
    }
    let probed = probe(custom_path);
    let Some(exe_path) = probed.exe_path else {
        return Err(
            "未检测到 Tesseract：请先安装（Windows 安装包见设置里的下载页），\
             或在设置中填写 tesseract.exe 完整路径"
                .to_string(),
        );
    };
    let installed = if probed.languages.is_empty() {
        "无".to_string()
    } else {
        probed.languages.join("、")
    };
    let languages_arg = pick_languages(&probed.languages).ok_or_else(|| {
        format!(
            "Tesseract 未安装中文/英文语言包（chi_sim/eng），当前可用：{installed}。\
             请重新运行安装程序勾选语言数据，或将对应 traineddata 复制到其 tessdata 目录"
        )
    })?;
    Ok((exe_path, languages_arg))
}

// ---------- 识别 ----------

/// 识别一张 PNG 图片，返回按行的识别文本。与 Windows / AI Studio 引擎同一
/// 契约：PNG 字节进、行文本出、错误为中文 String。
pub fn recognize_lines(custom_path: &str, png_bytes: &[u8]) -> Result<Vec<String>, String> {
    let (exe_path, languages_arg) = resolve_runtime(custom_path)?;
    let input_path = write_temp_png(png_bytes)?;
    let result = run_tesseract(
        &exe_path,
        &[
            input_path.as_os_str(),
            OsStr::new("stdout"),
            OsStr::new("-l"),
            OsStr::new(languages_arg.as_str()),
            OsStr::new("--psm"),
            OsStr::new(PSM),
        ],
    );
    // 无论成败都清理临时文件。
    let _ = std::fs::remove_file(&input_path);
    let output = result?;
    if !output.success {
        let detail = output
            .stderr
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("无错误输出");
        return Err(format!("Tesseract 识别失败：{detail}"));
    }
    Ok(split_lines(&output.stdout))
}

fn write_temp_png(png_bytes: &[u8]) -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    // OCR_LOCK 串行化所有批次，纳秒名不会冲突。
    let path = std::env::temp_dir().join(format!("emobox-ocr-{nanos}.png"));
    std::fs::write(&path, png_bytes).map_err(|error| format!("写入 OCR 临时文件失败：{error}"))?;
    Ok(path)
}

// ---------- 纯函数（单测锁定契约） ----------

/// 从已安装语言里挑识别语言：`chi_sim+eng` > 仅 chi_sim > 仅 eng > None。
pub fn pick_languages(installed: &[String]) -> Option<String> {
    let picked: Vec<&str> = PREFERRED_LANGUAGES
        .iter()
        .copied()
        .filter(|want| installed.iter().any(|have| have.eq_ignore_ascii_case(want)))
        .collect();
    if picked.is_empty() {
        None
    } else {
        Some(picked.join("+"))
    }
}

/// 解析 `--list-langs` 输出：跳过首行说明，其余非空行即语言名。
fn parse_list_languages(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("List of available languages"))
        .map(str::to_string)
        .collect()
}

/// 从 `--version` 输出提取版本行（如 `tesseract v5.3.3.20240503`）。
fn parse_version_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && line.to_ascii_lowercase().contains("tesseract"))
        .or_else(|| text.lines().map(str::trim).find(|line| !line.is_empty()))
        .map(str::to_string)
}

/// 识别 stdout 按行切分，去掉空行与行尾空白。
fn split_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_tag_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("emobox-tess-{tag}-{nanos}"));
        std::fs::create_dir_all(&path).expect("mkdir");
        path
    }

    #[test]
    fn pick_languages_prefers_chinese_plus_english() {
        let installed = vec!["osd".to_string(), "eng".to_string(), "chi_sim".to_string()];
        assert_eq!(pick_languages(&installed), Some("chi_sim+eng".to_string()));
    }

    #[test]
    fn pick_languages_falls_back_to_single_language() {
        assert_eq!(
            pick_languages(&["chi_sim".to_string()]),
            Some("chi_sim".to_string())
        );
        assert_eq!(
            pick_languages(&["eng".to_string()]),
            Some("eng".to_string())
        );
    }

    #[test]
    fn pick_languages_none_without_preferred_packs() {
        let installed = vec!["osd".to_string(), "fra".to_string()];
        assert_eq!(pick_languages(&installed), None);
        assert_eq!(pick_languages(&[]), None);
    }

    #[test]
    fn parses_list_languages_output() {
        let text = "List of available languages (3):\neng\nosd\nchi_sim\n";
        assert_eq!(
            parse_list_languages(text),
            vec!["eng".to_string(), "osd".to_string(), "chi_sim".to_string()]
        );
        assert!(parse_list_languages("").is_empty());
    }

    #[test]
    fn parses_version_line_preferring_tesseract_line() {
        let text = "tesseract v5.3.3.20240503\n leptonica-1.83.1\n";
        assert_eq!(
            parse_version_line(text),
            Some("tesseract v5.3.3.20240503".to_string())
        );
        assert_eq!(parse_version_line("\n \n"), None);
    }

    #[test]
    fn split_lines_trims_and_drops_empties() {
        let text = "第一行\r\n  第二行  \n\n\n第三行\n";
        assert_eq!(
            split_lines(text),
            vec![
                "第一行".to_string(),
                "第二行".to_string(),
                "第三行".to_string()
            ]
        );
    }

    #[test]
    fn custom_path_resolves_existing_file_and_directory() {
        let dir = temp_tag_dir("custom");
        let exe = dir.join(EXE_NAME);
        std::fs::write(&exe, b"stub").expect("write stub");

        // 指到文件本身。
        let as_file = resolve_exe(exe.to_str().expect("utf8"));
        assert_eq!(as_file.as_deref(), Some(exe.as_path()));
        // 指到安装目录则补上可执行文件名。
        let as_dir = resolve_exe(dir.to_str().expect("utf8"));
        assert_eq!(as_dir.as_deref(), Some(exe.as_path()));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_custom_path_falls_back_to_auto_detection() {
        // 不断言结果（开发机可能装/没装），只验证不 panic 且与直接自动检测一致。
        assert_eq!(resolve_exe(""), resolve_exe("   "));
    }
}
