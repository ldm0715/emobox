//! DWM 非客户区渲染控制与窗口圆角裁剪。

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DWMNCRP_DISABLED, DWMWA_NCRENDERING_POLICY, DwmSetWindowAttribute,
};
use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, HGDIOBJ, SetWindowRgn};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
use windows::core::Result;

/// 禁止 DWM 为窗口绘制非客户区（含投影）。
///
/// Win10 上透明圆角窗口的 DWM 默认阴影会在圆角外留直角色块
/// （tauri#11321）。`tauri.conf.json` 的 `shadow:false` 与运行时
/// `set_shadow(false)`（tao 的窗口样式标志位）都存在时序不稳的记录；
/// 这里经 `DwmSetWindowAttribute(DWMWA_NCRENDERING_POLICY, DWMNCRP_DISABLED)`
/// 直接禁止 DWM 绘制该窗口的非客户区——属性级设置，幂等，不触发窗口
/// 样式重算或重绘。失败返回 Err，由调用方记日志。
pub fn disable_nc_rendering(hwnd_raw: isize) -> Result<()> {
    let hwnd = HWND(hwnd_raw as *mut _);
    let policy = DWMNCRP_DISABLED;
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_NCRENDERING_POLICY,
            &policy as *const _ as *const core::ffi::c_void,
            std::mem::size_of_val(&policy) as u32,
        )
    }
}

/// 用圆角矩形窗口区域裁剪窗口（OS 级最后兜底）：区域外的任何像素——DWM
/// 残余阴影、WebView2 底边透明残片——都无法绘制。半径取 CSS
/// `borderRadiusXLarge`（8 逻辑像素）的物理等值（8 × DPI / 96）。
/// 浮层固定 680×500、不可调整尺寸，区域一次设置即可。
pub fn apply_rounded_region(hwnd_raw: isize) {
    let hwnd = HWND(hwnd_raw as *mut _);
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return;
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return;
    }
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let radius = ((8 * dpi as i32) / 96).clamp(1, width.min(height) / 2);
    // +1：CreateRoundRectRgn 的右/下边界按不含端点处理。
    let region = unsafe { CreateRoundRectRgn(0, 0, width + 1, height + 1, radius, radius) };
    if unsafe { SetWindowRgn(hwnd, Some(region), true) } == 0 {
        // SetWindowRgn 失败时区域所有权未转移给系统，需自行释放防泄漏。
        let _ = unsafe { DeleteObject(HGDIOBJ(region.0)) };
    }
}
