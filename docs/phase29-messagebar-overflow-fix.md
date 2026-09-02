# Phase 29：MessageBar 溢出修复与工具栏品牌字样移除（2026-09-02）

两处小改动：设置弹窗快捷键错误条溢出修复、主窗口工具栏 "EmoBox" 字样移除。

## 1. ShortcutEditor 错误 MessageBar 溢出窗口

### 现象

快捷键冲突时（如录入被其他程序占用的组合键），设置弹窗里 ShortcutEditor 的错误
MessageBar 以**单行**画出卡片与弹窗边界，长文案（Rust 侧
`"无法注册快捷键 {normalized}。它可能已被 Windows 或其他应用占用：{error}"`、
`"新快捷键已注册，但旧快捷键无法注销，请重启应用或重新录制：{error}"`）不可读。

### 根因：Fluent MessageBar 的单行 nowrap + reflow 检测被外层 auto 轨道破坏

- `@fluentui/react-message-bar@9.7.5` 的 MessageBar 根元素默认样式是
  **`white-space: nowrap`**（单行基准），靠 `useMessageBarReflow` 的 ResizeObserver
  检测 `borderBox inlineSize < scrollWidth` 才切到 multiline（`white-space: normal`）。
- `ShortcutEditor.tsx` 的 `root` 样式原本是 `display: grid` 且**无显式列定义**——
  auto 轨道的 min-sizing = 内容 min-content，nowrap 长文案把轨道撑到整句宽度，
  MessageBar 自身 `inlineSize == scrollWidth`，**reflow 永不触发**，
  单行错误条溢出容器（surface `overflow: hidden`，视觉即"超出窗口"）。
- 中间容器链（`settingRowStack` 的 `minmax(0, 1fr)` 列、`shortcutItem` flex column）
  交叉轴 stretch 不受 `min-width: auto` 影响，不是问题所在；问题只在
  `ShortcutEditor` 自己的 auto 轨道。

### 修复

`src/features/search/ShortcutEditor.tsx` 的 `useStyles.root` 加一行：

```ts
root: {
  display: "grid",
  // MessageBar 单行模式 nowrap，auto 轨道会被长错误文案的 min-content 撑开、
  // 令其 reflow 多行检测失效并溢出容器；钉死轨道宽度让 reflow 正常切多行。
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: tokens.spacingVerticalM,
},
```

**不要**用覆盖 `whiteSpace: "normal"` 的方式修——那会绕过 Fluent 单行/多行
状态机（multiline 模式连 grid-template-areas 布局都不同），应让 reflow 自己触发。

实测验证（headless 浏览器模拟同容器链测量）：修复前 MessageBar 宽 1052px、
超出 560px 卡片；修复后宽度被约束到容器宽（504px），reflow 条件成立。

同页面右上角 Toast 通道（同一错误也弹 Toast，`App.tsx::showShortcutError` 双通道）
无此问题：Fluent Toaster 固定 292px 宽、自带换行，未改动。

### 通用规则

**给 Fluent MessageBar（或任何 nowrap 自适应组件）当容器的 grid，必须显式
`gridTemplateColumns: "minmax(0, 1fr)"`，不能用 auto 轨道**——auto 轨道被
min-content 撑开后，组件自身的"宽度不够就换行"检测永远不成立。
TagPickerDialog / MoveToGroupDialog / GroupIconPickerDialog 的 MessageBar 父容器
是 flex column（宽度受 DialogBody 约束），无此问题。

## 2. 工具栏 "EmoBox" 字样移除

`src/app/AppToolbar.tsx`：品牌区（左端）只保留「展开/收起侧栏」图标按钮，
删除 `{!sidebarCollapsed && <span className={styles.title}>EmoBox</span>}`
及只被它使用的 `title` 样式。应用名仍由任务栏/标题栏/设置弹窗品牌行承载。

## 3. Release 资产精简：移除 `.sha256` sidecar，校验和进 Release 正文（2026-09-02）

**动机**：应用内更新只消费 `latest.json` 里的 `sha256` 字段（updater.rs 边下边算
比对），Release 页面上的三个 `.sha256` sidecar 文件一个都不被应用读取——纯冗余；
其中 `latest.json.sha256` 更是连手动下载者都极少需要。改为在 Release 正文末尾
追加「校验和（SHA-256）」markdown 表格（setup.exe + 便携 zip，含大小），
手动下载者直接在页面上核对。

**改动**（`.github/workflows/release.yml`）：

- 原「Package portable zip and checksums」步骤拆成两步：`Package portable zip`
  （只打包）+ `Append checksums to release notes`（生成表格并 `Add-Content` 追加）。
- **步骤顺序承重**：「Write release notes from latest.json」（`Set-Content`
  **覆写** release-notes.md）必须在「追加校验和」**之前**——反了会把表格冲掉。
- `files:` 上传列表从 6 项减为 3 项（setup.exe / latest.json / zip）。
- README 下载安装节的校验说明同步指向正文表格。

已按真实步骤顺序在本地 pwsh 端到端重放验证（正文 + 表格落盘正确）。

## 4. README 底部「许可证与依赖」

原「## 📄 许可证」一节一句话致谢展开为「## 📄 许可证与依赖」：GPL-3.0 声明 +
6 个核心项目表格（Tauri / Rust / React / Fluent UI / Vite / TypeScript，链接与
说明和关于页 `aboutDependencies.tsx` 的 `ABOUT_DEPENDENCIES` 同源——README 是
纯 markdown 无法复用运行时 SVG chip 组件，用表格承载同样信息），并指向
`package.json` / `src-tauri/Cargo.toml` 作完整依赖清单。
