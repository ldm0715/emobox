//! 系统托盘。右键弹出的是自绘 Fluent 菜单窗口（`tray-menu`），原生 Win32
//! 菜单无法自定义样式（字体/尺寸/配色全是系统级控件）；左键直接打开主窗口。

use serde::Deserialize;
use tauri::{
    App, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Rect, Size,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::quick_search;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const TRAY_MENU_LABEL: &str = "tray-menu";
const TRAY_ID: &str = "main-tray";
const TRAY_MENU_OPENED_EVENT: &str = "tray-menu-opened";
const SETTINGS_OPEN_REQUESTED_EVENT: &str = "settings-open-requested";

/// 托盘菜单窗口的逻辑尺寸与间距（px）。逻辑尺寸须与 tauri.conf.json 的
/// `tray-menu` 窗口一致；弹出时按目标显示器 scale_factor 换算成物理尺寸。
const TRAY_MENU_LOGICAL_WIDTH: f64 = 248.0;
const TRAY_MENU_LOGICAL_HEIGHT: f64 = 162.0;
const TRAY_MENU_GAP: f64 = 8.0;
/// 菜单隐藏后等前台窗口归属尘埃落定的时长（与 Phase 7 粘贴流程的 50ms 同源）。
const FOREGROUND_SETTLE_MS: u64 = 50;

/// 托盘菜单项对应的动作（前端经 `tray_menu_action` 命令传入）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrayMenuAction {
    OpenMain,
    OpenSearch,
    OpenSettings,
    Exit,
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID).tooltip("表情匣 EmoBox");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    if let Err(error) = show_main_window(app) {
                        log::error!("托盘打开主窗口失败：{error}");
                    }
                }
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    rect,
                    ..
                } => {
                    if let Err(error) = show_tray_menu(app, rect) {
                        log::error!("托盘弹出菜单失败：{error}");
                    }
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

/// 在托盘图标上方弹出菜单窗口。右缘对齐图标、底边悬在图标上方，再按图标
/// 所在显示器 clamp（托盘可能在副屏任务栏 / 隐藏图标溢出区 / 高分屏）。
pub fn show_tray_menu(app: &AppHandle, icon_rect: Rect) -> Result<(), String> {
    let window = app
        .get_webview_window(TRAY_MENU_LABEL)
        .ok_or_else(|| "找不到托盘菜单窗口，请重启应用。".to_string())?;

    let (icon_position, icon_size) = rect_in_physical(icon_rect);
    let monitor = monitor_containing(
        app,
        icon_position.x + icon_size.width / 2.0,
        icon_position.y + icon_size.height / 2.0,
    );
    let scale = monitor
        .as_ref()
        .map_or(1.0, |monitor| monitor.scale_factor());

    let width = (TRAY_MENU_LOGICAL_WIDTH * scale).round().max(1.0) as u32;
    let height = (TRAY_MENU_LOGICAL_HEIGHT * scale).round().max(1.0) as u32;

    let mut x = icon_position.x + icon_size.width - f64::from(width);
    let mut y = icon_position.y - f64::from(height) - TRAY_MENU_GAP * scale;
    if let Some(monitor) = &monitor {
        let bounds = monitor.position();
        let size = monitor.size();
        let margin = TRAY_MENU_GAP * scale;
        let min_x = f64::from(bounds.x) + margin;
        let max_x = f64::from(bounds.x + size.width as i32) - f64::from(width) - margin;
        let min_y = f64::from(bounds.y) + margin;
        let max_y = f64::from(bounds.y + size.height as i32) - f64::from(height) - margin;
        x = x.clamp(min_x, max_x.max(min_x));
        y = y.clamp(min_y, max_y.max(min_y));
    }

    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|error| format!("无法设置托盘菜单窗口尺寸：{error}"))?;
    window
        .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
        .map_err(|error| format!("无法定位托盘菜单窗口：{error}"))?;
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        // SetWindowRgn 的圆角裁剪区域不随窗口 resize 自动更新；每次弹出
        // 前按新尺寸/新 DPI 重算，否则角部裁剪与实际窗口错位。
        crate::platform::windows::dwm::apply_rounded_region(hwnd.0 as isize);
    }
    window
        .show()
        .map_err(|error| format!("无法显示托盘菜单窗口：{error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("无法聚焦托盘菜单窗口：{error}"))?;
    app.emit_to(TRAY_MENU_LABEL, TRAY_MENU_OPENED_EVENT, ())
        .map_err(|error| format!("无法激活托盘菜单：{error}"))?;

    Ok(())
}

pub fn hide_tray_menu(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(TRAY_MENU_LABEL)
        .ok_or_else(|| "找不到托盘菜单窗口，请重启应用。".to_string())?;
    window
        .hide()
        .map_err(|error| format!("无法隐藏托盘菜单窗口：{error}"))
}

/// 托盘菜单项动作。统一先藏菜单：alwaysOnTop 弹窗不先隐藏会阻塞后续窗口
/// 聚焦；打开搜索浮层更必须先藏——show_quick_search 的 capture_from_foreground
/// 会把当时的焦点窗口抓成自动粘贴目标，不能抓到托盘菜单自己。
pub fn handle_menu_action(app: &AppHandle, action: TrayMenuAction) -> Result<(), String> {
    if let Err(error) = hide_tray_menu(app) {
        log::warn!("隐藏托盘菜单失败（继续执行动作）：{error}");
    }
    match action {
        TrayMenuAction::OpenMain => show_main_window(app),
        TrayMenuAction::OpenSearch => {
            // 给 Windows 一点时间把焦点还给菜单打开前的窗口，再抓取粘贴目标。
            std::thread::sleep(std::time::Duration::from_millis(FOREGROUND_SETTLE_MS));
            quick_search::show_quick_search(app)
        }
        TrayMenuAction::OpenSettings => {
            show_main_window(app)?;
            app.emit_to(MAIN_WINDOW_LABEL, SETTINGS_OPEN_REQUESTED_EVENT, ())
                .map_err(|error| format!("无法通知主窗口打开设置：{error}"))
        }
        TrayMenuAction::Exit => {
            app.exit(0);
            Ok(())
        }
    }
}

pub fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "找不到主窗口，请重启应用。".to_string())?;
    window
        .unminimize()
        .map_err(|error| format!("无法恢复主窗口：{error}"))?;
    window
        .show()
        .map_err(|error| format!("无法显示主窗口：{error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("无法聚焦主窗口：{error}"))
}

/// 托盘事件的 `Rect` 里 position/size 是 Logical|Physical 枚举（Physical 分支
/// 为整型 i32/u32）；托盘图标坐标实际总是物理像素上报，Logical 分支按 1.0 兜底。
fn rect_in_physical(rect: Rect) -> (PhysicalPosition<f64>, PhysicalSize<f64>) {
    let position = match rect.position {
        Position::Physical(position) => PhysicalPosition::new(position.x as f64, position.y as f64),
        Position::Logical(position) => position.to_physical(1.0),
    };
    let size = match rect.size {
        Size::Physical(size) => PhysicalSize::new(size.width as f64, size.height as f64),
        Size::Logical(size) => size.to_physical(1.0),
    };
    (position, size)
}

fn monitor_containing(app: &AppHandle, x: f64, y: f64) -> Option<tauri::Monitor> {
    app.available_monitors().ok()?.into_iter().find(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        let within_x = x >= f64::from(position.x) && x < f64::from(position.x + size.width as i32);
        let within_y = y >= f64::from(position.y) && y < f64::from(position.y + size.height as i32);
        within_x && within_y
    })
}
