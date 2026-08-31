# EmoBox UI 一致性审计报告与分阶段整改计划

> 审计日期：2026-08-31。审计为只读，覆盖 `src/` 全部 22 个 .tsx 组件、`src/styles/global.css`、`src-tauri/tauri.conf.json`。
> 总体结论：**项目 token 化程度很高**（`tokens.*` 384 处 / 18 文件），无系统性暗色模式破损；问题集中在少数残留（原生对话框、旧品牌色、双套重复实现），均属低风险可渐进修复。

---

## 一、审计报告

### 1. Fluent UI 版本 / Provider / 主题切换机制

- `@fluentui/react-components@9.74.6`、`@fluentui/react-icons@2.0.338`、`react@^19.2.8`（`package.json:14-19`）
- `FluentProvider` 挂在 `src/main.tsx:14`，按 `getCurrentWindow().label` 分流 `App` / `QuickSearchWindow` —— **两个窗口各一套独立 React 树 + ThemeProvider**，主题经 `storage` 事件跨窗口同步（`ThemeProvider.tsx:167-173`）
- 主题是**自定义 theme**：`createLightTheme(brand)` / `createDarkTheme(brand)` 基于自定义 `BrandVariants`（蓝色系 #061724→#ebf3fc，`ThemeProvider.tsx:80-109`），覆盖 `fontFamilyBase`（Segoe UI Variable + 微软雅黑）与 `fontFamilyMonospace`（Cascadia Mono）。未用 `webLightTheme/webDarkTheme`，无 custom tokenizer
- 切换机制：`ThemePreference = "light" | "dark" | "system"`，`resolvedTheme` 经 `matchMedia("prefers-color-scheme: dark)")` 计算（`ThemeProvider.tsx:152-175`）；同步三路 —— ① `getCurrentWindow().setTheme()` 原生窗口（传原始偏好，system→null）；② `document.documentElement.style.colorScheme = resolvedTheme`（`ThemeProvider.tsx:187-189`，WebView2 原生滚动条暗色适配的关键）；③ FluentProvider 切组件 CSS 变量。持久化 `localStorage: emobox.settings`，默认 `"light"`
- 全局 CSS 仅 `src/styles/global.css`（39 行），无 CSS 变量定义

### 2. Fluent vs 原生/自定义组件

**Fluent 组件为主体**（22 个 .tsx 全用 Fluent；SearchBox ×4、Dropdown ×3、Switch ×4、Dialog ×6、Menu/Tooltip/Badge/MessageBar/ProgressBar/Spinner/Toaster 全覆盖）。

刻意自定义（多数为有意设计，token 合规）：

| 位置 | 元素 | 性质 |
|---|---|---|
| `LibrarySidebar.tsx:339,363,425,524,558` | 原生 `<button>` + `navItem`/`groupHeaderToggle`/`hintButton` | 有意（Phase 19 统一），token 合规 |
| `SettingsMenu.tsx:640` | 原生 `<button>` + `navItem`（设置左导航） | 有意（Phase 19），token 合规 |
| `QuickSearchContent.tsx:154` | 原生 `<button role="option">` + `item` 类 | 浮层结果行，token 合规 |
| `EmojiGridItem.tsx:237` | `<div role="option">` 卡片 | 有意（全套自定义交互），token 基本合规 |
| `EmojiGridItem.tsx:270` | span + Checkbox 图标拼的勾选框 | 非 Fluent Checkbox |
| `EmojiPreviewDialog.tsx:115` | 自建 `span.chip` | 非 Fluent Badge |

**绕过统一 UI 体系的残留（问题项）**：`window.confirm` ×3 + `window.prompt` ×1（见第 3 节）。

### 3. 各类元素实现一览

| 元素 | 实现 | 位置 | 状态 |
|---|---|---|---|
| 搜索框 | Fluent `SearchBox` ×4（主窗 `AppToolbar.tsx:128`、侧栏 `LibrarySidebar.tsx:403`、浮层 `QuickSearchContent.tsx:228`、图标选择器 `GroupIconPickerDialog.tsx:142`） | — | ✅ 统一 |
| 按钮 | Fluent `Button/MenuButton/ToggleButton` 约 25 处；例外：侧栏/设置导航行、浮层结果行为原生 button（有意） | — | ✅ 基本统一 |
| Select | Fluent `Dropdown + Option` ×3（排序 `LibraryHeader.tsx:130`、主题/默认视图 `SettingsMenu.tsx:389,415`） | — | ✅ |
| Switch | Fluent `Switch` ×4（`SettingsMenu.tsx:408-466`） | — | ✅ |
| 导航项 | 原生 `<button>` 双套（侧栏 + 设置左导航），同范式重复实现 | — | ⚠️ |
| 表情卡片 | `EmojiGridItem`（div role=option）+ 浮层 `QuickSearchContent.item` —— **双套平行实现** | — | ⚠️ |
| Tag | Fluent `Badge` 为主；例外：`EmojiPreviewDialog` 自建 chip、紧凑密度自建 icon+数字 | — | ⚠️ 轻微 |
| Tooltip/Menu | 全 Fluent（右键菜单共享 Menu + 虚拟定位 `EmojiGrid.tsx:253`） | — | ✅ |
| 弹窗 | Fluent `Dialog` ×6；**例外 4 处原生 `window.confirm/prompt`** | — | ⚠️ |
| 设置页 | 自定义左导航（原生 button）+ Fluent 表单件 + 自建 `card`/`settingRow` 白卡布局（token 合规） | — | ✅ |
| 滚动条 | 侧栏自定 6px WebKit 滚动条（`LibrarySidebar.tsx:206-215`，thumb 用 token）；其余滚动区走原生 + `colorScheme` 适配 | — | ⚠️ 不一致 |
| Toast | Fluent `Toaster` 主窗口 + 浮层各一 | — | ✅ |
| 空状态/加载 | 自建布局 + Fluent `ProgressBar`/`Spinner` | — | ✅ |
| 确认对话框 | `App.tsx:1095,1150` `window.confirm`（移回收站/彻底删除）、`LibrarySidebar.tsx:471` `window.prompt`（重命名分组）、`:482` `window.confirm`（删分组） | — | ❌ |

### 4. 硬编码样式来源（全量统计）

| 类别 | 硬编码数 | 详情 |
|---|---|---|
| 颜色 | 组件/CSS 层 **8 处** | `EmojiGridItem.tsx:114-115,132-136` —— `color:"white"` + `rgba(24,24,27,0.66/0.82)` 悬浮按钮/勾选框深色遮罩（叠在图片上，亮暗主题下视觉均成立，但绕过 token）；`global.css:37-38` —— `::selection { color: white; background: #7450b8 }`，**全项目唯一 hex 颜色残留，且 #7450b8 是旧品牌紫，与现品牌蓝 #0f6cbd 系不符** |
| 主题定义层 | 16 处 | `ThemeProvider.tsx:81-96` BrandVariants —— 合法（本就是定义 token 处） |
| 阴影 | **0 处** | 4 处全 token（`shadow16`/`shadow2` + 2 处 token 拼接的选中描边） |
| 边框色 | 0 处 | 全 token；宽度 5 处字面 `1px` 未用 `tokens.strokeWidthThin`（`GroupIconPickerDialog.tsx:43,73`、`GroupDialog.tsx:71`、`TagPickerDialog.tsx:42`、`MoveToGroupDialog.tsx:42`） |
| 圆角 | 1 处 | `LibrarySidebar.tsx:214` 滚动条 thumb `3px`；其余 25 处全 token |
| 间距 | ~14 处 | 多为 `0` reset 与 `2px`/`6px` 微调；`tokens.spacing*` 132 处；布局尺寸字面量 ~30 处（54px 工具栏高、232px 面板宽等，token 本身不覆盖，可接受） |
| 字体 | 1 处 | `LibrarySidebar.tsx:434` icon `fontSize={12}`；其余 ~70 处全 token；`global.css:2` 与 ThemeProvider 的 fontFamilyBase 重复定义 |
| filter/opacity | 0 filter；6 opacity 全为 hover 渐显/禁用语义 | 无暗色隐患 |

### 5. 同类组件多套 CSS 实现检测

| 元素 | 套数 | 位置 |
|---|---|---|
| 侧栏导航行 | **2 套近乎复制** | `LibrarySidebar.tsx:93-140` ↔ `SettingsMenu.tsx:109-151`（同样的 3px 指示条、colorSubtleBackgroundSelected、svg 染色，注释自认同范式） |
| 表情卡片 | **2 套平行** | `EmojiGridItem.tsx:49-75` ↔ `QuickSearchContent.tsx:52-77`（hover/选中/焦点环/图片框逻辑重复，token 用法一致） |
| 可选择列表行 | **2 套逐行相同** | `TagPickerDialog.tsx:37-63` ↔ `MoveToGroupDialog.tsx:37-63`（`row/listScroll/count`） |
| Tag 展示 | 2-3 变体 | Badge 主路径 + 预览弹窗自建 chip + 紧凑密度 icon+数字 |
| 按钮 | Fluent 为主 + 6 个自定义 button class（多为有意导航行） | 可接受 |

### 6. 暗色主题风险点

1. **`global.css:36-39` `::selection` 紫色** —— 两种主题下都用旧品牌紫，与品牌蓝冲突（唯一颜色级问题）
2. **4 处原生 `window.confirm/prompt`** —— 原生系统对话框不跟随应用主题，暗色模式用户弹亮色系统框；`window.prompt` 对中文输入法体验差
3. **启动闪白（潜在）**：`tauri.conf.json:24,44` 两窗口初始 `theme: "Light"` + 默认设置 `"light"`，持久化了 dark 的用户在 React 挂载并 `setTheme` 前会看到一次亮色闪烁
4. **`EmojiGridItem` 深色 scrim** —— 功能上两主题均成立（叠图上），属"有意的例外"
5. 滚动条双轨：侧栏 6px 自定义 vs 其余区域原生默认粗细 —— 视觉不一致但各自正确适配主题
6. 未发现缺失 dark token、错误继承亮色背景、对比度不足的组件

### 7. 问题分级

**P0（主题破损 / 必须修）—— 无。**

**P1（明显不一致 / 用户可感知）**
- ① `global.css:38` `::selection` 旧品牌紫 #7450b8 → 统一为品牌蓝 #0f6cbd
- ② 4 处 `window.confirm/prompt` → Fluent Dialog（重命名分组复用已有 `GroupDialog` 编辑模式，删除/移回收站确认做共享 `ConfirmDialog`）
- ③ 启动主题闪烁：`tauri.conf.json` 两窗口 `theme: "Light"` → 跟随系统

**P2（一致性债务 / 维护性）**
- ④ 侧栏 ↔ 设置左导航 navItem 双套复制 → 抽共享样式模块
- ⑤ 5 处字面 `1px` 边框 → `tokens.strokeWidthThin`
- ⑥ `EmojiPreviewDialog` 自建 chip → Fluent `Badge appearance="outline"`（Badge 截断需 className 覆盖 `display:block`，先例 `EmojiGridItem.tsx:178`）
- ⑦ `EmojiGridItem` ↔ `QuickSearchContent` 卡片样式双套 → 抽共享
- ⑧ `TagPickerDialog` ↔ `MoveToGroupDialog` `row/listScroll/count` 逐行相同 → 抽共享
- ⑨ `global.css:2` 字体栈与 ThemeProvider 重复定义 → 收敛/加注释
- ⑩ 零星字面量（`PinRegular fontSize={12}`、滚动条 `3px` 圆角）→ 顺手统一

**建议保留不动（有意设计，勿"修复"）**：侧栏/设置原生 button 导航行（Phase 19 刻意统一）、`EmojiGridItem` 原生 `title`（性能红线，勿换 Fluent Tooltip）、卡片 scrim 深色遮罩（叠图上双主题均成立）、`EmojiGrid` CSS 变量 `--emoji-tile-size`。

### 8. 涉及文件

- `src/styles/global.css:36-39`（::selection）、`:1-6`（字体栈）
- `src/App.tsx:1095,1150`（window.confirm）
- `src/app/LibrarySidebar.tsx:93-140`（navItem 样式）、`:206-215`（滚动条）、`:434`、`:471,482`（prompt/confirm）
- `src/app/SettingsMenu.tsx:109-151`（navItem 样式）、`:640`（左导航）
- `src/features/library/EmojiGridItem.tsx:114-136`（scrim）、`:178`（Badge 截断先例）
- `src/features/library/EmojiPreviewDialog.tsx:115-125`（chip）
- `src/features/search/QuickSearchContent.tsx:52-77`（卡片样式）
- `src/features/library/TagPickerDialog.tsx:37-63`、`MoveToGroupDialog.tsx:37-63`（row 样式）
- `src/features/library/GroupIconPickerDialog.tsx:43,73`、`GroupDialog.tsx:71`、`TagPickerDialog.tsx:42`、`MoveToGroupDialog.tsx:42`（1px 边框）
- `src-tauri/tauri.conf.json:24,44`（窗口初始 theme）

---

## 二、分阶段整改计划（最小风险，逐阶段可独立验收）

### 阶段 0：主题基础（半天，零功能风险）
1. `global.css:36-39` `::selection` 改为品牌蓝 `#0f6cbd`（CSS 拿不到 token，写字面量并注释与 BrandVariants-80 对应）
2. `tauri.conf.json` 两窗口 `theme` 移除固定 `"Light"`，跟随系统，消除暗色用户启动闪白
3. `global.css:2` 字体栈加注释注明与 `ThemeProvider.fontFamilyBase` 保持同步

验收：`npm run build`；亮/暗各启动一次，暗色启动无白闪；任意页面选中文本为品牌蓝。

### 阶段 1：高频界面对话框统一（1 天）
1. 新建 `src/features/library/ConfirmDialog.tsx`（Fluent Dialog：标题/正文/确认（destructive）/取消），App 的移回收站/彻底删除两处 `window.confirm` 换成状态驱动的 `ConfirmDialog`
2. `LibrarySidebar.tsx:471` 重命名 `window.prompt` → 复用已有 `GroupDialog` 编辑模式
3. `LibrarySidebar.tsx:482` 删除分组 `window.confirm` → 复用 `ConfirmDialog`

注意：CLAUDE.md「回收站确认用 `window.confirm`，无 Fluent Dialog」是现状描述，本阶段变更该约定——完成后同步更新 CLAUDE.md / AGENTS.md。

验收：`npm run build` + `npx vitest run`；手动走批量删除/彻底删除/重命名分组/删除分组，亮暗两主题下弹窗样式一致。

### 阶段 2：通用组件收敛（1 天）
1. 5 处字面 `1px` → `tokens.strokeWidthThin`
2. 抽 `src/app/navItemStyles.ts` 共享模块，`LibrarySidebar` 与 `SettingsMenu` 左导航消费（保留各自差异列，不动布局）
3. `EmojiPreviewDialog` chip → `Badge appearance="outline"` + 截断 className
4. 顺手项：`PinRegular fontSize` 用 token、滚动条 `3px` 注释

验收：`npm run build`；侧栏与设置左导航选中态视觉与改前一致（对比截图）。

### 阶段 3：样式去重（可选，0.5-1 天）
1. `TagPickerDialog` / `MoveToGroupDialog` 的 `row/listScroll/count` 抽共享 styles 模块
2. `EmojiGridItem` / `QuickSearchContent` 卡片共同样式抽共享常量——**不改任何交互逻辑与 props**
3. 同步更新 CLAUDE.md / AGENTS.md 相关段落

验收：`npm run build` + `npx vitest run`；主网格与浮层卡片 hover/选中视觉回归对比。

### 明确不做
- 不把侧栏/设置原生 button 导航行换成 Fluent 组件（Phase 19 有意设计，换动布局盒模型风险大）
- 不给 `EmojiGridItem` 加 Fluent Tooltip / Checkbox（Phase 18 性能红线）
- 不动 `EmojiGridItem` 的 scrim rgba（叠图例外，视觉正确）
- 不引入列表虚拟化或其他重构

## 验证方式

- 每阶段：`npm run build`（tsc + vite）+ `npx vitest run`
- 手动：`npm run tauri dev`，亮/暗主题各走一遍——文本选中颜色、批量删除确认、分组重命名、设置左导航选中态、主网格与浮层卡片 hover/选中
- 阶段 2/3 前后截图对比，确保纯收敛无视觉回归
