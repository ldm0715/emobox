# Phase 19：设置弹窗 Fluent 化重构 + 拖入提示重定位 + 杂项视觉修复

> 时间：2026-08-31。纯前端视觉/布局改动，**零行为变更**：不改 `PersistedSettings` 字段与读写、不改 `SettingsDialogProps` 契约（App.tsx 仅新增传参 `dragActive`）、不改快捷键注册逻辑、不改导入功能、不改任何 Rust 代码。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/app/SettingsMenu.tsx` | 设置弹窗整体重构（主改动） |
| `src/features/search/ShortcutEditor.tsx` | 成功态从绿色 `MessageBar` 改紧凑状态行 |
| `src/features/library/EmojiLibraryView.tsx` | 拖入放置提示移入内容区（新 prop `dragActive`） |
| `src/app/LibrarySidebar.tsx` | 底部「设置」按钮统一为 `hintButton` 自定义按钮 |
| `src/components/ThemeProvider.tsx` | `color-scheme` 随主题设置（原生滚动条暗色适配） |
| `src/App.tsx` | 删根级 dropOverlay / 空 useStyles，向 EmojiLibraryView 传 `dragActive` |
| `src/app/AppShell.tsx` | `main` 的 `position: relative` 加了又还原（中间态，最终无 diff 内容差异） |

## 1. 设置弹窗（SettingsMenu.tsx）

### 左侧导航：TabList → 自定义 button

- 弃用 Fluent `TabList`/`Tab`（默认选中态带黑色下划线描边，与主窗口侧栏不一致），改用与 `LibrarySidebar` 的 `navItem` **同范式**的自定义 button 列（`settingsNavItems` 数组渲染）。
- 选中态 `navItemSelected` 照搬侧栏 token 组合：`colorSubtleBackgroundSelected` 浅品牌背景 + `::before` 3px `colorBrandStroke1` 左指示条 + `& > svg` 染 `colorBrandForeground1` + semibold。
- 导航列 208px 固定（`content` grid `208px minmax(0,1fr)`），hover 用 `colorSubtleBackgroundHover`，`:focus-visible` 描边。
- **v9 没有 Nav/Sidebar 组件**——这是没有库组件可用的场景，不是绕开组件库。

### 右侧面板与卡片

- `content` 整体 `colorNeutralBackground2` 浅灰底（Win11 Settings 的「灰底白卡」层次）；`panel` `maxWidth: 640px` 左对齐限阅读宽度，`overflowY: auto` 是唯一滚动区。
- 新增 `card` 样式：`colorNeutralBackground1` 白底 + `strokeWidthThin` `colorNeutralStroke2` 细边框 + `borderRadiusLarge` + 12/16px 内边距，**无阴影无粗边框**。每个完整设置项（`settingRow` / `shortcutItem` / 存储页的说明块）经 `mergeClasses(styles.card, ...)` 整体成卡。
- 分区内卡片间 8px（`group` gap `spacingVerticalS`）、分区间 24px（`group` marginBottom XXL）、分区标题下 8px。
- 每页顶部 `PageHeader`（标题 `fontSizeBase600` semibold + 可选副标题 `colorNeutralForeground3`）。
- **切换导航项滚动归顶**：`panelRef` + `useEffect([section])` 里 `scrollTo(0, 0)`。
- `settingRow` 在 `@media (max-width: 640px)` 降级为单列上下布局（控件左对齐）。
- 说明文字 `settingDescription` 限宽 480px、行高 `lineHeightBase400`。

### 四个子页

- **常规**：外观/通用/行为三区不变；长说明压缩为一句核心说明，细节收进标题旁 `Info16Regular` + `Tooltip`（`LabelInfo` 内联组件）——自动粘贴降级细节、选中搜索剪切找回/兼容性、联网 GIF 的超时/大小上限/QQ-Firefox 豁免。信息未删，只降默认阅读负担。
- **快捷键**：两个快捷键块结构一致（卡片内标题 + 说明 + `ShortcutEditor`）；「快捷操作」区维持 settingRow + Button。
- **存储与导入**：素材库位置（只读 monospace `Input` + 原生 `title` 全路径 + 打开按钮同行 `pathRow`，flex wrap 防溢出）；「仅本地处理」`Badge tint` 内联进说明行；隐私文字改 `MessageBar intent="info"`。
- **关于**：产品信息卡（应用名 `fontSizeBase600` + `EmoBox · 版本 0.1.0` 硬编码字符串——仓库无 `getVersion()` 调用，**不要**虚构）+ 「当前功能」卡内**双列勾选清单**（`CheckmarkCircle16Regular` 品牌色 + `colorNeutralForeground2`，窄于 640px 落单列，`featureGrid`/`featureItem`）+ 「开发计划」卡 + 版权行（卡片外小字）。

### ShortcutEditor.tsx 配套

- 成功态：`MessageBar intent="success"` → `statusLine`（CheckmarkCircle 图标染 `colorPaletteGreenForeground1` + 次要色文字）。错误/警告仍用 MessageBar（需要醒目）。
- 录制/应用/`onApply` 契约/错误流完全不动。

### 沿用的坑（Phase 12 的仍承重）

- `content` grid 必须 `gridTemplateRows: minmax(0, 1fr)`、`DialogBody` 挂 `height: 100%`，`panel` 才有界高度、滚动才生效。
- 不要在 `content` class 上把 `overflowY` 覆盖成 `hidden`——Fluent `DialogContent` 自带滚动。

## 2. 拖入放置提示（dropOverlay）重定位

历史：原来是 App 根级 `position: fixed; inset: 16px` 全屏虚线框——盖住工具栏和侧栏；中途改过「居中小徽章」（用户嫌小）和「main 内 inset 24px」（盖住 header）。

最终形态（`EmojiLibraryView.tsx`）：

- 新增 `contentWrap`（`position: relative` 的 grid 包裹层）套在 `content`（图片网格滚动区）外；overlay 是它的 `position: absolute` 子元素——**只盖图片区，不盖 LibraryHeader / 状态条 / 批量条**。
- `inset: 16px 36px 16px 16px`——右边比其余三边多收 20px（避开滚动条区域）。tokens 是字符串，**不能做 `tokens.xxx + 20` 算术**（会拼成 `"40px20"`），直接写 `"36px"`。
- 样式 Fluent 化：`colorBrandBackground2` 品牌浅底 + `strokeWidthThin` `colorBrandStroke1` **1px 实线**（不用 2px 粗虚线）+ `borderRadiusXLarge`，居中 `ArrowDownload20Regular` + 品牌色文字，`pointerEvents: none` 照旧。
- **prop 流**：`App.tsx` 持有 `dragActive`（Tauri 拖放事件），作为新 prop 传给 `EmojiLibraryView`；`SettingsDialogProps` 不动。`AppShell` 的 `main` 不需要 `position: relative`（overlay 已不在那层）。

## 3. 原生滚动条暗色适配（ThemeProvider.tsx）

- 根因：滚动条是 WebView2 原生控件，跟随 CSS **`color-scheme`** 属性，而 `FluentProvider` 只切组件 CSS 变量、从不设置它；`getCurrentWindow().setTheme()` 只管原生窗口（标题栏）。深色主题下滚动条永远浅色。
- 修复：`resolvedTheme` 变化的 effect 里 `document.documentElement.style.colorScheme = resolvedTheme`。两个窗口共用 ThemeProvider，「跟随系统」实时生效。附带让表单控件、原生 tooltip 一起跟随。

## 4. 侧边栏底部按钮统一（LibrarySidebar.tsx）

- 「设置」行原来是 Fluent `Button`（自带行高/内边距），与「快捷键」行（自定义 `hintButton`）盒模型不同 → 视觉上一个偏上一个偏下。
- 改为与快捷键行完全相同的 `hintButton` / `hintCollapsed`（24px 图标网格 + `fontSizeBase200` 标签 + `alignItems: center`），删掉 `settingsButton` / `settingsCollapsed` 样式。Tooltip / aria-label / onClick 不变。
- **教训**：两行视觉对不齐时，先确认是不是两种不同组件；统一成同一种比调样式可靠。本次未真机复验（用户放弃），如再现，抓运行窗口 computed style 对比盒模型，别换实现碰运气。

## 验证

- `npm run build`（tsc + vite）✅、`npx vitest run` 5 文件 35 用例 ✅（本 phase 无新测试——纯视觉改动，无可断言逻辑）。
- 手动：四页切换/滚动重置/卡片 hover、深浅主题、拖文件看 overlay 只盖图片区、窄窗口上下布局。
