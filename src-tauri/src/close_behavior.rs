// Phase 25: main-window close behavior.
//
// 主窗口点击关闭按钮时的行为由这里镜像的设置决定（quick-search 窗口不变，
// 永远隐藏）：
//   * `None`（默认）—— 用户尚未做出选择：保持窗口可见，向 main 发
//     `main-close-requested` 事件，由前端弹「最小化到托盘 / 直接退出」询问窗。
//   * `Some(true)` —— 已记住「最小化到系统托盘」：隐藏窗口，应用驻留托盘。
//   * `Some(false)` —— 已记住「直接退出」：整个应用退出（与托盘「退出」同语义）。
//
// localStorage（`emobox.settings` 的 `closeToTray`）仍是事实源：前端在挂载和
// 变更时经 `set_close_to_tray` 命令推送（同 SelectionSearchState 模式），内存
// 镜像只为了让 `on_window_event` 在不经过 IPC 的前提下即时决定 close 行为。

use std::sync::Mutex;

/// 主窗口关闭行为的 Rust 侧镜像。`None` = 未选择（前端弹询问窗）。
#[derive(Default)]
pub struct CloseBehaviorState {
    minimize_to_tray: Mutex<Option<bool>>,
}

impl CloseBehaviorState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self) -> Option<bool> {
        match self.minimize_to_tray.lock() {
            Ok(slot) => *slot,
            Err(_) => None,
        }
    }

    pub fn set(&self, value: Option<bool>) {
        if let Ok(mut slot) = self.minimize_to_tray.lock() {
            *slot = value;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::CloseBehaviorState;

    #[test]
    fn defaults_to_undecided_and_roundtrips_values() {
        let state = CloseBehaviorState::new();
        assert_eq!(state.get(), None);

        state.set(Some(true));
        assert_eq!(state.get(), Some(true));

        state.set(Some(false));
        assert_eq!(state.get(), Some(false));

        // 回到未选择：下次关闭重新走前端询问弹窗。
        state.set(None);
        assert_eq!(state.get(), None);
    }
}
