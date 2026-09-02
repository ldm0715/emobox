# Phase 25：主窗口关闭行为 —— 询问弹窗 + 可用开关（弹窗结果与设置项同一状态）

> 2026-09。修复「关闭窗口最小化到托盘无法关闭」的遗留坑：此前 `lib.rs::on_window_event` 对 main 窗口无条件 `prevent_close + hide`，设置项也是写死的 `disabled checked` Switch，用户既关不掉也退不出（只能走托盘菜单）。目标语义：**默认（未选择）点 ✕ 弹询问窗**；开关默认关（直接退出）、用户可开启；弹窗可勾选「记住」并**写回同一个设置项**。

## 状态模型：`closeToTray?: boolean` 三态

`emobox.settings`（localStorage，ThemeProvider 持久化）新增可选项，`undefined`（键不存在）≠ `false`：

| 值 | 语义 | 点 ✕ 行为 | 设置开关 UI |
|---|---|---|---|
| `undefined`（默认） | 未决定 | 弹询问窗 | 显示关 |
| `true` | 已记住「最小化到托盘」 | 隐藏窗口 | 开 |
| `false` | 已记住「直接退出」 | 退出应用 | 关 |

**联动规则**：① 弹窗勾「记住我的选择，下次不再询问」→ `setCloseToTray(choice === "tray")` 写回设置项（开关 UI 随之变开/关），此后不再弹窗；② 不勾 → 仅本次生效，下次继续问；③ 设置里手动拨开关 = 显式选择，同样记为已决定、不再弹窗。`readSettings` 对缺失键保持 `undefined`（不能落成 `false`——那是「已记住直接退出」）；`JSON.stringify` 自动丢弃 undefined 键，未决定时不落盘。

## Rust 侧：`CloseBehaviorState` 内存镜像 + `on_window_event` 三分支

localStorage 事实源 → 前端挂载/变更时经新命令 `set_close_to_tray(Option<bool>)` 推送到 `close_behavior::CloseBehaviorState`（`Mutex<Option<bool>>`，None=未选择；两个窗口都推、幂等，同 `SelectionSearchState` 先例）。`lib.rs::on_window_event` 的 `CloseRequested`：

- `quick-search` 窗口：**不变**，永远 prevent_close + hide；
- `main` 窗口：prevent_close 后按镜像状态分支——`Some(true)` → `window.hide()`；`Some(false)` → `app.exit(0)`（整进程退出，与托盘「退出」同语义）；`None` → **窗口保持可见**，`emit_to(main, "main-close-requested", ())` 交给前端弹询问窗（Esc 关弹窗即取消关闭）。内存镜像的意义：已记住的路径不需要 IPC 往返、即时生效。

新命令共 2 个：`set_close_to_tray`、`exit_application`（invoke_handler 39 → 41）。另加 `close_behavior::defaults_to_undecided_and_roundtrips_values` 单测。

## 前端：询问弹窗 + 开关

- **`src/app/CloseActionDialog.tsx`**（新）：Fluent Dialog，范式对齐 `ConfirmDialog`（420px surface、`modalType="alert"`、常挂载 + `open` prop、消息行 FG2 base300）。标题「关闭 EmoBox」；正文「要最小化到系统托盘还是直接退出？」；`Checkbox`「记住我的选择，下次不再询问」（**open 变 true 时重置勾选**）；按钮 **「直接退出」= primary**（贴合默认关闭即退出的语义），「最小化到托盘」= secondary。Esc/点遮罩经 `onOpenChange(false)` = 取消、不做任何动作。
- **`App.tsx`**：`closeDialogOpen` state；`listen("main-close-requested")` 独立空 deps effect（handler 只 setState，勿并入共享监听 effect）；`handleCloseDecide(choice, remember)`——remember 时 `setCloseToTray(choice === "tray")`（ThemeProvider setter 落 localStorage + 触发推送 effect），然后 tray → `getCurrentWindow().hide()`（**capability 需显式 `core:window:allow-hide`**，已核实 core:default 不含 hide）/ exit → `exitApplication()`；两分支失败走 `notifyError`。`keyShortcutRef` 的弹窗豁免条件加入 `closeDialogOpen`。弹窗渲染在 `SettingsDialog` 旁。
- **`SettingsMenu.tsx`**：托盘开关由 `disabled checked` 改为真实 `Switch`（`checked={closeToTray ?? false}`，onChange 写设置=显式选择）；tooltip 更新为「开启后……关闭则直接退出应用。未记住选择时，点击关闭按钮会先询问。」

## 决策记录

- 选「询问窗 + 记住」而非首次直接按默认执行：托盘驻留曾是旧版隐含行为，直接改为退出会让老用户丢快捷搜索入口；直接改为继续驻留则违背「默认关闭」诉求。询问窗一次把选择权交给用户，记住后零打扰。
- primary 按钮给「直接退出」：与默认设置（关）一致；「最小化到托盘」是次要选项，两按钮均一击可达，勾选记住后不再重复。
- 用 capabilities 放行 `core:window:allow-hide` 而非新开 hide 命令：前端 JS `hide()` 是标准路径，一行权限即可；退出必须走命令（webview 无整进程退出 API）。

## 验收

`cargo fmt --check` / `check` / `clippy -- -D warnings` / `test`（171 通过）+ `npm run build` + `npx vitest run`（41 通过）全绿。手动矩阵见 `MANUAL_ACCEPTANCE.md` Phase 25 节：首次弹窗、勾/不勾记住两种结果与开关 UI 联动、开关拨动后不再弹窗、quick-search 与托盘行为回归。
