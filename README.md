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
- 当前运行期间的最近使用记录；
- 独立快捷搜索浮层窗口；
- `Ctrl + Alt + Space` 全局快捷键唤出 / 隐藏；
- 快捷键设置、持久化和注册失败提示；
- 浮层文件名过滤、鼠标选择、方向键选择、Enter 复制和 Esc 隐藏；
- Rust 独立剪贴板 service，将图片像素数据写入 Windows 系统剪贴板；
- PNG、JPG/JPEG 静态图片复制；
- WebP 解码为 Windows 兼容的静态图片数据后复制；
- GIF 仅复制首帧，并在 Toast 中明确提示动画不会保留。

## 尚未实现

- 系统托盘；
- 单文件导入；
- 从剪贴板收藏；
- 收藏持久化；
- 分组 CRUD；
- 标签搜索；
- 在资源管理器中打开；
- 删除原始图片；
- 自动切换聊天窗口、自动粘贴或自动发送。

## 快捷搜索说明

默认快捷键集中定义在 `src/config/shortcuts.ts`。Windows 的 `Alt + Space` 会打开系统窗口菜单，因此默认使用 `Ctrl + Alt + Space`。如果快捷键被其他应用占用，主窗口会显示错误 Toast，设置页也会保留可见的失败原因；注册失败的修改不会覆盖上一个已生效的快捷键。

当前 Enter 或鼠标点击会先写入图片剪贴板；成功时显示 Toast、更新最近使用并隐藏浮层，失败时显示错误且保持浮层打开。应用不会自动切换聊天窗口、自动粘贴或自动发送。

未接入的功能会隐藏或显示为 disabled，不会伪装成可用功能。

## 图片剪贴板行为

剪贴板实现位于 `src-tauri/src/clipboard.rs`，React 只调用自定义 Tauri command，不直接处理 Windows 剪贴板。

| 源格式 | 当前写入行为 | 动画 |
|---|---|---|
| PNG | 解码为 RGBA 像素并写入 Windows 原生图片剪贴板 | 不适用 |
| JPG/JPEG | 解码为 RGBA 像素并写入 Windows 原生图片剪贴板 | 不适用 |
| WebP | 先解码，再以 Windows 兼容的静态图片数据写入，目标应用不需要识别 WebP 文件格式 | 不适用 |
| GIF | 只解码并复制首帧；成功 Toast 会明确提示此限制 | 不保留 |

写入的是图片数据，不是文件路径、`file://` URL 或纯文本。最近使用按最后复制时间排序、去重，并最多保留 50 条；当前只保存在本次应用运行内存中。

### 最小粘贴验收

1. 导入同时包含 PNG、JPEG、WebP、GIF 的测试目录；
2. 从快捷搜索分别点击图片和使用 Enter 复制；
3. 立即在记事本执行粘贴：不应出现本地路径、`file://` URL 或其他文本；
4. 在画图执行粘贴：应出现实际图片，PNG 透明区域、JPEG 尺寸和 WebP 静态画面应可见；
5. 在 Word、微信、QQ、飞书或其他支持图片粘贴的软件中重复验证；
6. GIF 应只粘贴首帧，浮层 Toast 应显示动画不会保留；
7. 临时移走或锁定源文件后再次复制：应显示错误，快捷搜索浮层不应关闭；
8. 返回主窗口最近使用：复制成功的图片应按最新在前显示。

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
- 最近使用只在当前应用运行期间有效，重启后会清空；
- GIF 缩略图显示静态帧，复制也只保留首帧，不保留动画；
- 缩略图尚未使用磁盘缓存；
- Fluent UI bundle 会触发 Vite 的 500 kB chunk warning，但不影响构建；
- 画图、记事本及第三方聊天软件的实际粘贴兼容性仍需按上面的手工方案验证；当前自动化检查只覆盖解码、首帧策略、编译和单元测试。

完整手工检查见 [MANUAL_ACCEPTANCE.md](./MANUAL_ACCEPTANCE.md)。
