# UI 一致性整改实施记录

> 日期：2026-09-01。前置文档：`docs/ui-consistency-audit.md`（审计报告 + 分阶段计划）。
> 本文记录按该计划四个阶段实际落地的变更、验证结果与遗留事项。审计结论：项目 token 化程度很高（`tokens.*` 384 处 / 18 文件），无系统性暗色模式破损，问题集中在少数残留，全部低风险渐进修复。

## 变更总览

| 阶段 | 内容 | 新增文件 | 修改文件 |
|---|---|---|---|
| 0 | 主题基础（::selection 品牌色、窗口 theme 跟随系统、字体栈注释） | — | `global.css`、`tauri.conf.json` |
| 1 | Fluent Dialog 替换 4 处原生 `window.confirm/prompt` | `ConfirmDialog.tsx` | `App.tsx`、`LibrarySidebar.tsx` |
| 2 | 通用组件收敛（1px→token、navItem 共享、chip→Badge、零星字面量） | `navItemStyles.ts` | 4 个 Dialog、`LibrarySidebar`、`SettingsMenu`、`EmojiPreviewDialog` |
| 3 | 样式去重（picker 弹窗列表行、卡片公共样式） | `cardStyles.ts`、`pickerDialogStyles.ts` | `TagPickerDialog`、`MoveToGroupDialog`、`EmojiGridItem`、`QuickSearchContent` |

净效果：14 个文件修改 + 5 个新文件，+168 / −241 行（样式去重收益）。

## 阶段 0：主题基础

1. **`src/styles/global.css:36-41`** —— `::selection` 背景从旧品牌紫 `#7450b8` 改为品牌蓝 `#0f6cbd`（即 `ThemeProvider.tsx` `BrandVariants[80]`，亮色 `colorBrandBackground` 对应值）。CSS 文件拿不到 Griffel token，写字面量并注释对应关系。**这是全项目唯一一处颜色级主题不一致**（此前亮暗两主题都选紫色，与品牌蓝冲突）。
2. **`src-tauri/tauri.conf.json`** —— `main` / `quick-search` 两窗口移除固定 `"theme": "Light"`，跟随系统。消除持久化了 dark 偏好的用户在 React 挂载并 `setTheme` 之前的启动白闪。运行时仍由 `ThemeProvider` 的 `getCurrentWindow().setTheme()` 接管。
3. **`src/styles/global.css:1-2`** —— `:root` 字体栈加注释，注明与 `ThemeProvider.fontFamilyBase` 保持同步（两处定义保留，收敛注释化处理）。

## 阶段 1：对话框统一（4 处原生 UI 全部替换）

原生 `window.confirm/prompt` 不跟随应用主题（暗色用户弹亮色系统框）、`window.prompt` 中文输入法体验差。替换明细：

| 原位置 | 原实现 | 新实现 |
|---|---|---|
| `App.tsx` `handleDelete`（移入回收站） | `window.confirm` | `confirmState`（`PendingConfirm`）驱动的共享 `ConfirmDialog`，实际操作拆到 `performDelete(ids)` |
| `App.tsx` `handlePermanentlyDelete`（彻底删除） | `window.confirm` | 同上，`destructive: true` 红色确认按钮，操作拆到 `performPermanentlyDelete(ids)` |
| `LibrarySidebar.tsx` 分组菜单「重命名」 | `window.prompt` | 复用 `GroupDialog` 的 **rename 模式**（该模式本就存在但未被使用）：App 持有 `renameGroupState: LibraryGroup \| null` + `renameGroupBusy`，提交走原有 `renameGroup` 命令链（refreshSidebar + toast） |
| `LibrarySidebar.tsx` 分组菜单「删除」 | `window.confirm` | 组件内置 `ConfirmDialog`（`confirmDeleteGroup` 状态），确认后调既有 `onDeleteGroup` |

关键设计点：

- **`ConfirmDialog`**（`src/features/library/ConfirmDialog.tsx`）：`modalType="alert"`、message 支持 `\n`（`whiteSpace: pre-line`）、`destructive` 时确认按钮红色。Fluent v9 Button 无 danger appearance，用 `colorPaletteRedBackground2` + `colorPaletteRedForegroundInverted` token 覆盖——**注意 palette 红没有 Hover/Pressed 变体**（踩过：`colorPaletteRedBackground2Hover` 不存在，tsc 报错后移除），故为静态红底，无悬停反馈。
- **键盘快捷键豁免**：`App.tsx` 的 `keyShortcutRef` 弹窗豁免列表已加入 `confirmState !== null` 与 `renameGroupState !== null`，避免确认/重命名弹窗打开时误触发 Ctrl+A / Delete 批量操作。
- **prop 签名变更**：`LibrarySidebarProps.onRenameGroup` 从 `(id: number, name: string) => void` 改为 `(group: LibraryGroup) => void`（侧栏只请求开弹窗，重命名流程整体上移到 App）。
- 重命名失败时错误由 `GroupDialog.handleSubmit` 捕获并内联显示（App 侧只 `try/finally` 复位 busy，不重复 setError）。
- `GroupDialogLite`（create 模式包装）保持不变；rename 模式直接渲染 `GroupDialog`。

**约定变更**：CLAUDE.md / AGENTS.md 中「回收站确认用 `window.confirm`，无 Fluent Dialog」已改为走 `ConfirmDialog`。此后**不要再引入原生 `window.confirm/prompt/alert`**。

## 阶段 2：通用组件收敛

1. **5 处字面 `1px` 边框 → `tokens.strokeWidthThin`**（token 值即 `1px`，视觉零变化）：
   `GroupIconPickerDialog.tsx`（listScroll、iconButtonSelected）、`GroupDialog.tsx`（iconOptionSelected）、`TagPickerDialog.tsx` / `MoveToGroupDialog.tsx`（listScroll，随阶段 3 一并入共享模块）。
2. **`src/app/navItemStyles.ts`（新增）**：侧栏与设置对话框左导航的导航行样式原本是两套近乎复制的实现（各自 `navItem` / `navItemSelected`，注释自认同范式）。现抽出共享的 `navItemBaseStyle`（悬停 / 焦点环 / reset）与 `navItemSelectedStyle`（浅品牌背景 + 3px 品牌指示条 + `& > svg` 染色），两个消费方 `makeStyles` 里只保留布局差异：
   - `LibrarySidebar`：`minHeight 28px`、三列 grid、`columnGap S`、折叠态 `navItemCollapsed`
   - `SettingsMenu`：`minHeight 32px`、两列 grid、`columnGap M`、`fontSizeBase300`
   - **修改共享文件的视觉会同时影响两处导航**（文件头注释已声明）。
   - 实现方式是 GriffelStyle 对象展开进各自 `makeStyles`（非 mergeClasses，无原子类覆盖顺序问题）。
3. **`EmojiPreviewDialog` chip → Fluent Badge**：信息面板的分组/标签 chips 原为自建 `span.chip`，现改 `Badge size="small" appearance="outline"`，截断沿用 `EmojiGridItem.tagBadge` 的先例（覆盖 `display: "block"` 才能文本截断，`maxWidth: 180px`）。
4. **零星字面量**：侧栏置顶图钉 `PinRegular fontSize={12}` → `tokens.fontSizeBase200`（同值 12px）；侧栏细滚动条的 `6px` 宽 / `3px` 圆角加注释（尺寸无对应 token，thumb 颜色走 token 随主题切换）。

**有意不动**（审计确认的设计决策，勿“修复”）：侧栏/设置原生 `<button>` 导航行（Phase 19 刻意统一，换 Fluent 组件会动盒模型）、`EmojiGridItem` 原生 `title`（Phase 18 性能红线，勿换 Fluent Tooltip）、卡片悬浮按钮深色 scrim `rgba(24,24,27,*)`（叠图上双主题均成立）、`--emoji-tile-size` CSS 变量。

## 阶段 3：样式去重

1. **`src/features/library/pickerDialogStyles.ts`（新增）**：`TagPickerDialog` 与 `MoveToGroupDialog` 有 9 个逐行相同的样式键（`surface` / `content` / `subtitle` / `listScroll` / `listEmpty` / `row` / `count` / `selectAllRow` / `inlineCreate`），全部收进共享模块（导出 `PickerDialogStyles` 接口 + `pickerDialogStyles` 常量）。两文件各自只留差异：
   - `MoveToGroupDialog`：`actions`（flex-end）
   - `TagPickerDialog`：`actions`（space-between，左摘要右按钮）、`rightActions`、`summary`
   - **坑**：`makeStyles({ ...外部对象 })` 时 TS 只推断字面量键，`styles.row` 报 TS2339。解法是先声明带显式类型的 `const pickerStyles: PickerDialogStyles & { actions: GriffelStyle; ... }` 再传给 `makeStyles`。
2. **`src/features/library/cardStyles.ts`（新增）**：`EmojiGridItem`（主网格卡片）与 `QuickSearchContent`（浮层结果格）只有两段完全一致——`cardBorderResetStyle`（透明描边 reset，防选中/悬停换 border-color 抖动布局）与 `cardSelectedRingStyle`（品牌描边 + 同色外扩光环）。只抽这两段；其余差异（圆角 Large/Medium、cursor、焦点环、frame 内边距）是各自刻意设计，**未强并**。
   - `QuickSearchContent` 的 `shorthands` 导入随之移除（唯一两处使用都被替换）。

## 验证

- `cargo check --manifest-path src-tauri/Cargo.toml` ✅（覆盖 tauri.conf.json 变更合法性；未改 Rust 源码）
- `npm run build`（tsc --noEmit + vite build）✅
- `npx vitest run`：5 个测试文件 35/35 ✅（useClickIntent / useGifPreview / useMultiSelection / useQuickSearchQuery / searchSyntax 均不受影响）
- `node -e JSON.parse(...)` 校验 tauri.conf.json ✅
- CLAUDE.md 已更新（回收站确认约定、navItem 共享、features/library 新文件、docs 索引），AGENTS.md 整体覆盖同步 ✅

**待真机手动验收**（无法无头验证）：

1. 亮/暗主题各启动一次：暗色用户无启动白闪；任意页面选中文本为品牌蓝
2. 批量移入回收站 / 彻底删除 / 分组重命名 / 删除分组四个弹窗，亮暗两主题样式一致；`ConfirmDialog` 红色 destructive 按钮观感（`colorPaletteRedBackground2` 亮暗两态）
3. 侧栏与设置左导航选中态与改前逐像素一致（本次为纯抽取，应零视觉变化）
4. 预览弹窗分组/标签 chips（现为 Badge outline）观感
5. `TagPickerDialog` / `MoveToGroupDialog` 列表样式（纯抽取，应零视觉变化）

## 遗留 / 后续

- **滚动条双轨**：侧栏 6px 自定义细滚动条 vs 其余滚动区原生默认——审计定为 P2 可接受差异，本次仅补注释，未统一。若要统一，可把侧栏的 `::-webkit-scrollbar` 样式抽成共享 Griffel 片段应用到设置 panel 等区域。
- **`EmojiGridItem` scrim**：`color: "white"` + `rgba(24,24,27,0.66/0.82)` 保持原样（叠图例外，双主题视觉均成立）。若未来要 token 化，可考虑 `colorNeutralBackgroundInverted` 类 token + opacity，需真机对比。
- **`global.css` 字体栈与 `fontFamilyBase` 双定义**：保留两处 + 注释（`:root` 需在 React 挂载前生效）。若要彻底收敛，可让 ThemeProvider 读 CSS 变量，属更大改动。
- 审计报告中「建议保留不动」清单继续有效。

## 后续修复（2026-09-01）：回收站操作收紧

**问题**：回收站视图存在越权操作——右键/更多菜单可「复制到剪贴板」「查看文件位置」，卡片悬浮有「复制」按钮，普通单击 = 延迟复制，双击预览弹窗里还有「收藏」「复制」。回收站中的素材应只允许 恢复 / 彻底删除（复制会绕过恢复流程取用已删除文件，查看文件位置会暴露 `assets/trash` 内部路径）。

**收紧为 4 处**：

| 入口 | 修复 |
|---|---|
| `EmojiItemMenu.tsx` trash 分支 | 移除 复制到剪贴板 / 查看文件位置 两个菜单项，只留 从回收站恢复 / 彻底删除 |
| `EmojiGridItem.tsx` 悬浮按钮组 | trash 视图隐藏「复制」按钮（悬浮组只剩「更多」） |
| `EmojiGridItem.tsx` `useClickIntent.onSingle` | trash 视图普通单击从「延迟复制」退化为 replace 选中（方便连点后走批量条/菜单），双击预览不变 |
| `EmojiPreviewDialog.tsx` | 新增 `readOnly` prop（App 按 `currentView === "trash"` 传入）：隐藏 收藏/复制 按钮，只留关闭 |

批量条（trash 模式本来就只有 恢复/彻底删除）与键盘 Delete（trash 视图豁免）无需改动。验证：`npm run build` + `npx vitest run` 35/35 ✅。

## 后续修复（2026-09-01）：通知模型统一

**问题**：主窗口成功/提示走右上角 Toast，**失败却走顶部常驻红色 MessageBar**（`LibraryMessage`）——同一操作的成功与失败出现在两个不同的视觉通道（用户在回收站复制失败时抓到）。根源还在于 App 的 `setError` 实际是 `useLibraryImport` 的内部 state，所有错误都写进这个导入 hook 再由 `EmojiLibraryView.error` 渲染，语义混乱。

**通知出口盘点（收敛前）**：

| 通道 | 用途 | 收敛后 |
|---|---|---|
| Toast（Toaster 右上角，主窗口 + 浮层） | 成功/提示 | 成功/提示/**失败**（唯一全局通道） |
| `LibraryMessage` 顶部红色 MessageBar | 主窗口全部失败（17 处 `setError`） | **移除** |
| 弹窗内联（MessageBar / error span） | 表单提交错误 | 保留（上下文局部） |
| 浮层 footer 红字（`copyError` / 查询错误） | 流程内状态 | 保留（上下文局部，`role="alert"`） |

**变更**：

1. `App.tsx` 新增 `notifyError(message)`（`useCallback`，`intent: "error"` + `timeout: 7000`）；17 处 `setError` 调用与相应 deps 全部替换。
2. `useLibraryImport(onError)` 改为回调式上抛，删除内部 `error` state 与 `setError`（该 hook 只被 App 使用）。
3. `EmojiLibraryView` 删除 `error` / `onClearError` props 与 `LibraryMessage` 渲染；status 区只剩导入 `ProgressBar`。`LibraryMessage.tsx` 因此成为孤儿文件（待删）。

验证：`npm run build` ✅ + `npx vitest run` 35/35 ✅。约定已写入 CLAUDE.md「统一通知模型」不变量。

## 后续修复（2026-09-01）：收藏视图刷新 / 切视图闪屏 / 浮层透明圆角

三个 bug 一轮修完。验证：`npm run build` + `npx vitest run` 35/35 + `cargo check` + `cargo clippy -D warnings` ✅。

### 1. 收藏视图不即时刷新

**问题**：收藏视图里取消收藏后，条目仍留在列表里，直到下次切视图/搜索/排序。根因：`toggleFavorite` 只乐观翻转 `currentEmojis` 里的 `isFavorite` 标志 + 维护 `favoriteIds`，但收藏视图的渲染不过滤 `isFavorite`（视图过滤在后端 `search_emojis`），而视图加载 effect 的 deps 不含任何收藏状态；`refreshLibrary` 只更新侧栏计数。

**修复**（`App.tsx::toggleFavorite`）：`await setEmojisFavorite` 成功后，若 `next === false` 且实时视图仍是收藏视图——从 `currentEmojis` 过滤、`viewTotal` 递减、`deselect`（镜像 `performDelete` 的本地剪辑模式；`hasMore` 不动，哨兵自动回填）。移除放在成功之后，回滚路径只需恢复标志翻转。单选星标/右键/批量条/预览弹窗共用此函数，一处覆盖全部入口。

**坑**：`toggleFavorite` 定义在 `useMultiSelection` 之前且 useCallback deps 不含 `currentView`——判定必须走 latest-ref（新增 `currentViewRef`）读实时视图，否则 await 期间切走视图会对新视图的数据误递减 `viewTotal`；`deselect` 同理经 `deselectRef` 转发。

### 2. 切视图闪屏（尤其空视图）

**问题**：切视图的同一渲染里 `resetKey`（`view|query|sort`）已变化，`FadeSnappy key={resetKey} visible appear` 立即重挂载并淡入**旧视图的数据**（fetch 未返回）；数据落地后内容在同一个 key 下无动画突变（空状态尤其生硬）；header 计数（`viewTotal`）窗口期显示旧值。另有启动首帧空状态闪现（数据未落地时 `currentEmojis` 为空，先闪「还没有收藏」再变正确空态/网格）。`viewLoading` state 是死代码（只写不读）。

**修复**：keep-previous + 落地代数 key（`App.tsx` + `EmojiLibraryView.tsx`）：

- 新增 `viewGeneration`（落地代数）与 `lastLandedKeyRef`（上次落地的 `view|query|sort` 复合 key）。视图 effect 成功落地时，只有复合 key 与上次不同才递增 generation——同 key 重拉（recentItems/groups/tags 变化触发，如 recent 视图每次复制、分组改名）原地更新内容、不重播入场动画。
- `EmojiLibraryView` 的 `resetKey` prop 从复合 key 改为 `` `${viewGeneration}` ``：旧内容无动画保留到新数据落地，落地瞬间才 `key` 重挂载 + `FadeSnappy` 淡入（网格与空状态动画一致），`setCurrentEmojis` / `setViewTotal` / `setViewGeneration` 同一次 commit 原子更新。
- 新增 `ready` prop（`viewGeneration > 0`）：落地前内容区渲染 `null`，启动首帧不闪空状态。
- 滚动复位：keep-previous 后旧内容不再被卸载、浏览器不会自动收口 scrollTop，`contentRef` 在 `resetKey` 变化（= 新数据落地）时 `scrollTo(0, 0)`（与 SettingsMenu `panelRef` 同模式）。
- **loadMore 守卫**：`nextOffsetRef` 改 `number | null`，视图 effect 开头置 null、第 1 页落地才赋值；`loadMore` 见 null 直接返回。堵住 keep-previous 窗口期（旧内容 + 新 `hasMore`）哨兵用旧 offset 给新视图拉第 2 页的洞。
- 删除死代码 `viewLoading`。

动效不变式核对：仍是容器层 `key` 重挂载（Phase 18 红线）；loadMore 追加不递增 generation → 追加批次无动画；迟到响应仍由 `viewSeqRef` 丢弃。

### 3. 浮层透明圆角窗口

**需求演进**：去掉浮层 BG2 外衬色环 → 保留圆角 → 去掉投影。最终形态：

- `tauri.conf.json` quick-search：`transparent: true` + `shadow: false`（Windows 分层透明窗口拿不到 DWM 原生投影，且 Win10 上不清除的 DWM 阴影会在圆角外留直角色块，见下）。
- `main.tsx` 按窗口 label 给 `<html>` 挂 `quick-search-window` 类，`global.css` 据此把 html/body/#root 背景置透明（主窗口不受影响）。
- `QuickSearchPanel.tsx`：**无外衬包裹层**，BG1 surface 直接铺满窗口，`borderRadiusXLarge` 圆角 + 1px 描边、无 CSS 投影，圆角外区域透出底层窗口。
- **Windows 10 坑（[tauri#11321](https://github.com/tauri-apps/tauri/issues/11321)，报告者同为 19045）**：透明 + 圆角窗口在 Win10 上四角出现直角色块，Win11 无此问题——DWM 默认阴影未清除所致；且 `tauri.conf.json` 的 `shadow: false` 存在配置时序不生效的情况。修复：`lib.rs::setup` 对浮层窗口**运行时**再调一次 `set_shadow(false)`（幂等，勿删）。窗口配置（transparent/shadow）是窗口创建时生效的属性，改配置必须完全重启 `tauri dev`，Vite HMR 不会重建窗口。

文档同步：CLAUDE.md 的「网格多选」「主窗口分页」「Surface 层级」不变量与 Phase 17 哨兵描述已更新，AGENTS.md 整体覆盖。

## 后续修复（2026-09-01）：主题快速菜单选中行变高

**问题**：主题按钮（`ThemeQuickMenu`）菜单三项里，**选中项（带对勾）比其余两项高 5px**（实测 37 vs 32），用户报告"间距不一样、被选中就会更大一些"。

**根因**（无头浏览器量化复现，Playwright + 独立复现页量取 boundingBox）：对勾放在 `MenuItem` 的 `secondaryContent` 里，Fluent 给该容器设 `line-height: 20px`，但内部 20px 的 inline SVG 按**基线对齐**参与行内布局，把行盒撑到 25px → 选中行内容高 25px，超出 `minHeight: 32px` 的富余，行高变 37px。宽度不受影响（MenuList flex column 拉伸，三项同为 128px——`MenuPopover` 是 `width: max-content`，按最宽行取宽）。

**修复**（`ThemeQuickMenu.tsx`）：对勾加 `style={{ display: "block" }}`，SVG 脱离基线对齐，行盒回到 20px，三项全部 32px。复现页实测通过。

**备选方案（未采用）**：Fluent `MenuItem` 有内置 `checkmark` slot，但它在菜单项**左侧**（icon 之前）——只给选中项传会造成左侧列错位，每项都传需要空占位，且会改变现有"右侧对勾"的设计。`display: block` 是保持视觉的最小改动。

**排查方法备忘**：组件是纯前端结构，可脱离 Tauri 在独立复现页（同结构 JSX + `FluentProvider`）里用 `playwright-core`（`--no-save` 安装，`channel: "msedge"` 免下载浏览器）截图并量取子元素盒高定位——比启动整个 `tauri dev` 快得多。
