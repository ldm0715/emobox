# Phase 15：选中文字自动搜索

## 背景

用户诉求：在聊天应用里选中文字后按全局快捷键打开快捷搜索浮层，浮层自动以选中文字为初始搜索词；点击结果图片后表情直接粘回原来的输入框。

两个难点：

1. **读取选中文字** —— 微信/QQ/飞书这类应用没有统一可靠的选区读取接口。
2. **失焦粘贴** —— 点击浮层后目标输入框失焦，`SetForegroundWindow` 只恢复顶层窗口焦点。

## 决策记录

### D1：读取方式 —— UIA TextPattern 优先 + Ctrl+X 剪切兜底（替换语义）

语义（用户拍板）：选中文字是**替换意图** —— 取词时即从输入框删除（剪切），
表情粘贴时正好落在原文字位置；放弃选表情时剪切文字留在剪贴板可手动
Ctrl+V 找回。

- **UIA 通道**（`platform/windows/selection_reader.rs`）：`GetFocusedElement` →
  `UIA_TextPattern` → `GetSelection` → `GetText(-1)`。非侵入读到选区后补一个
  Ctrl+X 删掉选区。只在焦点控件暴露 TextPattern 时成功（Electron 应用如
  QQNT/飞书的 Chromium 无障碍树、标准编辑框）；原生微信的自绘输入框大概率
  走不通。
- **Ctrl+X 兜底**（`selection_capture.rs::ctrl_x_fallback`）：快照剪贴板文字
  （仅用于变化检测）→ **等修饰键物理松开**（`wait_for_modifiers_released`，
  最多 600ms）→ 合成 Ctrl+X（取词 + 删除一步完成，`input_simulation::send_ctrl_x`，
  4 事件 × 20ms）→ 轮询 `read_text` 变化最多 ~300ms。
  - 剪贴板文字与快照相同或为空 → 判定"无选中"（剪贴板没被动过）。
  - 成功则**保留**剪贴板里的剪切文字（放弃选择时的找回途径），不恢复原
    剪贴板内容 —— 原剪贴板被替换是替换语义的已知代价。
  - 已知边界：选中文字与原剪贴板文字完全相同时会被误判为"无选中"（可接受）。

### D2：产品边界变更 —— 有意突破 Phase 7 的「不读取聊天内容」

Phase 7 文档明确"不读取聊天内容"。本功能只读**当前选区**、只存在于内存、绝不持久化，
仅作为搜索词经 `quick-search-opened` 事件传给浮层。用设置开关「打开浮层时用选中文字
自动搜索」（默认开启）落实这条边界的突破。

### D3：设置如何到达 Rust

localStorage（`emobox.settings` 的 `selectionSearch`）是事实源；Rust 侧
`SelectionSearchState`（`Mutex<bool>` + `explicitly_set` 标志）只做内存镜像。前端在
ThemeProvider 挂载和开关变化时经 `set_selection_search_enabled` 命令推送（两个窗口都
推，幂等）。已知竞态：应用刚启动、前端尚未推送时按默认 `true`（与前端默认一致）执行。

### D4：读取时机 —— 必须在浮层抢焦点前

`quick_search::show_quick_search` 的顺序：`capture_from_foreground`（粘贴目标）→
`selection_capture::capture_selected_text`（选中文字，UIA 读的是"焦点控件"）→
center/show/set_focus → emit。UIA `GetFocusedElement` 在浮层 show 之后就会指向浮层
自己，所以读取必须在前。

### D5：事件 payload

`quick-search-opened` 的 payload 从 `()` 改为
`QuickSearchOpenedPayload { selectedText: Option<String> }`（camelCase serde）。前端
`QuickSearchWindow.tsx` 的 listener 读 `event.payload?.selectedText` 传给
`activate(seed)`；非空 seed 走 `setQuery(seed)`，否则 `resetQuery()`。
`useQuickSearchQuery` 本体无改动（requestSeq 守卫天然支持 seed 注入）。

### D6：顺手修复 —— 快捷键路径从不捕获粘贴目标（既有 bug）

`shortcut_registry.rs::run_owner_action` 原来内联复制了一份 show 逻辑（center/show/
set_focus/emit）且**不调 `capture_from_foreground`** —— 用户按全局快捷键打开浮层时
`TargetWindowState` 永远为空，`paste_to_target_window` 必然 `noTarget` 降级。修复：
`show_quick_search` / `hide_quick_search` / `capture_from_foreground` 泛型化为
`<R: Runtime>`，快捷键路径直接调用 `quick_search::show_quick_search`，与托盘/主窗口
路径完全共用同一代码。

### D8：合成按键前必须等修饰键松开（真机血泪教训）

快捷键 Ctrl+Alt+Space 触发时用户几乎必然还按着 Ctrl/Alt。不等就发合成键：
- Alt 还按着 → 应用收到 Ctrl+Alt+X（不是剪切），什么都不发生；
- Ctrl 在合成序列中途松开 → 应用收到**裸按键**，输入框默认行为是按键字符
  **替换当前选区**，用户选中的文字会被误删成单个字符（真机复现："输入框的
  文字不见了"）。

修复：`input_simulation::wait_for_modifiers_released`（`GetAsyncKeyState` 轮询
Ctrl/Alt/Shift/Win，10ms 间隔）最多等 600ms，超时放弃（浮层空 query 打开），
宁可没有 seed 也不冒误删文字的风险。

### D9：`hide_quick_search` 不清空粘贴目标（真机发现）

前端自动粘贴链是 **hide-then-paste**：`hideQuickSearch()`（浮层必须先隐藏，
alwaysOnTop 会阻塞 `SetForegroundWindow`）→ 50ms → `pasteToTargetWindow()`。
而 `hide_quick_search` 原来在这里 `state.clear()` —— 目标被清掉，后面的
`paste_to_target_window` peek 不到，直接 `noTarget` 降级，**自动粘贴从未真正
执行过**（真机症状：浮层关闭后聊天窗口自然回到前台、光标还在输入框，但表情
没贴入）。

修复：hide 不再 clear。跨会话复用由 `capture_from_foreground` 的"打开即先
clear"防住（本来就冗余），另有粘贴失败 clear 和 60 秒 TTL 兜底。

### D7：focus_restore.rs E0133 编译损坏修复（Phase 7 遗留）

按 Phase 7 文档确认的方案重写 `uia_click_edit_center_inner`：删除 VARIANT union 构造
+ `CreatePropertyCondition` + `FindFirst`，改为 `CreateTrueCondition()` →
`FindAll(TreeScope_Subtree)` → 遍历 `CurrentControlType() == UIA_EditControlTypeId` →
取第一个 Edit 元素点击中心。`FocusRestoreResult` 枚举、COM init 模式、
`EnumChildWindows` 回退路径全保留。Windows 构建自 Phase 7 以来首次恢复绿色，真机
自动粘贴链路（validate → activate → restore_input_focus → send_ctrl_v）首次端到端可测。

## 关键文件

| 文件 | 内容 |
|---|---|
| `src-tauri/src/selection_capture.rs` | 编排层：开关检查 → UIA（读到后补 Ctrl+X 删选区）→ Ctrl+X 兜底 → sanitize（trim/折叠空白/40 字符截断，CJK 安全） |
| `src-tauri/src/platform/windows/selection_reader.rs` | UIA TextPattern 选区读取（非侵入通道） |
| `src-tauri/src/platform/windows/input_simulation.rs` | 新增 `build_ctrl_x_inputs` / `send_ctrl_x` / `wait_for_modifiers_released`；三个 Ctrl 组合键统一到 `build_ctrl_char_inputs` 共享构造器 |
| `src-tauri/src/platform/windows/focus_restore.rs` | E0133 修复（CreateTrueCondition + FindAll） |
| `src-tauri/src/quick_search.rs` | `QuickSearchOpenedPayload`、泛型化、读取时序 |
| `src-tauri/src/shortcut_registry.rs` | `run_owner_action` 复用 `show_quick_search`（修 D6 bug） |
| `src-tauri/src/commands.rs` | `set_selection_search_enabled` 命令 |
| `src/types.ts` | `QuickSearchOpenedPayload` |
| `src/lib/tauri.ts` | `setSelectionSearchEnabled` 包装 |
| `src/features/search/QuickSearchWindow.tsx` | `activate(seed)` + listener 读 payload |
| `src/components/ThemeProvider.tsx` | `selectionSearch` 设置 + 推送 effect |
| `src/app/SettingsMenu.tsx` | 「行为」组开关 |

## 不变量

- 选中文字只存在于内存（事件 payload），**绝不持久化**（不进 SQLite、不进 localStorage、不写日志内容）。
- **替换语义**：取词即剪切（UIA 路径读到后补 Ctrl+X；兜底路径直接 Ctrl+X 取词）。剪切文字留在剪贴板作为放弃选择时的找回途径，不恢复原剪贴板内容。
- 开关关闭 → Rust 完全跳过（不动用户剪贴板与输入框）。
- 任何读取失败（UIA 失败 / Ctrl+X 被拒 / 轮询无变化）→ 浮层以空 query 正常打开，绝不阻塞浮层显示。
- 合成 Ctrl+X 前必须等修饰键物理松开（最多 600ms，超时放弃）—— 不等会发出 Ctrl+Alt+X 或裸按键，后者会误删用户文字。
- `send_ctrl_x` 绝不含 VK_RETURN（沿用 Phase 7 不变量）。
- 截断按 Unicode 字符（`chars().take(40)`），不产生半个字符。

## 手动验收清单

1. 记事本选中文字 → Ctrl+Alt+Space → 浮层打开且输入框已填入选中文字、结果自动刷新，**记事本里选中的文字已被剪切**。
2. 微信/QQ/飞书输入框选词 → 同上（UIA 失败则验证 Ctrl+X 兜底生效）。
3. 无选中 → 浮层空 query 打开（最近优先列表），剪贴板未被动。
4. 点击图片 → 表情粘贴回原输入框、落在原文字位置（**focus_restore 修复后首次端到端验证**；微信原生窗口若 UIA 找不到 Edit 控件，观察 EnumChildWindows 回退是否生效）。
5. 放弃找回：选文字开浮层 → 不选图片直接关浮层 → 任意处 Ctrl+V 应粘出被剪切的文字。
6. 开关关闭后：选文字开浮层 → 空 query，且剪贴板与输入框均未被触碰。

## 验证状态

- `cargo fmt --check` / `cargo check` / `cargo clippy -- -D warnings` / `cargo test`（137 passed, 1 ignored）✓
- `npm run build`（tsc + vite）✓；`npx vitest run`（25 passed）✓
- 真机手动验收（微信/QQ/飞书）**待执行** —— 尤其是 D7 修复后的自动粘贴端到端与替换语义。
