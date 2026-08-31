//! 共享快捷键注册中心（D5）。
//!
//! 维护 `tauri-plugin-global-shortcut` 的注册状态和 owner 映射，
//! 在多 owner（QuickSearch、ClipboardCollect）之间检测冲突并显式管理状态。
//!
//! 状态机：
//! - `Unknown` — 启动时无法判定；启动清理 `reconcile` 会转 `Synced`
//! - `Synced` — 内存 map 与插件真实注册一致
//! - `RecoveryRequired` — 已知不一致；UI 应显示 banner

use std::{
    collections::HashMap,
    str::FromStr,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutOwner {
    QuickSearch,
    ClipboardCollect,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SetOutcome {
    Unchanged,
    Registered {
        display: String,
    },
    Conflict {
        other_owner: ShortcutOwner,
    },
    Failed {
        reason: String,
        requires_recovery: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutSyncState {
    Synced,
    RecoveryRequired,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRegistrationStatus {
    pub shortcut: Option<String>,
    pub registered: bool,
}

struct RegistryInner {
    state: ShortcutSyncState,
    /// 当前 owner -> display
    current: HashMap<ShortcutOwner, String>,
    /// display -> owner（用于冲突检测）
    by_display: HashMap<String, ShortcutOwner>,
}

impl RegistryInner {
    fn new_unknown() -> Self {
        Self {
            state: ShortcutSyncState::Unknown,
            current: HashMap::new(),
            by_display: HashMap::new(),
        }
    }
}

pub struct ShortcutRegistry {
    inner: Mutex<RegistryInner>,
    in_transition: AtomicBool,
}

impl ShortcutRegistry {
    pub fn initialize() -> Self {
        Self {
            inner: Mutex::new(RegistryInner::new_unknown()),
            in_transition: AtomicBool::new(false),
        }
    }

    pub fn sync_state(&self) -> ShortcutSyncState {
        self.inner
            .lock()
            .map(|i| i.state)
            .unwrap_or(ShortcutSyncState::Unknown)
    }

    pub fn current_display(&self, owner: ShortcutOwner) -> Option<String> {
        self.inner
            .lock()
            .ok()
            .and_then(|i| i.current.get(&owner).cloned())
    }

    #[allow(dead_code)] // 公共 API 预留
    pub fn all_registered(&self) -> HashMap<String, ShortcutOwner> {
        self.inner
            .lock()
            .map(|i| i.by_display.clone())
            .unwrap_or_default()
    }

    /// 启动时调用：unregister_all 然后按内存 state 重新注册。
    /// 启动时 state 是空的（Unknown），所以这一步主要是 unregister 任何残留的
    /// OS 注册（可能来自上一次崩溃或未清理），让 `reconcile` 之后状态由调用方
    /// 重新建立。
    pub fn reconcile<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let manager = app.global_shortcut();
        if let Err(error) = manager.unregister_all() {
            self.set_state(ShortcutSyncState::RecoveryRequired);
            return Err(format!("启动时清理全局快捷键失败：{error}"));
        }
        // 状态变 Synced，调用方会通过 set_shortcut 重新建立 owner 注册
        self.set_state(ShortcutSyncState::Synced);
        Ok(())
    }

    /// 关键流程（D5）。所有"注册/注销"都走这里。
    /// 先注册新，再注销旧；任何中间步骤失败都按规则处理并设置状态。
    pub fn try_set<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        owner: ShortcutOwner,
        display: &str,
    ) -> SetOutcome {
        // 解析 display
        let normalized = match crate::quick_search::normalize_shortcut(display) {
            Ok(text) => text,
            Err(reason) => {
                return SetOutcome::Failed {
                    reason,
                    requires_recovery: false,
                };
            }
        };
        let parser_text = crate::quick_search::shortcut_parser_text(&normalized);
        let parsed = match Shortcut::from_str(&parser_text) {
            Ok(s) => s,
            Err(error) => {
                return SetOutcome::Failed {
                    reason: format!("快捷键格式无效：{error}"),
                    requires_recovery: false,
                };
            }
        };

        let mut inner = match self.inner.lock() {
            Ok(i) => i,
            Err(_) => {
                self.set_state(ShortcutSyncState::Unknown);
                return SetOutcome::Failed {
                    reason: "快捷键状态已被破坏，请重启应用".to_string(),
                    requires_recovery: true,
                };
            }
        };

        // 冲突检测：display 被其他 owner 占用
        if let Some(existing_owner) = inner.by_display.get(&normalized).copied()
            && existing_owner != owner
        {
            return SetOutcome::Conflict {
                other_owner: existing_owner,
            };
        }

        // Unchanged
        if inner.current.get(&owner) == Some(&normalized) {
            return SetOutcome::Unchanged;
        }

        let previous_display = inner.current.get(&owner).cloned();
        let manager = app.global_shortcut();
        self.in_transition.store(true, Ordering::Release);

        // 1. 先注册新
        let app_handle = app.clone();
        let owner_for_handler = owner;
        let register_result = manager.on_shortcut(parsed, move |app, _, event| {
            if event.state() == ShortcutState::Pressed
                && let Err(error) = run_owner_action(&owner_for_handler, app)
            {
                log::error!("全局快捷键 handler 失败：{error}");
            }
            // suppress unused variable warning on app_handle
            let _ = &app_handle;
        });

        if let Err(error) = register_result {
            self.in_transition.store(false, Ordering::Release);
            return SetOutcome::Failed {
                reason: format!(
                    "无法注册快捷键 {normalized}。它可能已被 Windows 或其他应用占用：{error}"
                ),
                requires_recovery: false,
            };
        }

        // 2. 注销旧
        if let Some(ref prev_display) = previous_display {
            let prev_parser = crate::quick_search::shortcut_parser_text(prev_display);
            if let Ok(prev_parsed) = Shortcut::from_str(&prev_parser)
                && let Err(error) = manager.unregister(prev_parsed)
            {
                // 尝试回滚：注销新
                let _ = manager.unregister(parsed);
                self.in_transition.store(false, Ordering::Release);
                self.set_state(ShortcutSyncState::RecoveryRequired);
                return SetOutcome::Failed {
                    reason: format!(
                        "新快捷键已注册，但旧快捷键无法注销，请重启应用或重新录制：{error}"
                    ),
                    requires_recovery: true,
                };
            }
            inner.by_display.remove(prev_display.as_str());
        }

        // 3. 更新状态
        if let Some(prev) = previous_display {
            inner.current.remove_entry(&owner);
            let _ = prev; // already removed by_display above
        }
        inner.current.insert(owner, normalized.clone());
        inner.by_display.insert(normalized.clone(), owner);
        inner.state = ShortcutSyncState::Synced;
        self.in_transition.store(false, Ordering::Release);

        SetOutcome::Registered {
            display: normalized,
        }
    }

    fn set_state(&self, new_state: ShortcutSyncState) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.state = new_state;
        }
    }
}

/// 根据 owner 触发对应动作。
fn run_owner_action<R: Runtime>(owner: &ShortcutOwner, app: &AppHandle<R>) -> Result<(), String> {
    match owner {
        ShortcutOwner::QuickSearch => {
            // 统一走 quick_search::show_quick_search（Phase 15 前这里内联复制
            // 了 show 逻辑且从不捕获粘贴目标 —— 快捷键路径的自动粘贴必然
            // noTarget 降级的既有 bug 由此修复）。
            // 失败不中断快捷键响应。
            if let Err(error) = crate::quick_search::show_quick_search(app) {
                log::warn!("打开快捷搜索浮层失败：{error}");
            }
            Ok(())
        }
        ShortcutOwner::ClipboardCollect => app
            .emit_to("main", "clipboard-collect-requested", ())
            .map(|_| ())
            .map_err(|e| format!("emit 失败：{e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_initializes_as_unknown() {
        let registry = ShortcutRegistry::initialize();
        assert_eq!(registry.sync_state(), ShortcutSyncState::Unknown);
        assert!(
            registry
                .current_display(ShortcutOwner::QuickSearch)
                .is_none()
        );
        assert!(
            registry
                .current_display(ShortcutOwner::ClipboardCollect)
                .is_none()
        );
    }

    #[test]
    fn all_registered_is_empty_initially() {
        let registry = ShortcutRegistry::initialize();
        assert!(registry.all_registered().is_empty());
    }

    /// 以下测试需要真实的 Tauri App，无法在单元测试中跑。
    /// 标记为 ignored，由 Windows 集成测试 `windows__*` 在实机执行。
    #[test]
    #[ignore = "requires real Tauri app + OS shortcut plugin; run on Windows"]
    fn windows__try_set_registers_with_real_plugin() {
        // 占位；实际由集成测试覆盖
    }
}
