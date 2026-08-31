// Phase 7: synthesise the Ctrl+V keystroke. SendInput is the modern, safe
// replacement for the deprecated keybd_event. We deliberately do NOT send
// VK_RETURN — the user stays in control of whether to send the message.

use std::time::{Duration, Instant};

use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, INPUT, INPUT_KEYBOARD, INPUT_MOUSE, KEYBD_EVENT_FLAGS, KEYBDINPUT,
    KEYEVENTF_KEYUP, MOUSE_EVENT_FLAGS, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE, MOUSEINPUT, SendInput, VIRTUAL_KEY, VK_CONTROL,
    VK_LCONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_V, VK_X,
};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

/// Build the 4-keyboard-event sequence for a single Ctrl+<key> chord
/// (Ctrl down, key down, key up, Ctrl up). Exposed wrappers keep the unit
/// tests able to assert the contents without ever calling `SendInput`.
fn build_ctrl_char_inputs(vk: VIRTUAL_KEY) -> [INPUT; 4] {
    let key_down = |vk: VIRTUAL_KEY| KEYBDINPUT {
        wVk: vk,
        wScan: 0,
        dwFlags: KEYBD_EVENT_FLAGS(0),
        time: 0,
        dwExtraInfo: 0,
    };
    let key_up = |vk: VIRTUAL_KEY| KEYBDINPUT {
        wVk: vk,
        wScan: 0,
        dwFlags: KEYBD_EVENT_FLAGS(KEYEVENTF_KEYUP.0),
        time: 0,
        dwExtraInfo: 0,
    };
    let mut inputs: [INPUT; 4] = unsafe { std::mem::zeroed() };
    for (input, ki) in inputs.iter_mut().zip([
        key_down(VK_LCONTROL),
        key_down(vk),
        key_up(vk),
        key_up(VK_LCONTROL),
    ]) {
        input.r#type = INPUT_KEYBOARD;
        // Writing a union field is safe; reading is not. We only write.
        input.Anonymous.ki = ki;
    }
    inputs
}

pub fn build_ctrl_v_inputs() -> [INPUT; 4] {
    build_ctrl_char_inputs(VK_V)
}

/// Phase 15 替换语义：剪切选区（取词 + 删除一步完成），表情粘贴时正好
/// 落在原文字位置。
pub fn build_ctrl_x_inputs() -> [INPUT; 4] {
    build_ctrl_char_inputs(VK_X)
}

/// Send a 4-event Ctrl-chord sequence with a short inter-event delay so the
/// target app's message pump has time to register each transition. Bulk
/// SendInput sometimes flattens events so quickly that apps miss the
/// modifier-held state. Returns the number of events the OS actually
/// accepted; less than 4 means the input was rejected.
unsafe fn send_ctrl_chord(inputs: &[INPUT; 4], label: &str) -> u32 {
    let mut total = 0u32;
    for input in inputs {
        let n = unsafe { SendInput(&[*input], std::mem::size_of::<INPUT>() as i32) };
        total += n;
        if n == 0 {
            return total;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    log::info!("[{label}] SendInput accepted {total}/4 events");
    total
}

/// Send the Ctrl+V sequence (auto-paste, Phase 7).
pub unsafe fn send_ctrl_v() -> u32 {
    unsafe { send_ctrl_chord(&build_ctrl_v_inputs(), "auto-paste") }
}

/// Send the Ctrl+X sequence (selection cut, Phase 15 替换语义).
pub unsafe fn send_ctrl_x() -> u32 {
    unsafe { send_ctrl_chord(&build_ctrl_x_inputs(), "selection") }
}

/// Whether any modifier key (Ctrl / Alt / Shift / Win) is currently held
/// down *physically*, per `GetAsyncKeyState`.
fn modifiers_down() -> bool {
    const MODIFIERS: [VIRTUAL_KEY; 5] = [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN];
    MODIFIERS
        .iter()
        .any(|vk| unsafe { GetAsyncKeyState(i32::from(vk.0)) } < 0)
}

/// Poll until all modifier keys are physically released, or `timeout`
/// elapses. Returns `true` when released.
///
/// Phase 15 的 Ctrl+C 选区探测**必须**先等这一步：全局快捷键
/// （Ctrl+Alt+Space）触发时用户几乎必然还按着 Ctrl/Alt —— 此刻合成 C
/// 会变成 Ctrl+Alt+C（不是复制）；更糟的是若 Ctrl 在序列中途被松开，
/// 应用会收到裸按键 C，按输入框默认行为**按键字符会替换当前选区**，
/// 把用户选中的文字误删。
pub fn wait_for_modifiers_released(timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        if !modifiers_down() {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Normalise an absolute screen coordinate into the 0–65535 range that
/// `SendInput` expects when `MOUSEEVENTF_ABSOLUTE` is set. `screen_size` is
/// the total pixels of the relevant axis (`GetSystemMetrics`); `coord` is a
/// physical-pixel screen coordinate.
pub fn normalize_abs(coord: i32, screen_size: i32) -> u32 {
    if screen_size <= 0 {
        return 0;
    }
    // Clamp into the valid screen range first so coordinates from secondary
    // monitors (negative origin) do not produce garbage. 用 `screen_size`
    // 而非 `screen_size - 1`：超出屏幕的坐标应映射到归一化满量程 65535，
    // 而不是最后一个像素的位置（`normalize_abs_center_and_max` 锁定该语义）。
    let c = coord.clamp(0, screen_size);
    (c as u64 * 65_535u64 / screen_size as u64) as u32
}

/// Build the 3-mouse-event sequence that clicks at an absolute screen
/// position: move, left down, left up. Exposed so tests can assert the
/// contents without ever calling `SendInput`.
pub fn build_click_inputs(x: i32, y: i32) -> [INPUT; 3] {
    let screen_w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let screen_h = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    let nx = normalize_abs(x, screen_w);
    let ny = normalize_abs(y, screen_h);

    let mouse_move = MOUSEINPUT {
        dx: nx as i32,
        dy: ny as i32,
        mouseData: 0,
        dwFlags: MOUSE_EVENT_FLAGS(MOUSEEVENTF_MOVE.0 | MOUSEEVENTF_ABSOLUTE.0),
        time: 0,
        dwExtraInfo: 0,
    };
    let mouse_down = MOUSEINPUT {
        dx: nx as i32,
        dy: ny as i32,
        mouseData: 0,
        dwFlags: MOUSEEVENTF_LEFTDOWN,
        time: 0,
        dwExtraInfo: 0,
    };
    let mouse_up = MOUSEINPUT {
        dx: nx as i32,
        dy: ny as i32,
        mouseData: 0,
        dwFlags: MOUSEEVENTF_LEFTUP,
        time: 0,
        dwExtraInfo: 0,
    };

    let mut inputs: [INPUT; 3] = unsafe { std::mem::zeroed() };
    for (input, mi) in inputs.iter_mut().zip([mouse_move, mouse_down, mouse_up]) {
        input.r#type = INPUT_MOUSE;
        // Writing a union field is safe; reading is not. We only write.
        input.Anonymous.mi = mi;
    }
    inputs
}

/// Simulate a real left-button click at an absolute screen position. This is
/// the most reliable way to hand keyboard focus back to an input control that
/// the OS will not restore on its own. Returns the number of events accepted
/// (0 means the input was rejected).
pub unsafe fn click_at(x: i32, y: i32) -> u32 {
    let inputs = build_click_inputs(x, y);
    let mut total = 0u32;
    for input in &inputs {
        let n = unsafe { SendInput(&[*input], std::mem::size_of::<INPUT>() as i32) };
        total += n;
        if n == 0 {
            return total;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_RETURN;

    #[test]
    fn ctrl_v_sequence_has_four_inputs() {
        let inputs = build_ctrl_v_inputs();
        assert_eq!(inputs.len(), 4);
    }

    #[test]
    fn ctrl_v_sequence_does_not_include_enter() {
        let inputs = build_ctrl_v_inputs();
        for input in &inputs {
            assert_eq!(input.r#type, INPUT_KEYBOARD);
            // Reading a union field requires `unsafe`; this is only
            // exercised in tests, never in production code.
            let vk = unsafe { input.Anonymous.ki.wVk };
            assert_ne!(vk, VK_RETURN, "Ctrl+V sequence must not include Enter");
        }
    }

    #[test]
    fn ctrl_v_first_two_are_keydown_last_two_keyup() {
        let inputs = build_ctrl_v_inputs();
        let flags: Vec<u32> = (0..4)
            .map(|i| unsafe { inputs[i].Anonymous.ki.dwFlags.0 })
            .collect();
        assert_eq!(flags, vec![0, 0, KEYEVENTF_KEYUP.0, KEYEVENTF_KEYUP.0]);
    }

    #[test]
    fn ctrl_v_first_is_control_then_v() {
        let inputs = build_ctrl_v_inputs();
        let vk0 = unsafe { inputs[0].Anonymous.ki.wVk };
        let vk1 = unsafe { inputs[1].Anonymous.ki.wVk };
        assert_eq!(vk0, VK_LCONTROL);
        assert_eq!(vk1, VK_V);
    }

    #[test]
    fn ctrl_x_sequence_has_four_inputs_and_is_ctrl_then_x() {
        let inputs = build_ctrl_x_inputs();
        assert_eq!(inputs.len(), 4);
        let vk0 = unsafe { inputs[0].Anonymous.ki.wVk };
        let vk1 = unsafe { inputs[1].Anonymous.ki.wVk };
        assert_eq!(vk0, VK_LCONTROL);
        assert_eq!(vk1, VK_X);
        let flags: Vec<u32> = (0..4)
            .map(|i| unsafe { inputs[i].Anonymous.ki.dwFlags.0 })
            .collect();
        assert_eq!(flags, vec![0, 0, KEYEVENTF_KEYUP.0, KEYEVENTF_KEYUP.0]);
        for input in &inputs {
            let vk = unsafe { input.Anonymous.ki.wVk };
            assert_ne!(vk, VK_RETURN, "Ctrl+X sequence must not include Enter");
        }
    }

    #[test]
    fn normalize_abs_zero_boundary() {
        assert_eq!(normalize_abs(0, 1920), 0);
        assert_eq!(normalize_abs(0, 1080), 0);
    }

    #[test]
    fn normalize_abs_center_and_max() {
        // Center of a 1920-wide screen ≈ 32767/32768 (65535/2 rounded down).
        let center = normalize_abs(960, 1920);
        assert!((center as i64 - 32_767).abs() <= 1, "got {center}");
        // Far edge clamps to full range.
        let max = normalize_abs(9999, 1920);
        assert_eq!(max, 65_535);
        // Negative coordinate clamps to 0.
        assert_eq!(normalize_abs(-100, 1920), 0);
    }

    #[test]
    fn click_sequence_is_three_mouse_events() {
        let inputs = build_click_inputs(100, 100);
        assert_eq!(inputs.len(), 3);
        for input in &inputs {
            assert_eq!(input.r#type, INPUT_MOUSE);
        }
    }

    #[test]
    fn click_sequence_flags_are_move_then_down_then_up() {
        let inputs = build_click_inputs(100, 100);
        let flags: Vec<u32> = (0..3)
            .map(|i| unsafe { inputs[i].Anonymous.mi.dwFlags.0 })
            .collect();
        // MOVE | ABSOLUTE, then LEFTDOWN, then LEFTUP
        assert_eq!(flags[0], MOUSEEVENTF_MOVE.0 | MOUSEEVENTF_ABSOLUTE.0);
        assert_eq!(flags[1], MOUSEEVENTF_LEFTDOWN.0);
        assert_eq!(flags[2], MOUSEEVENTF_LEFTUP.0);
    }

    #[test]
    fn click_sequence_has_no_keyboard_events() {
        let inputs = build_click_inputs(100, 100);
        for input in &inputs {
            assert_ne!(input.r#type, INPUT_KEYBOARD);
        }
    }
}
