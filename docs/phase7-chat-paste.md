# Phase 7：聊天窗口自动粘贴（Chat-window auto-paste）

> **实施状态：部分完成。** 已实现：目标窗口捕获 / 生命周期管理 / 窗口恢复与激活 / 合成 Ctrl+V / 前端设置与调用链 / 失败降级。**未完成**：输入框焦点恢复（`focus_restore.rs`）编译失败，真机自动粘贴尚不生效。详见文末「已知问题」。

---

## 一、功能概述

用户在任意输入窗口（微信 / QQ / 飞书 / 浏览器等）按 `Ctrl+Alt+Space` 打开 EmoBox 搜索浮层，搜索并选择图片后：

1. 先按现有逻辑把图片写入 Windows 剪贴板；
2. 若「自动粘贴」开关开启，恢复打开浮层前的窗口；
3. 发送 `Ctrl+V` 模拟按键；
4. **不发送 Enter，不自动发送消息**；
5. 任意步骤失败都保留剪贴板内容，降级为「已复制，请手动粘贴」；
6. 不识别、不限制具体进程，支持任意可粘贴的前台应用。

**关键产品边界**：
- 「当前光标」指打开浮层前的键盘焦点/输入目标，**不是鼠标位置**。
- 不承诺一定粘贴到聊天输入框，只恢复原窗口并发送 Ctrl+V（**本阶段重点问题**，见下）。
- 不读取聊天内容，不使用 IM 私有协议，不持久化窗口信息。
- 仅 Windows 启用；非 Windows 编译不受影响（`#[cfg(windows)]` 隔离 + `disabled` stub）。

---

## 二、用户拍板的关键决策

| 决策 | 选 | 不选 |
|---|---|---|
| 自动粘贴开关默认值 | **默认开启** | 默认关闭 |
| 目标窗口触发入口 | 全局快捷键 **与** 托盘「打开搜索浮层」都记录 | 仅快捷键 |
| 目标记录时机 | `show_quick_search` 在 `center/show/set_focus` **之前**捕获 | 之后（会被自己抢前台） |
| 目标生命周期 | 按浮层会话管理：每次打开先清空再写入，会话内 `peek` 复用，浮层关闭即清空 | 无限期保留旧 HWND |
| HWND 复用防护 | 激活前重查 `GetWindowThreadProcessId` 对比 PID | 仅 `IsWindow` |
| `AttachThreadInput` | RAII Drop guard 保证所有路径 detach | 手动成对调用 |
| 输入模拟 | `SendInput`（现代 API，分 4 次 × 20ms） | `keybd_event`（deprecated）/ shell 拼接 |
| Enter | **不发送** | —— |
| 进程识别 | 不维护白名单，任意前台窗口 | 只支持聊天软件 |
| 失败降级 | 统一返回可序列化 `PasteResult`（非 `Err`） | 抛错给前端 try/catch |
| 焦点恢复 | UIA 定位输入框 + 模拟点击（**未完成**） | 依赖 Windows 自动恢复控件焦点（已证伪） |

---

## 三、架构与流程

```
[用户在聊天窗口按 Ctrl+Alt+Space]
   ↓
[shortcut_registry::run_owner_action(QuickSearch)]
   ↓
[quick_search::show_quick_search]          ← 关键点：先捕获再 show
   ├── target_window::capture_from_foreground(app)
   │     ├── state.clear()                 ← 清掉上次会话残留
   │     ├── foreground_window::capture()  ← GetForegroundWindow + PID + 标题 + 进程名
   │     ├── 排除 EmoBox 自己的窗口（webview_windows() 比对 HWND）
   │     ├── 排除系统进程（explorer/dwm/winlogon/taskmgr/...）
   │     ├── 写入 TargetWindowState（hwnd, pid, title, process_name, captured_at_ms）
   │     └── 失败 → set(None)，不留旧值
   ├── window.center() / show() / set_focus()
   └── emit("quick-search-opened")
   ↓
[QuickSearchWindow.tsx activate() 加载数据]
   ↓
[用户搜索 → Enter / 点击表情]
   ↓
[copySelectedImage(item)]
   ├── 1. copyImageToClipboard(item.path)         ← 必走，写入剪贴板
   ├── 2. setTimeout(close, 500ms)                ← 浮层总会自动关
   ├── 3. 显示「已复制」toast
   └── 4. 若 autoPaste 开启：
         ├── await hideQuickSearch()              ← 必须先隐藏（浮层 alwaysOnTop 会阻塞 SetForegroundWindow）
         │     └── hide 失败 → 降级 toast，不再尝试 paste
         ├── await 50ms（等窗口隐藏 + 焦点转移）
         └── await pasteToTargetWindow()          ← 调 Rust 端
               ├── state.peek()                   ← 读不消耗，会话内连续选择复用
               ├── ChatPasteService::paste(&target)
               │     ├── 1. validate()            ← HWND 有效 + PID 一致 + 可见
               │     ├── 2. activate()            ← 最小化恢复 + SetForegroundWindow + 前台轮询
               │     ├── 3. restore_input_focus() ← 【未完成】定位并点击输入框
               │     └── 4. send_ctrl_v()         ← SendInput 4 事件
               └── 失败 → state.clear() + 降级 toast
```

---

## 四、目标窗口状态生命周期

`src-tauri/src/target_window.rs` — `TargetWindowState { inner: Mutex<Option<TargetWindowInfo>> }`

| 方法 | 语义 |
|---|---|
| `set(Option<TargetWindowInfo>)` | 无条件替换（捕获时用） |
| `peek() -> Option<...>` | 读不消耗；返回 `None` 若未设置 / 已清空 / 超过 TTL |
| `take() -> Option<...>` | 读 + 清空（结束会话用） |
| `clear()` | 强制清空（防御性） |
| `is_empty() -> bool` | `peek().is_none()` |

**生命周期规则**：
- **每次打开浮层**：`capture_from_foreground` 先 `clear()` 再写入，覆盖旧目标。
- **同一次浮层会话连续选择多个表情**：`paste_to_target_window` 用 `peek()`，成功不消耗 → 第二次选择复用同一目标。
- **粘贴失败**：命令里 `state.clear()`，避免下次选择重试已失效的 HWND。
- **浮层关闭**（Esc / X / 隐藏）：`hide_quick_search` 调用 `state.clear()`，强制结束会话，杜绝跨会话误粘贴。
- **TTL 60 秒**：超时后 `peek`/`take` 返回 `None`。

**HWND 复用防护**：`window_activation::validate` 激活前重新调 `GetWindowThreadProcessId`，当前 PID 必须等于捕获时保存的 PID，否则返回 `PidMismatch`，降级为仅复制。

**排除规则**（`capture_from_foreground`）：
- EmoBox 自己的 `main` / `quick-search` 窗口（`app.webview_windows()` 枚举 HWND 比对）。
- 系统进程：`explorer.exe`、`dwm.exe`、`winlogon.exe`、`csrss.exe`、`lsass.exe`、`services.exe`、`smss.exe`、`taskhostw.exe`、`taskmgr.exe`、`lockapp.exe`（桌面 / 窗口管理器 / 锁屏等不可粘贴目标）。

---

## 五、Win32 平台模块

所有 Windows 专属逻辑集中在 `src-tauri/src/platform/windows/`，父模块 `platform/mod.rs` 用 `#[cfg(windows)]` 隔离，非 Windows 编译不受影响。这是项目首次引入 `unsafe` 与 `windows` crate。

### 5.1 `foreground_window.rs` — 捕获前台窗口

| API | 用途 |
|---|---|
| `GetForegroundWindow` | 取当前前台 HWND |
| `GetWindowThreadProcessId` | 取 PID |
| `GetWindowTextW` | 窗口标题（仅调试 / toast 用，不读内容） |
| `OpenProcess` + `QueryFullProcessImageNameW` | 进程名（仅调试 / toast 用） |

返回 `CapturedWindow { hwnd, pid, title, process_name }`。**不读窗口内容、不截屏、不枚举子窗口、不监听**。

### 5.2 `window_activation.rs` — 校验 + 激活

| API | 用途 |
|---|---|
| `IsWindow` / `IsIconic` / `IsWindowVisible` | 有效性校验 |
| `ShowWindow(SW_RESTORE)` | 恢复最小化窗口 |
| `AttachThreadInput` | 绕过前台焦点锁；**RAII `AttachGuard` Drop 保证 detach** |
| `SetForegroundWindow` | 设为目标窗口前台 |
| `GetForegroundWindow`（轮询） | 确认前台切换，最多 500ms，20ms 间隔 |
| `GetClassNameW` / `GetFocus` | **诊断**：记录激活后焦点控件类名 |

`validate()` 重查 PID 防 HWND 复用；`activate()` 在确认前台后额外 sleep 80ms 让 IM 完成焦点/布局恢复。

### 5.3 `input_simulation.rs` — 合成输入

| API | 用途 |
|---|---|
| `SendInput` | 合成键盘 / 鼠标事件 |

- `send_ctrl_v()`：`VK_LCONTROL` down → `VK_V` down → `VK_V` up → `VK_LCONTROL` up，**分 4 次 SendInput × 20ms 间隔**，避免事件被压平。
- `click_at(x, y)`：3 个 `MOUSEINPUT`（`MOVE+ABSOLUTE` → `LEFTDOWN` → `LEFTUP`），坐标归一化到 0–65535（`MOUSEEVENTF_ABSOLUTE`）。
- **严禁发送 `VK_RETURN`**（单元测试断言）。

### 5.4 `focus_restore.rs` — 输入框焦点恢复 【未完成】

**目的**：激活后主动把焦点设回输入框。Windows 只恢复顶层窗口前台，不恢复控件级焦点。

**设计（编译失败，未运行验证）**：
1. **UIA 路径**：`CoInitializeEx` → `CoCreateInstance(CUIAutomation)` → 构造 `ControlType == Edit (50004)` 条件 → `FindFirst(TreeScope_Subtree)` 找输入框 → `CurrentBoundingRectangle()` 取中心 → `click_at` 模拟点击。
2. **回退路径**：`EnumChildWindows` 找 `Edit` / `RichEdit*` 类 → `GetWindowRect` 中心点击。
3. 都找不到 → 返回 `NotFound`，仍发 Ctrl+V（原行为）。

**编译阻塞**：`VARIANT` 构造在 Rust 2024 下报错 —— `VARIANT` 是 `union → ManuallyDrop<struct> → union` 的多层嵌套，写入字段需显式 `unsafe` + `*` 解引用，当前写法仍有 `E0133`。已确认替代方案：用 `CreateTrueCondition()` + `FindAll` 遍历元素数组逐个检查 `CurrentControlType() == UIA_EditControlTypeId`，**彻底避开 VARIANT 构造**。待修复。

---

## 六、服务编排

`src-tauri/src/services/chat_paste_service.rs`

### 6.1 `PasteResult` 序列化契约

```rust
#[serde(rename_all = "camelCase")]
pub enum PasteKind { Success, ClipboardOnly, Disabled }   // -> "success" / "clipboardOnly" / "disabled"

#[serde(rename_all = "camelCase")]
pub struct PasteResult {
    pub kind: PasteKind,
    pub reason: String,
    pub process_name: Option<String>,   // -> "processName"
    pub message: String,
}
```

**实际返回 JSON 示例**：

成功：
```json
{ "kind": "success", "reason": "success", "processName": "WeChat.exe", "message": "已发送粘贴快捷键到 WeChat.exe" }
```

降级（PID 不匹配）：
```json
{ "kind": "clipboardOnly", "reason": "pidMismatch", "processName": "QQ.exe", "message": "目标窗口已被系统回收或复用，表情已复制到剪贴板" }
```

无目标 / 非 Windows：
```json
{ "kind": "clipboardOnly", "reason": "noTarget", "processName": null, "message": "表情已复制，请手动粘贴" }
{ "kind": "disabled", "reason": "disabled", "processName": null, "message": "表情已复制到剪贴板" }
```

### 6.2 reason 字典（前端分发 toast 用）

| reason | message |
|---|---|
| `success` | 已发送粘贴快捷键到 {processName} |
| `noTarget` | 表情已复制，请手动粘贴 |
| `targetClosed` | 目标窗口已关闭，表情已复制到剪贴板 |
| `pidMismatch` | 目标窗口已被系统回收或复用，表情已复制到剪贴板 |
| `activationFailed` | 无法恢复目标窗口，表情已复制到剪贴板 |
| `inputFailed` | 自动粘贴失败，表情已复制到剪贴板，请手动粘贴 |
| `invisible` | 目标窗口不可见，表情已复制到剪贴板 |
| `ipcFailed` | 自动粘贴调用失败，表情已复制到剪贴板 |
| `hideFailed` | 表情已复制，请手动粘贴 |
| `disabled` | 表情已复制到剪贴板 |

### 6.3 `paste()` 流程

```
validate(target) → activate(target) → restore_input_focus(target) → send_ctrl_v()
```

失败路径（validate / activate 失败、SendInput 返回 0）→ `clipboardOnly`，**不崩溃、不返回 Err**。`restore_input_focus` 失败不致命（继续发 Ctrl+V，维持旧行为）。

---

## 七、命令层

`commands.rs::paste_to_target_window`：
- 非 Windows：返回 `PasteResult::disabled()`（stub）。
- Windows：`state.peek()`（不消耗）→ `ChatPasteService::paste(&target)` → 失败时 `state.clear()`。

注册于 `lib.rs` 的 `tauri::generate_handler![...]`；`TargetWindowState` 在 `setup` 中 `app.manage()`。

---

## 八、前端

### 8.1 设置项

`src/components/ThemeProvider.tsx` 的 `PersistedSettings` 新增 `autoPaste: boolean`，**默认 `true`**，持久化到 `localStorage: emobox.settings`。

`src/app/SettingsMenu.tsx`「常规」页新增开关行：
- **标签**：选择表情后自动粘贴到打开浮层前的窗口
- **说明**：关闭后只复制到剪贴板；自动粘贴不会发送消息。Windows 专用，目标窗口无法恢复时将自动降级为仅复制。
- **控件**：Fluent UI `Switch`

不提供「自动发送」开关（本阶段刻意不引入）。

### 8.2 调用链

`QuickSearchWindow.tsx::copySelectedImage`：
```
复制 → setTimeout(close, 500) → 复制成功 toast → [autoPaste] hideQuickSearch → 50ms → pasteToTargetWindow → toast
```

- `hideQuickSearch()` 失败 → 直接降级 toast，不再尝试 paste。
- `pasteToTargetWindow()` IPC 抛错 → 降级 toast。
- `copyingPath` 在所有路径（成功 / 失败 / 取消）恢复，避免后续选择被锁死。
- `types.ts` 新增 `PasteResult` 联合类型；`tauri.ts` 新增 `pasteToTargetWindow(): Promise<PasteResult>`。

---

## 九、新增 / 修改文件清单

**新增（Rust）**：
- `src-tauri/src/platform/mod.rs`
- `src-tauri/src/platform/windows/mod.rs`
- `src-tauri/src/platform/windows/foreground_window.rs`
- `src-tauri/src/platform/windows/window_activation.rs`
- `src-tauri/src/platform/windows/input_simulation.rs`
- `src-tauri/src/platform/windows/focus_restore.rs`（**编译未通过**）
- `src-tauri/src/target_window.rs`
- `src-tauri/src/services/chat_paste_service.rs`

**修改（Rust）**：
- `src-tauri/Cargo.toml`（`[target.'cfg(windows)'.dependencies]` windows features）
- `src-tauri/src/lib.rs`（模块声明、`TargetWindowState` 托管、命令注册）
- `src-tauri/src/quick_search.rs`（`show_quick_search` 先捕获；`hide_quick_search` 清空）
- `src-tauri/src/commands.rs`（`paste_to_target_window`）
- `src-tauri/src/services/mod.rs`

**修改（前端）**：
- `src/types.ts`（`PasteResult`）
- `src/lib/tauri.ts`（`pasteToTargetWindow`）
- `src/components/ThemeProvider.tsx`（`autoPaste`）
- `src/app/SettingsMenu.tsx`（开关 + 关于文案）
- `src/features/search/QuickSearchWindow.tsx`（调用链）

---

## 十、测试

Rust 单元测试（`#[cfg(test)]`，不调用真实 UIA / SendInput / 桌面会话）：

| 模块 | 覆盖 |
|---|---|
| `target_window` | set/take/peek/clear/is_empty、TTL 过期、`set(None)` 清空、会话内 peek 复用、系统进程过滤 |
| `window_activation` | 无效 HWND → `Closed`、`PidMismatch` 显示 |
| `input_simulation` | Ctrl+V 4 事件 / 不含 Enter / keydown-keyup 顺序 / `VK_LCONTROL`、点击 3 鼠标事件 / 坐标归一化 |
| `chat_paste_service` | 各 reason 文案、`success` JSON camelCase、`processName: null`、无效 HWND 不 panic、serde 与 TS 类型对齐 |

**当前测试结果**：`65 passed; 0 failed; 1 ignored`（在 `focus_restore` 编译失败前测得；该文件无测试，编译失败不影响已通过用例）。

**注意**：`focus_restore` 修复编译后需补跑 `cargo test`；新增的 `click_at` 测试尚未随最新改动验证。

---

## 十一、真机验证结果

**已确认**：
- 复制到剪贴板：成功。
- 手动 Ctrl+V 粘贴：成功（剪贴板与 IM 均正常）。
- 自动粘贴：**不生效** —— 根因（用户确认方向 A）：**浮层关闭后输入框没有恢复焦点**。`SetForegroundWindow` 只把 IM 主窗口切回前台，Chromium/native 输入框的控件级焦点未恢复，Ctrl+V 落到当时有焦点的其他控件。

**验证过程中发现的关键事实**：
1. 浮层 `alwaysOnTop: true` 会抢走焦点；`hide` 后 Windows 只恢复顶层窗口，不恢复输入框控件焦点。
2. `SendInput` 返回成功但目标未粘贴 → 焦点问题，而非输入被拒。
3. 这就是 `focus_restore.rs`（点击输入框）存在的意义，但该文件尚未编译通过。

**待验证**（修复 `focus_restore` 编译后）：
- 微信 / QQ / 飞书 × PNG / JPG / WebP / GIF（12 组合）
- 目标窗口最小化 / 关闭 / 不可见三组降级
- 连续选择 3 张复用同一目标
- autoPaste 开关关闭
- 100% / 125% / 150% DPI、双显示器
- 确认不自动按 Enter

---

## 十二、已知问题与后续待办

### 未完成（阻塞自动粘贴生效）

1. **`focus_restore.rs` 编译失败**：`VARIANT` 构造（`union → ManuallyDrop<struct> → union` 多层嵌套）在 Rust 2024 报 `E0133`。
   - **已确认替代方案**：改用 `IUIAutomation::CreateTrueCondition()` + `FindAll` 遍历元素数组，逐个 `CurrentControlType() == UIA_EditControlTypeId` 判断，完全避开 `VARIANT`。待实现。
2. **真机自动粘贴不生效**：即使 `focus_restore` 编译通过，UIA 能否在微信 / QQ / 飞书定位到输入框尚未验证（Electron 应用需要 Chromium accessibility 树可用；native 微信走回退 `EnumChildWindows`）。

### 设计取舍

- 鼠标会移动到输入框位置（模拟点击的代价，等同用户手动点击）。
- 跨显示器时次屏输入框坐标可能被 `clamp`（本阶段接受）。
- UIA 树首次构建可能 ~100ms，已有点击前 60ms 等待。
- 「恢复窗口」≠「光标在输入框」是**已知限制**，`focus_restore` 正是为缓解它而存在。

### 后续可做

- `focus_restore` 编译修复 + 真机验证（最高优先）。
- `clippy -D warnings` 全绿（当前被预存代码 `trash_service` / `emoji_repository` / `commands` 的 25 个 lint 阻塞）。
- 考虑把「激活后等待时长」暴露为设置项（当前固定 80ms + 60ms）。
- 主窗口内直接复制表情是否也走自动粘贴（当前仅浮层入口，避免误粘贴回 EmoBox 自己）。
