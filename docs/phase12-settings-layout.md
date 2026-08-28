# Phase 12：设置界面布局重构

> 实施完成。设置对话框的一次**纯前端布局重构**（`src/app/SettingsMenu.tsx` + `ShortcutEditor.tsx`），把「太挤」的设置界面改成 Fluent v9 的「少边框、多留白」风格：
>
> 1. **全留白分组**：删掉全部 `<Divider />`，用分组小标题 + 留白替代分隔线，每个 tab 按语义分组。
> 2. **字号与间距升档**：分组标题 / 标签 / 描述各升一档字号，行距放宽到 24px。
> 3. **修复内容溢出无滚动条 bug**：Fluent `DialogContent` 自带的 `overflowY: auto` 被覆盖 + grid 行高未约束，导致内容被裁剪且不滚动。
> 4. **导航与内容之间加竖线**，对话框宽度经 840→680→760 三轮调校。
> 5. **顺手修正两处 Phase 8 删除外部索引后的过期文案**。
>
> 期间踩了一个滚动容器被覆盖的坑，见「三、滚动修复」。

---

## 一、用户拍板的关键决策

| 决策 | 选 | 不选 |
|---|---|---|
| 设置项分组风格 | **纯留白分组**：分组小标题 + 大留白，无边框无分隔线（Fluent v9 理念，用户委托我定） | 卡片分组（带边框圆角卡片，Windows 设置风） |
| 分隔线 | **导航与内容之间 1px 竖线**（`navigation` 的 `borderRight`）。用户口语说「横线」，但设置界面是左导航+右内容布局，实际需要的是竖线 | 标题栏下方横线 |
| 对话框宽度 | **760px**（840 太空 → 680 太窄 → 折中 760），高度固定 680px | — |
| 设置行控件对齐 | **保持 Fluent 惯例右对齐**（开关/下拉右缘对齐）；行内「标签↔控件」空隙靠收窄面板缓解 | 控件紧贴标签（会破坏多行右对齐的整齐感） |

---

## 二、布局重构（`src/app/SettingsMenu.tsx`）

### 2.1 对话框结构与尺寸

| 项 | 旧 | 新 |
|---|---|---|
| surface | 780×560 | **760×680**，加 `overflow: hidden`（防御） |
| 导航列宽 | 176px | **200px**，加 `borderRight: 1px solid colorNeutralStroke2` |
| content grid | `176px minmax(0,1fr)`，gap L | `200px minmax(0,1fr)`，gap M，加 `gridTemplateRows: minmax(0,1fr)` |
| panel padding | 仅右 `spacingHorizontalS` | **四周**：纵向 `spacingVerticalXXL` / 横向 `spacingHorizontalL` |
| DialogBody | 默认 | 挂 `body` class：`height: 100%` + `minHeight: 0`（锁进 surface 高度，滚动修复的关键） |

### 2.2 分组结构（替代全部分隔线）

| tab | 分组标题 | 内容 |
|---|---|---|
| 常规 | 外观 | 主题（Dropdown） |
| | 通用 | 关闭窗口时最小化到系统托盘（disabled 占位）、默认启动页面 |
| | 行为 | 选择表情后自动粘贴到打开浮层前的窗口（Switch） |
| 快捷键 | 全局快捷键 | 快速搜索 ShortcutEditor、从剪贴板收藏 ShortcutEditor |
| | 快捷操作 | 打开快捷搜索浮层（按钮） |
| 存储与导入 | 素材库 | EmoBox 素材库（路径 + 打开按钮） |
| | 导入与索引 | 导入与索引方式（Badge）、支持格式（Badge 列表）、隐私段落 |
| 关于 | — | hero（应用名+版本）+ 描述 + 已实现/尚未实现 |

每组是 `<div className={styles.group}>`（flex column + `gap: spacingVerticalXXL`）内 `<h3 className={styles.groupTitle}>` + 若干 `settingRow`。最后一个 group 用 `:last-child` 归零 `marginBottom`。

### 2.3 字号规范（各升一档）

| 元素 | 旧 token | 新 token |
|---|---|---|
| 分组标题 `groupTitle` | `fontSizeBase400` | `fontSizeBase500` |
| 设置项标签 `settingLabel` | `fontSizeBase300` | `fontSizeBase400` |
| 描述 `settingDescription` | `fontSizeBase200` + `lineHeightBase200` | `fontSizeBase300` + `lineHeightBase300` |
| ShortcutEditor `help` | `fontSizeBase200` | `fontSizeBase300` |

### 2.4 间距规范

- 设置行之间：`group` gap `spacingVerticalXXL`（**24px**）；组之间 `marginBottom` 同值。
- 标签与描述：`settingText` 改为 flex column + `gap: spacingVerticalM`（替代旧 `marginTop: "3px"`）。
- `settingRow` 删垂直 padding（行距改由 group gap 提供），`columnGap` 用 `spacingHorizontalXL`。
- 内容区横向距竖线：content gap M + panel 横向 padding L ≈ 20px。

### 2.5 删除的死样式与内联 hack

- 死样式：`panelTitle`、`shortcutRow`、`keyGroup`、`key`（JSX 中从未引用）。
- 内联 hack：`renderShortcuts` 里两处 `style={{ marginTop: tokens.spacingVerticalM }}` 和 Divider 上的 `style={{ marginTop: spacingVerticalL }}` 全部移除，改由 `shortcutItem` / `group` 的 gap 承担。
- import：从 `@fluentui/react-components` 移除 `Divider`（全部 9 处用法删光）。

---

## 三、滚动修复（关键 bug）

**症状**：快捷键 tab 内容超高后被裁掉，没有滚动条。

**根因（三层叠加）**：

1. **覆盖了 Fluent 自带滚动**：`DialogContent` 的 reset styles 自带 `overflowY: auto`（它是 Dialog 的滚动容器），但 `content` class 写了 `overflow: hidden` 把它掐掉。
2. **grid 行高未约束**：`content` 是 grid 容器但只设了列、没设行，行高 `auto` 被内容撑开 → `panel` 的高度永远跟着内容长，`panel` 自己的 `overflowY: auto` 永不触发。
3. **DialogBody 未锁进 surface 高度**：DialogBody 高度由内容决定（`maxHeight` 只相对视口），内容超高时整个 body 撑出 680px 的 surface。

**Fluent Dialog 布局机制**（`@fluentui/react-dialog` 源码）：`DialogSurface` = `display:block` + 固定高；`DialogBody` = grid，`gridTemplateRows: auto 1fr`（第 1 行标题、第 2 行内容），`maxHeight: calc(100vh - 2*24px)`；`DialogContent` = grid 第 2 行 + **自带 `overflowY: auto`**。

**修法（三处）**：

| 处 | 改动 | 作用 |
|---|---|---|
| `surface` | `overflow: hidden` | 防御：任何残余溢出裁剪在圆角内 |
| `DialogBody` | 挂 `body` class：`height: 100%` + `minHeight: 0` | 把 body 精确锁进 surface 高度，使 DialogContent 获得**有界高度** |
| `content` | `gridTemplateRows: minmax(0, 1fr)` | 约束 grid 行，`panel` 拿到有界高度，`overflowY: auto` 正常触发 |

滚动条现在出现在 `panel`（内容列）右侧；左侧导航固定不滚。

---

## 四、过期文案修正（Phase 8 遗留）

外部目录「仅索引原路径」模式已在 Phase 8 整个删除，但设置页两处文案还在提它：

| 位置 | 旧 | 新 |
|---|---|---|
| 存储与导入「导入与索引方式」描述 | 导入图片和拖拽会复制到素材库；导入文件夹只索引外部原路径。 | 导入图片、拖拽或导入文件夹都会复制进素材库；导入文件夹会自动按子文件夹建立同名分组。 |
| 关于「已实现」列表 | 外部文件夹索引、素材库图片导入、… | 素材库图片导入、…（删掉已死的「外部文件夹索引、」） |

---

## 五、关键不变量（Phase 12 新增）

- 设置对话框滚动由 `panel` 提供（`overflowY: auto`）；`content` 保持 `overflow: hidden`，**不要再给 `panel` 钉死高度**（滚动依赖其被 grid 行约束）。
- 设置行控件保持 Fluent 右对齐惯例；行内空隙靠面板宽度控制，不靠改对齐方式。
- 分组用 `<div className={styles.group}>` 而非 `<section>`（panel 本身已是 `<section>`，避免无标题 section 的 axe 警告）。
- `settingRow` / `settingText` 保留 `minmax(0, 1fr)` + `minWidth: 0`：长路径 `pathBox` 才以省略号截断而不撑宽网格。
- 未实现功能继续可见 `disabled`（托盘开关占位保持原样）。

## 六、已知边界 / 风险

- `settingText` 的 flex-gap 替代了多个元素自带的 `marginTop`；若未来把 `settingDescription` / `pathBox` / `formatList` 渲染到 `settingText` 之外，会失去间距——沿用此模式时注意。
- 短屏（`DIALOG_MEDIA_QUERY_SHORT_SCREEN`，约 <400px 高）下 Fluent 会切整页滚动，未做专门适配；对话框有 `calc(100vh - 48px)` 钳制兜底。
- 若日后觉得导航竖线多余，删 `navigation` 的 `borderRight` 并把 content gap 调回 `spacingHorizontalXL` 即可，单行回退。
- 对话框宽度是 840/680/760 三轮用户反馈调校的结果：过宽则行内「标签↔控件」空隙大、过窄则长描述换行密。760 为当前平衡点。

## 七、验证

- `npm run build`（tsc + vite）✅
- `npx vitest run`：**25 passed**（布局改动不影响逻辑测试）✅
- 手动清单：四个 tab 切换正常；快捷键 tab 内容超高时右侧出现滚动条、导航固定不滚；无任何 Divider，只有留白与分组小标题；主题下拉 / 自动粘贴开关仍可用；托盘开关保持 disabled；过期文案已更新。
