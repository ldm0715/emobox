# 表情匣

表情匣（内部名 EmoBox）是一个 Windows 优先的本地表情资产管理与快捷搜索工具。应用使用 Tauri v2、React、TypeScript 和 Fluent UI React v9 构建，图片保留在用户选择的原始目录中。

## 主窗口信息架构

主窗口采用 Windows 11 风格的固定双栏布局：

- 顶部工具栏：侧栏折叠、应用标识、搜索、唯一导入菜单和主题快速切换；
- 左侧资料库：全部表情、最近使用、收藏、我的分组、快捷键说明和设置；
- 中央内容区：表情网格、排序、网格密度、导入状态和空状态；
- 设置 Dialog：常规、快捷键、存储与导入、关于；
- 独立快捷搜索浮层：全局快捷键唤出、文件名过滤、键鼠选择和表情预览。

项目统一使用 Fluent UI design tokens、`makeStyles` 和 Fluent React Icons，不使用 Tailwind CSS 或其他图标库。

## 唯一导入入口

导入功能统一由以下组件提供：

```text
src/features/import/ImportMenu.tsx
```

同一个 `ImportMenu` 被复用于：

- 顶部工具栏的“导入”；
- 空状态中央的“导入表情”。

内容标题栏和侧栏不再提供重复导入入口。

当前菜单状态：

| 操作 | 状态 |
|---|---|
| 导入图片 | 未实现，disabled |
| 导入文件夹 | 已实现 |
| 从剪贴板收藏 | 未实现，disabled |

## 侧栏折叠

顶部左侧按钮用于折叠或展开固定侧栏，不使用移动端抽屉导航。

展开状态约 `232px`：

- 显示图标、导航文字、分组标题、快捷键说明和“设置”；

收起状态约 `56px`：

- 只显示导航图标、分组图标、Keyboard 图标和 Settings 图标；
- 图标通过 Fluent Tooltip 提供完整说明；
- 应用名称隐藏，中央表情网格自动获得更多宽度。

折叠状态保存到：

```text
localStorage: emobox.settings
```

## 主题

顶部工具栏提供主题快速菜单：

```text
跟随系统
浅色
深色
```

设置 Dialog 的“常规 > 主题”使用同一份持久化状态，修改任一入口都会立即同步到：

- FluentProvider；
- Tauri 原生标题栏；
- `localStorage: emobox.settings`。

同一设置对象还保存：

- 侧栏折叠状态；
- 默认启动页面；
- 快速搜索全局快捷键。

## 设置结构

设置入口位于左侧栏最底部。

### 常规

- 主题；
- 关闭窗口时最小化到系统托盘：托盘未实现，因此 disabled；
- 默认启动页面；
- 快速搜索全局快捷键。

### 快捷键

- `Ctrl + Alt + Space`：快速搜索默认全局快捷键，可在设置中录制或直接编辑；
- `Ctrl + Alt + S`：从剪贴板收藏，当前尚未实现；
- 打开独立快捷搜索浮层按钮；
- 快捷键注册状态与失败原因。

### 存储与导入

- 当前表情素材目录；
- 在资源管理器中打开：当前未实现，disabled；
- 当前导入与索引方式；
- 支持格式。

### 关于

- 表情匣 / EmoBox；
- 版本号；
- 隐私说明；
- 已实现和未实现能力。

## UI 目录

```text
src/
├─ App.tsx
├─ app/
│  ├─ AppShell.tsx
│  ├─ AppToolbar.tsx
│  ├─ LibrarySidebar.tsx
│  ├─ ThemeQuickMenu.tsx
│  └─ SettingsMenu.tsx          # 导出 SettingsDialog
├─ components/
│  ├─ AppIcon.tsx
│  └─ ThemeProvider.tsx         # 主题和应用设置状态
├─ features/
│  ├─ import/
│  │  ├─ ImportMenu.tsx
│  │  └─ useLibraryImport.ts
│  ├─ library/
│  │  ├─ EmojiLibraryView.tsx
│  │  ├─ LibraryHeader.tsx
│  │  ├─ EmojiGrid.tsx
│  │  ├─ EmojiGridItem.tsx
│  │  ├─ EmojiItemMenu.tsx
│  │  ├─ EmptyLibraryState.tsx
│  │  ├─ LibraryMessage.tsx
│  │  └─ useThumbnail.ts
│  └─ search/
│     ├─ QuickSearchWindow.tsx
│     ├─ QuickSearchPanel.tsx
│     ├─ QuickSearchContent.tsx
│     ├─ ShortcutEditor.tsx
│     └─ useSearchKeyboard.ts
├─ config/
│  └─ shortcuts.ts
├─ lib/
│  └─ tauri.ts
├─ styles/
│  └─ global.css
└─ types.ts
```

## 当前已实现

- Tauri v2 Windows 桌面应用；
- Fluent UI 浅色、深色和跟随系统主题；
- 可持久化的侧栏折叠状态；
- 可持久化的默认启动页面；
- Windows 原生文件夹选择器；
- Rust 后台递归扫描；
- PNG、JPG、JPEG、GIF、WebP 索引；
- 损坏图片隔离和日志记录；
- Rust 按需生成缩略图；
- 前端缩略图缓存；
- 表情网格分批渲染；
- 文件名实时搜索；
- `Ctrl+F` 聚焦主窗口搜索框；
- 三档网格密度；
- 名称和格式排序；
- 当前会话收藏；
- 独立快捷搜索浮层窗口；
- `Ctrl + Alt + Space` 全局快捷键唤出 / 隐藏；
- 快捷键设置、持久化和注册失败提示；
- 浮层文件名过滤、鼠标选择、方向键选择、Enter 确认和 Esc 隐藏。

## 尚未实现

- 系统托盘；
- 图片剪贴板复制；
- 单文件导入；
- 从剪贴板收藏；
- 最近使用记录；
- 收藏持久化；
- 分组 CRUD；
- 标签搜索；
- 在资源管理器中打开；
- 删除原始图片；
- 自动切换聊天窗口、自动粘贴或自动发送。

## 快捷搜索说明

默认快捷键集中定义在 `src/config/shortcuts.ts`。Windows 的 `Alt + Space` 会打开系统窗口菜单，因此默认使用 `Ctrl + Alt + Space`。如果快捷键被其他应用占用，主窗口会显示错误 Toast，设置页也会保留可见的失败原因；注册失败的修改不会覆盖上一个已生效的快捷键。

当前 Enter 或鼠标点击只确认选中并隐藏浮层，不执行剪贴板复制、自动粘贴或自动发送。

未接入的功能会隐藏或显示为 disabled，不会伪装成可用功能。

## 环境要求

- Windows 10 或 Windows 11；
- Microsoft Visual Studio C++ Build Tools；
- Microsoft Edge WebView2 Runtime；
- Node.js 22 或兼容版本；
- Rust stable，目标为 `x86_64-pc-windows-msvc`。

## 安装和运行

```powershell
cd "C:\Users\宫城楠木\Desktop\EmoBox"
npm install
npm run tauri dev
```

## 构建和检查

```powershell
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

## 使用目录导入

1. 点击工具栏“导入”或空状态“导入表情”；
2. 选择“导入文件夹”；
3. 选择包含表情图片的目录；
4. 应用递归扫描目录及子目录；
5. 完成后显示导入数量 Toast；
6. 损坏或不支持的文件不会中断扫描。

支持格式：

```text
png
jpg
jpeg
gif
webp
```

## 已知限制

- 扫描结果只保存在当前运行内存中；
- 收藏只在当前会话有效；
- GIF 缩略图显示静态帧；
- 缩略图尚未使用磁盘缓存；
- Fluent UI bundle 会触发 Vite 的 500 kB chunk warning，但不影响构建；
- 微信、QQ、飞书的图片剪贴板兼容性尚未验证。

完整手工检查见 [MANUAL_ACCEPTANCE.md](./MANUAL_ACCEPTANCE.md)。
