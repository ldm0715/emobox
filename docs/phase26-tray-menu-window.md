# Phase 26：托盘菜单窗口（自绘 Fluent 菜单替换原生 Win32 菜单）

日期：2026-09-02

## 背景与动机

Phase 4 起托盘右键菜单一直是 Tauri `MenuItem` 构建的**原生 Win32 菜单**。原生菜单是系统级控件，字体、行高、配色、内边距全部跟随 Windows 而不可定制——在高分屏上观感陈旧（用户反馈「丑、太小」），且无法添加图标、无法跟随应用深/浅主题，也没有「设置」入口。

结论：**原生 Win32 托盘菜单无法通过任何样式手段改善**，唯一出路是不用原生菜单。方案是复用 Phase 20 已验证的透明圆角浮层基础设施，新建一个 `tray-menu` 窗口作为自绘菜单。

## 交互设计（用户确认）

- **左键单击托盘图标** → 直接打开主窗口（Win11 主流范式，右键才弹菜单）；
- **右键单击托盘图标** → 在图标上方弹出 Fluent 菜单窗口；
- 菜单四项（用户确认保持精简）：
  | 动作 | 文字 | 图标 |
  |---|---|---|
  | `open-main` | 打开主窗口 | `Home20Regular` |
  | `open-search` | 打开搜索浮层 | `Search20Regular` |
  | `open-settings` | 设置 | `Settings20Regular` |
  | `exit`（分隔线后） | 退出 | `Power20Regular` |
- 菜单关闭：失焦自动关闭、Esc 关闭、点击任意菜单项后关闭；
- 「设置」= 显示主窗口 + 打开设置弹窗（`SettingsDialog`，与侧栏底部按钮同一个弹窗）。

## Rust 侧

### `tauri.conf.json`

新增 `tray-menu` 窗口：`decorations:false`、`transparent:true`、`alwaysOnTop:true`、`skipTaskbar:true`、`visible:false`、`focus:true`、`shadow:false`、`resizable:false`，逻辑尺寸 **248×162**（贴合菜单内容实际高度，见「surface 铺满窗口」）。

### `tray.rs`（整体重写）

- 移除 `Menu`/`MenuItem`/`on_menu_event`；`TrayIconBuilder` 只保留 tooltip（「表情匣 EmoBox」）+ 默认窗口图标。**没有菜单时右键不再弹原生菜单**，右键行为完全由 `on_tray_icon_event` 接管。
- `on_tray_icon_event`：只处理 `TrayIconEvent::Click` 且 `button_state == Up`（Down 不响应，标准菜单语义）；`MouseButton::Left` → `show_main_window`（复用 Phase 4 的恢复/显示/聚焦三步），`MouseButton::Right` → `show_tray_menu(app, rect)`。
- `show_tray_menu` 定位算法：
  1. 事件携带的 `rect` 是托盘图标矩形（物理像素）。取图标中心，用 `monitor_containing`（遍历 `available_monitors()`）找出图标所在显示器，用它的 `scale_factor()` 把窗口逻辑尺寸换算成物理尺寸（窗口首次显示前 DPI 归属不定，不能依赖 `outer_size()`）；
  2. 位置：**右缘对齐图标右缘、底边悬在图标上方 8px**（任务栏几乎总在底部）；
  3. 再 clamp 到该显示器可视范围内（margin 8px），兜住隐藏图标溢出区、顶部任务栏等边角情况；
  4. `set_size` → `set_position` → **重算 OS 圆角区域**（`SetWindowRgn` 的区域不随窗口 resize 自动更新，每次弹出前按新尺寸/新 DPI 重新 `apply_rounded_region`，否则角部裁剪与实际窗口错位）→ `show` → `set_focus` → `emit_to("tray-menu", "tray-menu-opened")`。
- `TrayMenuAction` 枚举：`#[serde(rename_all = "kebab-case")]`，四个变体与前端 `TrayMenuAction` 联合类型一一对应（`open-main` / `open-search` / `open-settings` / `exit`）。
- `handle_menu_action`：**统一先 `hide_tray_menu` 再执行动作**（失败仅 warn 不阻断）。两个原因：
  1. alwaysOnTop 弹窗不先藏会阻塞后续窗口聚焦；
  2. `open-search` 必须先藏——`show_quick_search` 一进来就 `capture_from_foreground` 抓粘贴目标，菜单不先藏会**把托盘菜单自己抓成粘贴目标**。藏完再 `sleep 50ms`（与 Phase 7 粘贴流程同源的经验值）等 Windows 把焦点还给菜单打开前的窗口，再抓取。
  - `open-settings` = `show_main_window` + `emit_to("main", "settings-open-requested")`；主窗口 webview 隐藏时依然存活（Phase 25 已依赖此事实），事件必然可达。
  - `exit` = `app.exit(0)`（沿用既有合法出口）。

### `commands.rs` / `lib.rs`

- 新增 `tray_menu_action` 命令（薄壳转调 `tray::handle_menu_action`），注册进 `invoke_handler`（现 42 个命令）。
- setup 里把浮层的 DWM 圆角三件套抽成 `apply_rounded_overlay_style(&WebviewWindow)` 辅助函数，对 `quick-search` 与 `tray-menu` 两个透明窗口统一应用（`set_shadow(false)` + `disable_nc_rendering` + `apply_rounded_region`，Win10 直角阴影坑见 Phase 20 文档）。
- `on_window_event` 的 `CloseRequested`：`tray-menu` 同 `quick-search`——永远 `prevent_close()` + 隐藏（防 Alt+F4 销毁窗口）。
- **新窗口记得加进 `capabilities/default.json` 的 `windows` 数组**（`tray-menu` 需要事件监听与 `window:allow-hide` 权限；自定义命令本身不需要 capability）。

## 前端

### `src/features/tray-menu/`

- `TrayMenuPanel.tsx`：surface 与快捷搜索浮层同款阶梯——`colorNeutralBackground1` + 1px `colorNeutralStroke1` 描边 + `borderRadiusXLarge`，**无投影**（透明窗口没有衬垫空间画 CSS 阴影）；容器 padding 4px，菜单项 36px 高自定义 `<button role="menuitem">`（20px 图标 + 文案，hover `colorSubtleBackgroundHover`、按下 `colorSubtleBackgroundPressed`）。「退出」前一条 Fluent `Divider`——**flex column 里必须显式 `flexGrow: 0`**（Phase 14 坑），并手动收紧 margin 为 4px（Divider 自带 8px 上下 margin）。
  - **surface 必须铺满整个窗口（width/height 100%）**：首版把 surface 做成内容自适应高度、窗口留 8px 透明余量，结果底部出现一条白条——WebView2 对透明窗口底边区域**不合成透明度、直接露出默认白底**（Phase 20 的「WebView2 底边透明残片」教训；快捷搜索浮层没暴露是因为它 surface 铺满 100%）。所以透明窗口内部绝不能留 CSS 透明条带，窗口高度要贴合内容。
  - 入场动画：`<FadeSnappy visible appear>` 包裹 surface（容器级动画红线，无 per-item），child 是 DOM 元素。
- `TrayMenuWindow.tsx`：窗口常驻隐藏不销毁（同浮层）。
  - 失焦自动关闭：`onFocusChanged` blur → `getCurrentWindow().hide()`，带 300ms 激活守卫（show/set_focus 序列的瞬时 blur）+ latest-ref 转发（`hideRef`，与 `QuickSearchWindow.closeRef` 同模式）。无拖拽所以不需要 `overlayDragGuard`。
  - 监听 `tray-menu-opened`：记激活时间（失焦守卫用）+ `activationId` 递增 → `key={activationId}` 重挂面板重播入场动画。
  - Esc → 本地 `hide()`（窗口隐藏时键盘事件不会到达，无需额外守卫）。
  - 点击菜单项：**先本地 `hide()`（点击即刻有反馈），再 `trayMenuAction(action)` IPC**；Rust 会再兜底藏一次，重复 hide 无害。IPC 失败仅 console.error（窗口已隐藏，无处展示 toast）。

### 接线

- `src/main.tsx`：`tray-menu` label 分支挂 `<TrayMenuWindow />` + 给 `<html>` 挂 `tray-menu-window` 类；`global.css` 把该类与 `quick-search-window` 一起置透明背景。`ThemeProvider` 在 `main.tsx` 统一包裹，**主题跟随零成本**。
- `src/types.ts` + `src/lib/tauri.ts`：`TrayMenuAction` 联合类型 + `trayMenuAction()` 包装。
- `src/App.tsx`：新增独立 `useEffect` 监听 `settings-open-requested` → `setSettingsOpen(true)`（与 `main-close-requested` 完全同模式：handler 只做 setState、无依赖值、注册一次，勿并入 deps 不为空的共享监听 effect）。

## 实现教训

- **`TrayIconEvent` 的 `rect` 不是 f64 结构**：`Rect { position: Position, size: Size }`，其中 `Position::Physical(PhysicalPosition<i32>)` / `Size::Physical(PhysicalSize<u32>)`（tao 风格整型枚举），Logical 分支才是 f64。托盘上报实际总是物理像素，但 match 必须覆盖两个变体。
- **`on_tray_icon_event` 闭包第一参数是 `&TrayIcon<_>`**（不是 `&AppHandle`），要用 `tray.app_handle()` 取应用句柄。
- 左键 `Click(Up)` 与 `DoubleClick` 并存：双击会多触发一次 `show_main_window`，但恢复/显示/聚焦三步幂等，无副作用。
- 隐藏图标溢出区（chevron flyout）里右键：事件 `rect` 仍由 Shell 上报，定位逻辑 clamp 后照常工作，只是菜单会出现在 flyout 附近的屏内位置。

## 验收

- `cargo fmt --check` + `cargo check` + `cargo clippy -- -D warnings` + `cargo test`（171 过）+ `npm run build` + `npx vitest run`（41 过）全绿；
- 手工验收清单见 `MANUAL_ACCEPTANCE.md`「Phase 26：托盘菜单窗口」。
