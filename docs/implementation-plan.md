# EmoBox Tauri v2 POC 实施计划

> 状态：待实施。收到“开始实施”后，按阶段创建和修改代码。
>
> 技术目标：Windows 优先的本地表情包搜索与快捷复制工具；不实现账号、云同步、AI/OCR、自动切回聊天窗口、自动粘贴或自动发送。

## 一、总体方案

本次采用**风险优先、分阶段可运行**的方式实施，不一次性生成全部代码。

- 两个 Tauri 窗口：主窗口 `main`、搜索浮层 `search`
- Rust 负责系统能力：扫描、索引、缩略图、托盘、全局快捷键、剪贴板、窗口显隐
- React 负责界面和交互：主窗口、搜索、虚拟化网格、键盘导航、Toast
- JSON 持久化，并抽象 Repository 接口，方便后续迁移 SQLite
- 原始图片不复制，仅在应用数据目录保存配置、索引、最近使用记录和缩略图缓存
- GIF 首版复制第一帧并显示兼容性提示，不承诺保留动画
- 实施时重新检查 npm/Cargo 当前稳定版本，锁定互相兼容的 Tauri v2、官方插件和前端依赖

整体调用关系：

```text
React UI
  │ Tauri invoke / events
  ▼
Rust Commands
  ├─ LibraryService
  │  ├─ Scanner
  │  ├─ ThumbnailService
  │  └─ LibraryRepository
  ├─ ClipboardService
  │  └─ platform/windows/WindowsClipboardService
  ├─ SearchService
  ├─ WindowService
  ├─ ShortcutService
  └─ TrayService
```

设计原则：

1. 前端不直接递归读取用户目录。
2. 前端不直接操作 Windows 剪贴板。
3. 原始文件路径由 Rust 索引和读取。
4. 前端只接收必要的图片元数据及缩略图地址。
5. Windows 专属实现放入 `platform/windows/`。
6. 所有 Tauri command 返回结构化、用户可读错误。
7. 扫描、图片解码和缩略图生成放到后台任务，避免阻塞 UI。

## 二、计划目录结构

```text
EmoBox/
├─ README.md
├─ MANUAL_ACCEPTANCE.md
├─ package.json
├─ package-lock.json
├─ vite.config.ts
├─ tsconfig.json
├─ index.html
├─ docs/
│  └─ implementation-plan.md
├─ src/
│  ├─ main.tsx
│  ├─ app/
│  │  ├─ App.tsx
│  │  └─ windowRouter.tsx
│  ├─ features/
│  │  ├─ main-window/
│  │  │  ├─ MainWindow.tsx
│  │  │  └─ components/
│  │  └─ search-overlay/
│  │     ├─ SearchOverlay.tsx
│  │     ├─ SearchInput.tsx
│  │     ├─ EmojiGrid.tsx
│  │     └─ CopyToast.tsx
│  ├─ components/
│  ├─ hooks/
│  ├─ lib/
│  │  ├─ commands.ts
│  │  └─ errors.ts
│  ├─ types/
│  │  └─ library.ts
│  └─ styles/
│     └─ index.css
└─ src-tauri/
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json
   ├─ capabilities/
   │  ├─ main.json
   │  └─ search.json
   ├─ icons/
   └─ src/
      ├─ main.rs
      ├─ lib.rs
      ├─ app_state.rs
      ├─ error.rs
      ├─ commands/
      │  ├─ mod.rs
      │  ├─ library.rs
      │  ├─ search.rs
      │  ├─ clipboard.rs
      │  └─ window.rs
      ├─ domain/
      │  ├─ models.rs
      │  ├─ repository.rs
      │  └─ clipboard.rs
      ├─ infrastructure/
      │  ├─ json_repository.rs
      │  ├─ scanner.rs
      │  └─ thumbnails.rs
      ├─ services/
      │  ├─ library_service.rs
      │  ├─ search_service.rs
      │  └─ window_service.rs
      ├─ platform/
      │  ├─ mod.rs
      │  ├─ windows/
      │  │  ├─ mod.rs
      │  │  ├─ clipboard.rs
      │  │  └─ window_focus.rs
      │  └─ macos/
      │     └─ mod.rs
      ├─ shortcut.rs
      └─ tray.rs
```

`platform/macos/` 首期只保留扩展边界，不实现 macOS 功能。

## 三、窗口设计

### 1. 主窗口 `main`

配置方向：

- 标题：`表情匣 EmoBox`
- 正常窗口，启动时显示
- 点击关闭按钮时拦截关闭事件并隐藏窗口
- 进程和系统托盘继续运行

主窗口展示：

- “选择表情包目录”按钮
- 当前目录
- “重新扫描”按钮
- 扫描状态和进度
- 已索引数量
- 最近使用 20 项
- `Alt + Space` 快捷键提示
- “打开搜索面板”测试按钮
- 快捷键注册失败时的明确错误提示

### 2. 搜索浮层 `search`

配置方向：

```text
visible: false
decorations: false
alwaysOnTop: true
skipTaskbar: true
resizable: false
width: 680
height/max-height: 520
shadow: true
```

同一个 React 入口根据当前窗口标签渲染 `MainWindow` 或 `SearchOverlay`，避免维护两套前端构建入口。

浮层显隐统一走 Rust：

```text
toggle_search_window()
show_search_window()
hide_search_window()
```

显示时执行：

1. 显示窗口；
2. 恢复最小化状态；
3. 置顶；
4. 尝试获得焦点；
5. 通知前端重置搜索状态；
6. 前端自动聚焦搜索框。

优先使用 Tauri 的跨平台窗口 API。只有实际验证发现 Windows 抢焦点失败，才在 `platform/windows/window_focus.rs` 增加最小化 Win32 补偿逻辑。

## 四、目录选择与扫描

目录选择优先使用 Tauri v2 官方 dialog 插件。

扫描流程：

```text
选择目录
  ↓
保存目录配置
  ↓
启动后台扫描任务
  ↓
递归枚举文件
  ↓
扩展名过滤
  ↓
尝试解码并读取尺寸
  ↓
损坏文件：记录日志并跳过
  ↓
生成或复用缩略图
  ↓
写入 JSON 索引
  ↓
发送扫描完成事件
```

支持扩展名：

```text
png
jpg
jpeg
gif
webp
```

处理规则：

- 扩展名大小写不敏感。
- 符合扩展名但无法解码的文件视为损坏文件。
- 单个文件失败不影响整个扫描。
- 日志记录文件路径及失败原因。
- 扫描期间主窗口保持可操作。
- 防止重复启动多个扫描任务。
- 前端显示已发现数量、已成功索引数量、已跳过数量和当前阶段。

索引字段：

```rust
ImageItem {
    id,
    file_name,
    file_path,
    extension,
    width,
    height,
    file_size,
    modified_at,
    thumbnail_path,
}
```

`id` 使用路径和文件状态生成稳定标识，避免仅依赖数组下标。

## 五、缩略图方案

不直接让 WebView 批量读取用户原始目录。

计划：

1. Rust 解码原始图片；
2. 生成约 `192×192` 或 `256×256` 的等比例缩略图；
3. 保存到应用数据目录下的 `thumbnails/`；
4. 索引只记录缩略图路径；
5. 前端只加载当前可视区域内的缩略图。

大致数据目录：

```text
%APPDATA%/com.emobox.app/
├─ settings.json
├─ library-index.json
├─ recent.json
├─ logs/
└─ thumbnails/
```

具体路径由 Tauri `app.path()` 解析，不手写 `%APPDATA%` 绝对路径。

前端计划通过 Tauri asset protocol 加载缩略图，并只授权应用自己的缩略图目录，不授权用户选择的整个原图目录。如果实施时当前版本的动态 scope 行为不够稳定，则降级为 Rust command 返回二进制缩略图、前端生成临时 Blob URL；不会一次性把大量 Base64 数据塞入 JSON。

## 六、搜索和网格性能

### 搜索规则

第一版不做拼音、分词、OCR 或语义搜索。

- 中文：直接 `contains`
- 英文：转小写后进行大小写不敏感子串匹配
- 文件扩展名不参与主要匹配
- 排序优先级：完全匹配、文件名开头匹配、普通子串匹配、最近使用时间、文件名稳定排序

空搜索：

1. 最近使用项优先；
2. 不足时补充索引中的前若干项。

### 渲染控制

- 使用虚拟化网格，只挂载可视区域附近的图片。
- 搜索结果设置合理上限，例如首批 200 项。
- 必要时支持滚动继续加载。
- 缩略图使用固定尺寸，避免布局抖动。
- 图片加载失败显示占位图，不让网格崩溃。

### 键盘导航

按当前列数计算选中项：

- `Left`：`index - 1`
- `Right`：`index + 1`
- `Up`：`index - columnCount`
- `Down`：`index + columnCount`
- `Enter`：复制当前项
- `Esc`：隐藏浮层

选中项变化时自动滚动到可见区域。

## 七、剪贴板实现

接口抽象：

```rust
pub trait ClipboardService: Send + Sync {
    fn copy_image(&self, path: &Path) -> Result<ClipboardOutcome, AppError>;
}
```

返回结果：

```rust
ClipboardOutcome {
    mode: ClipboardMode,
    message: String,
}
```

可能的模式：

```text
NativeImage
GifFirstFrame
```

Windows 实现放在：

```text
src-tauri/src/platform/windows/clipboard.rs
```

### 静态图片

PNG、JPEG、WebP：

1. Rust 读取原文件；
2. 使用图片解码库转换为 RGBA 像素；
3. 通过 Windows 可用的图片剪贴板接口写入系统剪贴板；
4. 不把纯文本文件路径作为主要结果；
5. Windows 剪贴板暂时被占用时进行少量短间隔重试。

### GIF

首版明确降级：

1. 解码 GIF 第一帧；
2. 将第一帧作为静态图片写入剪贴板；
3. Toast 显示“GIF 已以首帧复制，聊天软件表现可能不同”。

不承诺：

- 保留 GIF 动画；
- 微信、QQ、飞书均识别为动态表情；
- 自动切回聊天窗口；
- 自动粘贴；
- 自动发送。

### 复制成功后的状态更新

1. 更新最近使用记录；
2. 同一文件去重；
3. 放到最近列表顶部；
4. 最多保留 20 条；
5. 写入 JSON；
6. 向主窗口和搜索窗口发送更新事件；
7. 搜索浮层显示短 Toast；
8. 延迟约 500～800ms 后隐藏。

如果复制失败：

- 浮层不隐藏；
- 显示可读错误；
- 不更新最近记录。

## 八、全局快捷键

使用 Tauri v2 官方 global-shortcut 插件，在 Rust 中注册 `Alt+Space`。

处理原则：

- 只响应按下状态，避免按下和释放触发两次。
- 搜索窗口隐藏时显示并聚焦。
- 搜索窗口显示时隐藏。
- 注册失败时不让应用启动失败。
- 主窗口显示注册错误，日志记录原始错误。
- “打开搜索面板”按钮仍可使用。

### 已知冲突

PowerToys Run 等软件可能占用 `Alt+Space`。如果快捷键注册失败，POC 不静默更换默认组合；验收时需关闭冲突软件或修改其快捷键，然后重新启动 EmoBox。

## 九、系统托盘

使用 Tauri v2 原生托盘和菜单能力。

菜单：

```text
打开主窗口
打开搜索面板
────────
退出
```

行为：

- 单击托盘图标：打开主窗口。
- “打开主窗口”：显示并聚焦主窗口。
- “打开搜索面板”：显示搜索浮层。
- “退出”：真正结束进程。
- 主窗口右上角关闭：只隐藏，不退出。

## 十、JSON Repository 设计

接口示意：

```rust
pub trait LibraryRepository: Send + Sync {
    fn load_settings(&self) -> Result<AppSettings, AppError>;
    fn save_settings(&self, settings: &AppSettings) -> Result<(), AppError>;

    fn load_index(&self) -> Result<LibraryIndex, AppError>;
    fn save_index(&self, index: &LibraryIndex) -> Result<(), AppError>;

    fn load_recent(&self) -> Result<Vec<RecentItem>, AppError>;
    fn record_recent(&self, item_id: &str) -> Result<Vec<RecentItem>, AppError>;
}
```

首版实现：

```text
JsonLibraryRepository
```

未来可以替换为：

```text
SqliteLibraryRepository
```

上层 `LibraryService` 和 Tauri commands 不依赖 JSON 文件细节。

写入策略：

- 同一 Repository 内串行写入。
- 先写临时文件，再替换目标文件，降低半写入风险。
- JSON 损坏时返回用户可读错误，同时保留日志证据。
- 不把缩略图二进制写入 JSON。

## 十一、错误和日志

统一错误类型：

```rust
AppError {
    code,
    message,
    detail,
}
```

主要错误码：

```text
DIRECTORY_NOT_SELECTED
DIRECTORY_NOT_FOUND
SCAN_ALREADY_RUNNING
SCAN_FAILED
INDEX_READ_FAILED
INDEX_WRITE_FAILED
IMAGE_DECODE_FAILED
THUMBNAIL_FAILED
CLIPBOARD_BUSY
CLIPBOARD_UNSUPPORTED
CLIPBOARD_COPY_FAILED
SHORTCUT_REGISTRATION_FAILED
WINDOW_OPERATION_FAILED
```

日志覆盖：

- 应用启动；
- 配置和索引加载；
- 快捷键注册；
- 托盘创建；
- 扫描开始、完成和耗时；
- 每个被跳过的损坏文件；
- 缩略图生成错误；
- 剪贴板失败；
- 窗口显示和聚焦失败。

前端只直接展示用户可读的 `message`，详细技术信息进入日志。单张图片损坏不得导致整个扫描终止。

## 十二、实施阶段

### 阶段 0：环境和版本确认

只检查：

- 当前目录状态；
- Node.js/npm；
- Rust/Cargo/rustup；
- MSVC target；
- Tauri CLI、Cargo crate、官方插件当前稳定版本；
- WebView2 和 Windows 构建前置条件。

不安装全局工具，不修改系统配置。

输出准确版本、缺失项和最小解决步骤。

### 阶段 1：创建可启动的 Tauri 双窗口骨架

内容：

- React + TypeScript + Vite
- Tailwind CSS
- `main` 和 `search` 两个窗口
- 中文基础 UI
- Tauri capabilities
- 基础 Rust command
- `npm run tauri dev` 能启动

验证：

- 主窗口正常显示；
- 测试按钮能显示和隐藏搜索浮层；
- 浮层无边框、置顶且不显示任务栏按钮。

### 阶段 2：先验证高风险剪贴板链路

内容：

- `ClipboardService` trait
- Windows 实现
- PNG/JPEG/WebP 图片复制
- GIF 第一帧降级
- 剪贴板占用重试
- 用户可读错误

验证：

- 选择一张静态图片进行复制；
- 在画图、Word 或其他普通应用按 `Ctrl+V`；
- 单独测试 GIF 第一帧行为。

如果此阶段失败，只调整剪贴板模块，不先大范围开发 UI。

### 阶段 3：目录扫描、索引和缩略图

内容：

- 目录选择；
- 后台递归扫描；
- 图片验证；
- 损坏文件跳过；
- 缩略图缓存；
- JSON Repository；
- 扫描进度事件；
- 主窗口数量展示。

验证：

- 选择混合格式目录；
- UI 不冻结；
- 数量正确；
- 损坏文件不导致扫描失败；
- 重启后能加载已有索引。

### 阶段 4：搜索浮层完整交互

内容：

- 文件名搜索；
- 中文直接匹配；
- 英文大小写不敏感；
- 虚拟化网格；
- 鼠标选择；
- 四方向键；
- Enter 复制；
- Esc 隐藏；
- Toast；
- 复制后更新最近记录。

验证：

- 使用约 1000 张图片的目录测试滚动和搜索；
- 检查界面不会一次性渲染全部缩略图；
- 鼠标和键盘路径均可完成复制。

### 阶段 5：全局快捷键和系统托盘

内容：

- 注册 `Alt+Space`；
- 再次按下切换隐藏；
- 托盘菜单；
- 主窗口关闭到托盘；
- 托盘重新打开；
- 真正退出。

验证：

- 主窗口隐藏后进程仍运行；
- `Alt+Space` 仍能打开搜索；
- 托盘三个菜单项正常；
- 退出后进程结束；
- 快捷键占用时显示明确提示。

### 阶段 6：测试、构建和文档

自动检查计划：

```powershell
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

Rust 单元测试覆盖：

- 扩展名过滤；
- 搜索标准化和排序；
- 最近使用去重与 20 条上限；
- JSON 序列化；
- 缩略图缓存键；
- 损坏文件跳过逻辑。

文档：

- `README.md`
- `MANUAL_ACCEPTANCE.md`

## 十三、关键技术风险

| 风险 | 判断 | 应对 |
|---|---|---|
| `Alt+Space` 被 PowerToys Run 等软件占用 | 高概率环境冲突 | 注册失败不崩溃，显示明确提示，保留主窗口测试按钮 |
| 微信/QQ 的图片剪贴板兼容性 | 无法仅靠 API 保证 | 先验证普通应用；静态图写真实图片；README 明确聊天软件待实测 |
| GIF 动画复制 | POC 不值得引入复杂多格式 Win32 剪贴板实现 | 首版只复制第一帧并提示 |
| 搜索窗口抢不到焦点 | Windows 可能限制前台切换 | 先用 Tauri API，实测失败再加隔离的 Win32 补偿 |
| 无边框窗口圆角和阴影 | Windows 10/11 表现可能不同 | 使用 Tauri 原生能力，接受轻微边缘差异，不做高风险窗口 Hack |
| 1000 张图片扫描卡顿 | 同步解码会影响体验 | 后台扫描、进度事件、缩略图缓存、虚拟化网格 |
| WebView 直接访问任意本地路径 | 安全范围过大 | 只暴露 app data 下的缩略图，不暴露原始目录 |
| JSON 并发覆盖 | 扫描和最近记录可能同时写入 | Repository 串行化、分文件存储、原子替换 |
| 扫描期间文件被移动或删除 | 常见文件系统竞态 | 单文件失败跳过，复制时再次检查文件是否存在 |
| 中文和长路径 | Windows 必须重点验证 | 后端使用 `PathBuf`，测试中文目录及长路径 |

## 十四、最终手工验收清单

- [ ] `npm install` 成功
- [ ] `npm run tauri dev` 启动应用
- [ ] 主窗口标题为“表情匣 EmoBox”
- [ ] 能选择包含 PNG/JPG/GIF/WebP 的目录
- [ ] 扫描过程中 UI 不冻结
- [ ] 能看到索引数量
- [ ] 损坏图片被跳过且应用不崩溃
- [ ] 搜索面板能展示缩略图
- [ ] `Alt+Space` 能打开搜索浮层
- [ ] 再次按 `Alt+Space` 能隐藏
- [ ] `Esc` 能隐藏
- [ ] 中文文件名可直接搜索
- [ ] 英文搜索大小写不敏感
- [ ] 鼠标点击能复制图片
- [ ] 方向键和 Enter 能复制图片
- [ ] 复制成功后出现 Toast
- [ ] 浮层随后隐藏
- [ ] 在画图、Word 等普通应用中 `Ctrl+V` 能粘贴图片
- [ ] GIF 显示第一帧兼容提示
- [ ] 主窗口最近使用中出现刚复制的图片
- [ ] 最近记录重启后仍存在
- [ ] 关闭主窗口后应用仍在托盘
- [ ] 托盘“打开主窗口”正常
- [ ] 托盘“打开搜索面板”正常
- [ ] 托盘“退出”真正结束进程
- [ ] README 明确说明不自动粘贴、不自动 Enter、不保证 GIF 动画及微信/QQ兼容性

## 十五、阶段报告约定

每个阶段结束后固定报告：

1. 修改或新增了哪些文件；
2. 已执行哪些检查；
3. 当前如何运行；
4. 本阶段验证结果；
5. 尚未验证的问题；
6. 下一阶段准备做什么。

未获得明确要求前，不执行 `git commit` 或 `git push`。
