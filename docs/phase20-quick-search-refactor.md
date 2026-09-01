# Phase 20：快捷搜索浮层重构（分组入口 / 分页缓存 / 失焦关闭 / 整窗拖拽 / Win10 圆角修复）

日期：2026-09-01。涉及 `src/features/search/` 全部五个文件、`src-tauri/src/lib.rs`、`src-tauri/src/quick_search.rs`、新增 `src-tauri/src/platform/windows/dwm.rs`、`src-tauri/capabilities/default.json`。Rust 侧无新命令。

## 背景与目标

浮层此前功能可用但体验不完整：无分组入口、一次性拉取全部结果（空 query 30 条 / 搜索 60 条一次渲染）、无"点外部关闭"、无加载更多、状态展示缺失。本次补齐这些，同时保持搜索 / 复制 / 自动粘贴 / 快捷键业务逻辑不变。

**用户指定的交互决策（承重）**：

- 搜索范围 = **全库**（与主窗口同一后端路径，`view:"all" + query`，支持 `组*标签` 精确语法）。**不做分组内搜索**——找表情时用户不记得它在哪个分组。
- 对称交互：输入关键词 → 分组筛选挂起，全库搜索；清空关键词 → 回到所选分组浏览；**点分组按钮 = 清空关键词切回分组浏览**。
- 分组行始终显示（横向滚动，不撑高浮层）。
- 每次唤起重置回「全部」（最近使用）。

## 搜索与数据流（`useQuickSearchQuery.ts` 重写）

新签名：`useQuickSearchQuery(activationId, reloadToken, groupId: number | null)` →
`{ query, setQuery, resetQuery, items, total, loading, loadingMore, error, loadMore, hasMore }`。

- **选项推导**：非空 query → `{view:"all", query}`（分组挂起、无 sort）；空 query + groupId → `{view:"group", groupId, sort:"recent"}`；空 query + null → `{view:"all", sort:"recent"}`（原行为）。
- **分页**：`PAGE_SIZE = 20`，`limit/offset` 下推 `search_emojis`（`SearchResult.total` 驱动 `hasMore`）。「加载更多」按 offset 追加；**offset 按服务端返回行数前进**（Phase 17 教训：本地去重会让 `items.length` 与 offset 错位；全被去重的页 `appended.length === 0` → `nextOffset = null` 停止，防死循环）。
- **缓存**：`useRef(Map)`，key = `` `${groupId ?? "all"}::${trimmedQuery}` ``，值 `{items, total, nextOffset}`。命中 → 直接落地不发请求（分组/关键词来回切不重拉首页）；缓存**跨 activationId 存活**（每次唤起不重拉），`reloadToken` 变化（library-changed）时整体 `clear()`。
- **requestSeq 守卫保持并覆盖 loadMore**：effect 每次 run / cleanup 递增 seq；`loadMore` 快照 `requestSeq.current`，key 切换时在途响应按 seq 作废。`loadingMore` 在 finally 里**无守卫恢复**（被作废也要解锁，否则按钮永久 disabled），effect 开头也 `setLoadingMore(false)`。
- 测试更新：保留乱序丢弃 / reloadToken 保 query 重搜 / 卸载安全；新增 loadMore 分页追加与拉满停止、缓存命中不重拉、分组参数断言（非空 query 时 **无 groupId**）。

## 布局（`QuickSearchContent.tsx` / `QuickSearchPanel.tsx`）

root grid rows = `auto auto auto minmax(0,1fr) auto`：搜索框 → 置顶分组行 → 状态行 → 结果（弹性滚动）→ footer。Panel 的 content 改 **flex column**（root `flexGrow:1` + `minHeight:0`，结果区才有有界高度滚动）。

- **搜索框放大居中**：`SearchBox` 只有 medium/large 两档，对内层 input 提 `fontSizeBase400` + `paddingBlock 10px`（Griffel 嵌套选择器必须 `"& input"` 带占位符——裸 `"input"` 静默不生效，见 SettingsMenu.pathInput 既有告警）。**Fluent SearchBox 第二坑**：根元素自带 `max-width: 468px`，`width:"100%"` 会被它截断成 468px 贴左——必须显式 `maxWidth:"none"` 才真正撑满。
- **置顶分组行**：`listGroups()` 过滤 `isPinned`（唤起时刷新——`set_group_pinned` 是纯侧栏变更不发 library-changed，靠唤起重拉兜住）；「全部」+ 置顶组，Fluent `Button size="small"`（选中 primary / 未选 secondary），图标走 `getGroupIcon`；行高固定 36px、`overflowX:auto` 横向滚动不撑高；无置顶分组整行不渲染。
- **状态行**：非 loading / error 且 total>0 时显示——搜索 `“x” · N 张结果` / `分组「X」 · N 张` / `最近使用 · N 张`。
- **加载更多按钮**：grid 下方居中，`tabIndex={-1}` 防 Enter 冲突（根容器 onKeyDown 先拦截 Enter=复制选中项），`loadingMore` 时 disabled 显示"加载中…"。
- **图片失败态**：`useThumbnail` 的 `failed` + 静态图 onError（本地 state）→ `Image20Regular` 占位；`img` 加 `loading="lazy" decoding="async"`。
- footer 提示简化为 `↑↓ 选择 · Enter 复制 · Esc 关闭`（.key 徽章样式保留）。
- **红线保持**：`<Slide key={activationId}>` 只在唤起时重挂载（≤150ms 入场硬约束），分组行/状态行在输入时只重渲染不重播动画；卡片只用原生 `title`；颜色全 tokens。

## 失焦关闭 + 整窗拖拽（本轮两个真机坑）

**失焦关闭**：`QuickSearchWindow` 里 `getCurrentWindow().onFocusChanged`，`payload === false` 经 latest-ref `closeRef` 调 close。守卫：

- **激活期守卫**：`activatedAtRef` 在 activate() 打时间戳，blur 距激活 <300ms 忽略（Windows show/center/set_focus 序列可能产生瞬时 false 事件）。
- **拖拽守卫**（`overlayDragGuard.ts`）：`startDragging()` 进入 Win32 move loop 时窗口**短暂失焦**（WM_KILLFOCUS→WM_SETFOCUS 一对），不抑制会把正在拖拽的浮层直接隐藏（真机复现：按住浮层一按就消失）。拖拽前置位 → blur 忽略；focus=true 清标志；3 秒超时兜底复位（防 focus 事件丢失导致失焦关闭被永久抑制）。
- close 与复制流交互安全：hide 触发的 blur → close 幂等；close 只调 `hideQuickSearch`，**绝不清 TargetWindowState**（hide→paste 链依赖）。

**整窗拖拽**：原 `data-tauri-drag-region` 只认属性所在元素本身，标题栏里的图标等子元素是死区（"很难拖动"的根因）。改为 `QuickSearchPanel` 根节点 `onMouseDown` → `getCurrentWindow().startDragging()`（需要 capability `core:window:allow-start-dragging`，已补进 default.json）。排除选择器：`button, input, textarea, select, a, [role='option'], [role='search'], [data-no-window-drag]`；结果滚动区标 `data-no-window-drag`（保住滚动条拖动语义）。仅左键。

**拖拽位置保留**：`show_quick_search` 的 `center()` 改为**仅首次显示居中**（`static CENTERED_ONCE: AtomicBool`）——窗口只隐藏不销毁，拖到哪就留在哪；进程重启后恢复居中。

## Win10 圆角修复三部曲（tauri#11321 续）

症状：透明圆角浮层的圆角外出现方形阴影/色块，时隐时现，最终必现。窗口量测证实 `window=680×500, client=680×500`（无 NC 内缩，排除 tao 边距理论）。

1. **`DwmSetWindowAttribute(DWMWA_NCRENDERING_POLICY, DWMNCRP_DISABLED)`**（`dwm.rs::disable_nc_rendering`）：直接禁止 DWM 绘制该窗口非客户区，属性级、幂等、不触发样式重算。实测清掉了顶部角。
2. **`SetWindowRgn` + `CreateRoundRectRgn` 圆角裁剪**（`dwm.rs::apply_rounded_region`）：OS 级兜底，区域外像素（DWM 残余阴影、WebView2 底边透明残片）一律无法绘制。半径 = CSS `borderRadiusXLarge`（8 逻辑像素）的物理等值（8×DPI/96）；浮层固定 680×500 不可调尺寸，一次设置即可。
3. **保留** `lib.rs::setup` 的 `set_shadow(false)`。

**教训（勿再踩）**：在窗口**可见期间**反复调 `set_shadow(false)`（每次 show / Focused(true) 事件里）会触发 tao 的窗口样式重算 + SWP_FRAMECHANGED，实测让色块从偶发变必现——运行时清阴影一律走 DWM 属性，不走 tao 标志位。两个失败的中间方案（show 后清一次、Focused(true) 清一次）均已回退。

`Cargo.toml` windows features 新增：`Win32_Graphics_Dwm`、`Win32_Graphics_Gdi`、`Win32_UI_HiDpi`。

## 文件清单

| 文件 | 变更 |
|---|---|
| `src/features/search/useQuickSearchQuery.ts` | 重写：分页 + 缓存 + groupId |
| `src/features/search/useQuickSearchQuery.test.tsx` | 更新 + 新增用例（6 个） |
| `src/features/search/QuickSearchWindow.tsx` | 置顶分组拉取、selectedGroupId、失焦关闭（激活期 + 拖拽双守卫） |
| `src/features/search/QuickSearchPanel.tsx` | 整窗拖拽、透传扩展、content flex column |
| `src/features/search/QuickSearchContent.tsx` | 布局重构：分组行/状态行/加载更多/懒加载/失败态/footer |
| `src/features/search/overlayDragGuard.ts` | 新增：拖拽失焦抑制 |
| `src-tauri/src/platform/windows/dwm.rs` | 新增：DWM NC 禁用 + 圆角区域裁剪 |
| `src-tauri/src/lib.rs` | setup 调 dwm 两件套；回退 Focused 事件清阴影 |
| `src-tauri/src/quick_search.rs` | 回退 show 时清阴影；center 仅首次 |
| `src-tauri/capabilities/default.json` | + `core:window:allow-start-dragging` |

## 验收记录

`cargo fmt` / `cargo clippy -D warnings` / `cargo test`（157 通过）✅；`npm run build`（tsc + vite）✅；`npx vitest run` 37/37 ✅。真机：分组切换/缓存秒切、加载更多 20/页、键盘导航（既有）、失焦关闭、拖拽不消失且位置保留、四角干净（用户确认顶部干净，底部经区域裁剪修复）。
