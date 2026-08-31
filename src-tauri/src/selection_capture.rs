// Phase 15: capture the text selected in the foreground window and use it
// as the quick-search overlay's seed query.
//
// 两级策略（均为**剪切**语义 —— 选中文字在取词时即从输入框删除，表情
// 粘贴时正好落在原文字位置，实现"选中→换表情"的替换意图）：
//   1. UIA TextPattern（`platform::windows::selection_reader`）—— 非侵入
//      读取选区，读到后补一个 Ctrl+X 删掉选区。
//   2. Ctrl+X 剪贴板兜底 —— 合成 Ctrl+X 一次完成"取词 + 删除"，读剪贴板
//      文字作为 seed。剪贴板保留剪切文字（用户放弃选表情时可手动 Ctrl+V
//      找回）。只在开关开启时运行。
//
// 关于合成按键时用户仍按着 Ctrl+Alt（快捷键是 Ctrl+Alt+Space）：
// 必须先等修饰键物理松开（`wait_for_modifiers_released`）—— 否则应用收到
// Ctrl+Alt+X（不是剪切），若 Ctrl 在序列中途松开更会收到裸 X，按键字符
// 替换选区、误删文字（真机复现过）。个别应用对 Ctrl+X 有自定义行为是
// 已知代价，由「选中文字自动搜索」开关控制（关闭后完全不动剪贴板与输入框）。
//
// 隐私边界（有意突破 Phase 7 的「不读取聊天内容」）：只读取当前选区、
// 只存在于内存、绝不持久化，仅作为搜索词传递给浮层。

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// 选中文字截断上限（字符数）——搜索词不需要更长。
pub const SELECTION_MAX_CHARS: usize = 40;

/// 「选中文字自动搜索」开关的 Rust 侧镜像。前端（localStorage 事实源）在
/// 启动和变更时经 `set_selection_search_enabled` 命令推送。默认 true 与
/// 前端默认一致；应用刚启动、前端尚未推送时按默认执行。
#[derive(Default)]
pub struct SelectionSearchState {
    enabled: Mutex<bool>,
    explicitly_set: Mutex<bool>,
}

impl SelectionSearchState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enabled(&self) -> bool {
        let Ok(explicit) = self.explicitly_set.lock() else {
            return true;
        };
        if !*explicit {
            return true;
        }
        if let Ok(value) = self.enabled.lock() {
            return *value;
        }
        true
    }

    pub fn set_enabled(&self, value: bool) {
        if let Ok(mut slot) = self.enabled.lock() {
            *slot = value;
        }
        if let Ok(mut flag) = self.explicitly_set.lock() {
            *flag = true;
        }
    }
}

/// 读取前台窗口选中的文字（sanitize 后）。非 Windows / 开关关闭 / 任何
/// 失败路径都返回 `None` —— 浮层以空 query 正常打开，绝不阻塞浮层显示。
pub fn capture_selected_text<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let enabled = match app.try_state::<SelectionSearchState>() {
        Some(state) => state.enabled(),
        None => true,
    };
    if !enabled {
        log::debug!("[selection] 选中文字自动搜索已关闭，跳过读取");
        return None;
    }

    #[cfg(windows)]
    {
        // 1) 非侵入的 UIA 通道：读到选区后补一个 Ctrl+X 删除它（替换语义）。
        if let Some(text) = crate::platform::windows::selection_reader::read_selection_uia() {
            log::debug!(
                "[selection] UIA 读取选区成功（{} 字符）",
                text.chars().count()
            );
            cut_selection();
            return sanitize_selection(&text);
        }
        log::debug!("[selection] UIA 未读到选区，走 Ctrl+X 兜底");
        ctrl_x_fallback(app)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        None
    }
}

/// 合成 Ctrl+X 删除当前选区（替换语义）。剪切失败仅 log —— seed 已经
/// 拿到，删除是尽力而为；等修饰键松开与超时放弃的逻辑同兜底路径。
#[cfg(windows)]
fn cut_selection() {
    if !crate::platform::windows::input_simulation::wait_for_modifiers_released(
        Duration::from_millis(600),
    ) {
        log::debug!("[selection] 修饰键 600ms 内未松开，跳过选区删除");
        return;
    }
    let sent = unsafe { crate::platform::windows::input_simulation::send_ctrl_x() };
    if sent == 0 {
        log::debug!("[selection] Ctrl+X 输入被拒绝，选区未删除");
    }
}

/// Ctrl+X 兜底：等修饰键松开 → 合成 Ctrl+X（取词 + 删除一步完成）→
/// 轮询剪贴板文字变化。读到与快照相同或为空 → 判定"无选中"（剪贴板没被
/// 动过，无需恢复）。成功则**保留**剪贴板里的剪切文字 —— 用户放弃选表情
/// 时可手动 Ctrl+V 找回（原剪贴板内容此时被替换，是替换语义的已知代价）。
#[cfg(windows)]
fn ctrl_x_fallback<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let clipboard = app.clipboard();

    // 快照只用于变化检测（无选中时 Ctrl+X 不动剪贴板）。
    let snapshot_text: Option<String> = clipboard.read_text().ok();

    // 等用户物理松开修饰键再发 Ctrl+X。快捷键触发时 Ctrl/Alt 往往还按着：
    // 不等的话应用收到的是 Ctrl+Alt+X（不是剪切），若 Ctrl 在序列中途
    // 松开更会收到裸 X —— 按键字符直接替换选区，误删用户文字。
    // 超时宁可放弃兜底（浮层空 query 打开），也不冒误删的风险。
    if !crate::platform::windows::input_simulation::wait_for_modifiers_released(
        Duration::from_millis(600),
    ) {
        log::debug!("[selection] 修饰键 600ms 内未松开，放弃 Ctrl+X 兜底");
        return None;
    }

    let sent = unsafe { crate::platform::windows::input_simulation::send_ctrl_x() };
    if sent == 0 {
        log::debug!("[selection] Ctrl+X 输入被拒绝，放弃兜底");
        return None;
    }

    // 轮询剪贴板变化，最多 ~300ms。剪贴板文字与快照不同且非空 → 有选中。
    let mut cut: Option<String> = None;
    for _ in 0..6 {
        std::thread::sleep(Duration::from_millis(50));
        if let Ok(text) = clipboard.read_text()
            && !text.trim().is_empty()
            && snapshot_text.as_deref() != Some(text.as_str())
        {
            cut = Some(text);
            break;
        }
    }

    let Some(cut) = cut else {
        // 剪贴板未变化 → 无选中（或目标控件只读 / 不支持剪切）。
        log::debug!("[selection] Ctrl+X 后剪贴板无变化，判定无选中");
        return None;
    };

    // 剪切文字留在剪贴板（放弃选择时的找回途径），不恢复原内容。
    log::debug!(
        "[selection] 已剪切选区（{} 字符，保留在剪贴板可手动找回）",
        cut.chars().count()
    );
    sanitize_selection(&cut)
}

/// 清洗选区文字：去首尾空白、把换行/连续空白折叠成单个空格、截断到
/// `SELECTION_MAX_CHARS` 字符（按字符不按字节，CJK 安全）、空 → None。
pub fn sanitize_selection(raw: &str) -> Option<String> {
    let collapsed: Vec<&str> = raw.split_whitespace().collect();
    if collapsed.is_empty() {
        return None;
    }
    let sanitized: String = collapsed
        .join(" ")
        .chars()
        .take(SELECTION_MAX_CHARS)
        .collect();
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_trims_and_collapses_whitespace() {
        assert_eq!(
            sanitize_selection("  哈喽 \n 世界  ").as_deref(),
            Some("哈喽 世界")
        );
        assert_eq!(sanitize_selection("a\tb\nc").as_deref(), Some("a b c"));
    }

    #[test]
    fn sanitize_empty_and_whitespace_only_return_none() {
        assert_eq!(sanitize_selection(""), None);
        assert_eq!(sanitize_selection("   \n\t "), None);
    }

    #[test]
    fn sanitize_truncates_to_max_chars() {
        let long = "字".repeat(SELECTION_MAX_CHARS + 10);
        let result = sanitize_selection(&long).expect("非空选区应有结果");
        assert_eq!(result.chars().count(), SELECTION_MAX_CHARS);
    }

    #[test]
    fn sanitize_truncation_is_cjk_safe() {
        // 按 Unicode 字符截断，不应产生半个字符。
        let long = "表情包大战".repeat(20);
        let result = sanitize_selection(&long).expect("非空选区应有结果");
        let count = result.chars().count();
        assert!(count <= SELECTION_MAX_CHARS);
        assert!(count > 0);
    }

    #[test]
    fn state_defaults_enabled_until_explicitly_set() {
        let state = SelectionSearchState::new();
        assert!(state.enabled());
        state.set_enabled(false);
        assert!(!state.enabled());
        state.set_enabled(true);
        assert!(state.enabled());
    }
}
