# Windows 图片剪贴板复制实现说明

> 完成日期：2026-08-24
> 阶段：第三阶段
> 范围：搜索浮层图片复制、GIF 降级策略、成功/失败反馈、最近使用记录
> 不包含：自动粘贴、自动发送、最近使用持久化、从剪贴板收藏

## 1. 实现目标

用户在快捷搜索浮层中点击图片，或使用方向键选中后按 Enter，应用会把真正的图片数据写入 Windows 系统剪贴板。

本阶段要求：

- 不复制本地文件路径、`file://` URL 或纯文本；
- 优先保证 PNG、JPG/JPEG；
- WebP 转换为目标应用更容易识别的静态图片数据；
- GIF 明确采用首帧策略，不伪装成保留动画；
- 剪贴板实现封装在独立 Rust service 中；
- 成功后显示状态、更新最近使用并隐藏浮层；
- 失败时显示错误，浮层保持打开。

## 2. Tauri v2 API 与依赖

项目原有 `image` 依赖已经启用以下格式：

```toml
image = { version = "0.25", default-features = false, features = ["png", "jpeg", "gif", "webp"] }
```

本阶段新增官方 Tauri v2 剪贴板插件：

```toml
tauri-plugin-clipboard-manager = "2"
```

`Cargo.lock` 当前解析版本：

```text
tauri-plugin-clipboard-manager 2.3.2
```

插件在 `src-tauri/src/lib.rs` 中初始化：

```rust
.plugin(tauri_plugin_clipboard_manager::init())
```

能力配置只开放图片写入：

```json
"clipboard-manager:allow-write-image"
```

前端不直接调用插件命令，而是调用项目自定义的 `copy_image_to_clipboard` command。实际剪贴板访问由 Rust service 完成。

## 3. 模块结构

```text
React 快捷搜索窗口
  |
  | copy_image_to_clipboard(path)
  v
Tauri command
  |- 校验图片属于当前索引
  |- 调用 ClipboardService
  |- 更新 RecentImagesState
  `- 向 main 窗口发送 image-copied 事件
       |
       v
Rust ClipboardService
  |- 读取原始文件
  |- 按格式解码
  |- 转换为 RGBA
  `- 写入 Windows 图片剪贴板
```

剪贴板 service 位于：

```text
src-tauri/src/clipboard.rs
```

该文件不依赖 React 组件，也不负责窗口显隐或 Toast。

## 4. 图片写入方式

核心流程：

1. 根据扩展名识别 PNG、JPEG、WebP 或 GIF；
2. 再次检查源文件是否存在；
3. 读取文件字节；
4. 使用 `image` crate 解码；
5. 转换为 RGBA 像素；
6. 创建 `tauri::image::Image`；
7. 通过 `ClipboardExt::write_image` 写入系统剪贴板。

核心代码边界：

```rust
let image = Image::new_owned(rgba, width, height);
app.clipboard().write_image(&image)?;
```

因此剪贴板中保存的是图片像素数据，不是路径字符串，也不是原始图片文件的拖放引用。

## 5. 各格式行为

| 源格式 | 当前处理 | 写入结果 | 动画 |
|---|---|---|---|
| PNG | 解码为 RGBA | Windows 原生图片数据 | 不适用 |
| JPG/JPEG | 解码为 RGBA | Windows 原生图片数据 | 不适用 |
| WebP | 解码并转换为静态 RGBA | Windows 兼容静态图片数据 | 不适用 |
| GIF | 使用 GIF decoder 读取第一帧 | Windows 原生静态图片数据 | 不保留 |

### PNG

PNG 不会被复制为文件路径。透明通道会进入 RGBA 数据，但目标应用是否保留透明效果取决于其粘贴实现。

### JPG/JPEG

JPEG 解码后写入像素数据。原始 JPEG 压缩数据、EXIF 和其他文件元数据不会写入剪贴板。

### WebP

WebP 不以 WebP 文件格式写入剪贴板。应用先解码，再写入 Windows 兼容的静态图片数据，避免目标软件必须支持 WebP。

成功消息：

```text
WebP 已转换为 Windows 兼容的静态图片数据。
```

### GIF

当前明确采用首帧策略：

- 使用 `GifDecoder`；
- 只读取 `into_frames()` 的第一帧；
- 不写入动画 GIF 文件数据；
- 不承诺动画粘贴。

成功消息：

```text
GIF 已按首帧复制，动画不会保留。
```

## 6. Tauri command 与索引校验

自定义 command 位于：

```text
src-tauri/src/commands.rs
```

命令名称：

```text
copy_image_to_clipboard
```

前端不能通过该命令复制任意路径。Rust 会先从 `LibraryIndexState` 中查找完全匹配的图片记录；路径不属于当前索引时返回错误：

```text
这张图片不在当前索引中，请重新导入文件夹后再试。
```

复制时还会重新读取源文件，因此导入后被移动、重命名、锁定或损坏的图片会返回错误，而不是写入过期路径。

## 7. 搜索浮层交互

相关文件：

```text
src/features/search/QuickSearchWindow.tsx
src/features/search/QuickSearchPanel.tsx
src/features/search/QuickSearchContent.tsx
src/features/search/useSearchKeyboard.ts
```

### 鼠标路径

1. 点击图片；
2. 禁用搜索框和结果按钮，阻止重复复制；
3. 调用 Rust command；
4. 成功时显示 Toast；
5. 约 500ms 后隐藏浮层。

### 键盘路径

1. 使用方向键选择图片；
2. 按 Enter；
3. 执行与鼠标点击相同的复制流程。

### 成功行为

- 显示图片名称；
- 显示格式相关说明；
- 更新最近使用；
- 向主窗口发送 `image-copied` 事件；
- 隐藏快捷搜索浮层。

### 失败行为

- 显示错误 Toast；
- 浮层底部保留可见错误；
- 恢复搜索和结果按钮；
- 不关闭浮层；
- 不更新最近使用。

## 8. 最近使用记录

后端新增：

```text
RecentImagesState
```

当前规则：

- 仅记录复制成功的图片；
- 最新复制项放到第一位；
- 相同路径自动去重；
- 重复复制会把已有项移动到第一位；
- 最多保留 50 项；
- 当前只保存在应用进程内存中。

主窗口监听：

```text
image-copied
```

收到事件后立即更新最近使用视图，无需重新扫描目录。

重启应用后最近使用会清空，这是当前已知限制，不属于持久化实现。

## 9. 错误处理

可能错误包括：

- 图片已经不存在；
- 文件无法读取；
- 扩展名不支持；
- 图片内容无法解码；
- Windows 剪贴板写入失败；
- 图片不属于当前索引；
- 最近使用共享状态不可用。

Rust 返回中文用户可读错误，前端通过 Toast 和浮层底部状态展示。

应用不会因为复制失败而自动隐藏浮层，也不会执行自动切换窗口、自动粘贴或自动发送。

## 10. 自动化测试

剪贴板模块测试覆盖：

- 扩展名大小写不敏感；
- PNG 解码和 RGBA 准备；
- JPEG 解码和 RGBA 准备；
- WebP 解码和静态数据准备；
- 双帧 GIF 只选择第一帧；
- GIF 返回 `animationPreserved = false`。

最近使用测试覆盖：

- 重复项去重；
- 重复复制移动到第一位；
- 50 项上限。

已执行：

```powershell
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git diff --check
```

结果：

- TypeScript 检查通过；
- Vite 生产构建通过；
- Rust fmt、check 和 clippy 通过；
- Rust 单元测试 10 项通过；
- `git diff --check` 通过；
- Vite 仍有 bundle 超过 500 kB 的既有警告，不影响构建。

## 11. 最小手工验收

### PNG

1. 在快捷搜索中复制 PNG；
2. 粘贴到画图；
3. 确认显示实际图片而不是路径或文件图标。

### JPG/JPEG

1. 复制 JPG/JPEG；
2. 粘贴到画图；
3. 检查图片内容和尺寸。

### WebP

1. 复制 WebP；
2. 粘贴到画图或其他图片软件；
3. 确认能显示转换后的静态画面；
4. 检查 WebP 转换提示。

### GIF

1. 复制动画 GIF；
2. 检查 Toast 明确说明动画不会保留；
3. 粘贴后确认只显示首帧。

### 记事本

1. 复制任意图片；
2. 在记事本按 `Ctrl+V`；
3. 不应出现本地路径、`file://` URL、文件名或其他文本；
4. 记事本不支持图片时完全没有反应属于正常结果。

### 第三方软件

至少选择一种支持图片粘贴的软件：

- Word；
- 微信；
- QQ；
- 飞书；
- 其他图片编辑或聊天软件。

### 失败路径

使用测试图片副本，不操作用户原始图片：

1. 导入测试目录；
2. 在外部重命名测试副本；
3. 再次从浮层复制；
4. 确认显示错误且浮层不关闭；
5. 确认失败项没有加入最近使用。

## 12. 当前已验证行为

自动化验证已经确认：

- PNG、JPEG、WebP 能被解码并准备为 RGBA 图片数据；
- GIF 明确只选择第一帧；
- GIF 动画状态返回 `false`；
- 最近使用能够排序、去重和限制数量；
- 前后端能够通过生产构建和 Rust 静态检查。

尚未由自动化验证：

- 画图实际粘贴结果；
- 记事本不出现文本；
- Word、微信、QQ、飞书等目标软件兼容性；
- 不同目标软件对 PNG 透明通道的处理。

这些项目必须按手工验收清单判断，不能仅凭 API 调用成功宣称兼容。

## 13. 已知限制

- GIF 只复制首帧，不保留动画；
- 最近使用不持久化，应用重启后清空；
- 剪贴板中不包含原始文件格式、EXIF、ICC 等文件元数据；
- PNG 透明度最终效果取决于目标应用；
- 第三方聊天软件兼容性需要逐个实测；
- 应用不会自动粘贴或自动发送。

## 14. 主要文件变更

### 新增

```text
src-tauri/src/clipboard.rs
docs/windows-image-clipboard.md
```

### 重点修改

```text
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/capabilities/default.json
src-tauri/src/commands.rs
src-tauri/src/lib.rs
src/App.tsx
src/types.ts
src/lib/tauri.ts
src/features/library/EmojiLibraryView.tsx
src/features/search/QuickSearchWindow.tsx
src/features/search/QuickSearchPanel.tsx
src/features/search/QuickSearchContent.tsx
README.md
MANUAL_ACCEPTANCE.md
```

## 15. 运行时观察

2026-08-24 的开发运行中，测试目录 `C:\Users\宫城楠木\Pictures\boxtest` 成功索引 4 张图片。

另观察到与本阶段剪贴板无关的窗口拖动权限错误：

```text
window.start_dragging not allowed
```

对应缺少权限：

```text
core:window:allow-start-dragging
```

该问题不影响图片剪贴板写入，但会影响无边框搜索窗口的拖动，需要在后续单独处理。

## 16. 范围确认

本阶段没有实现：

- 系统托盘；
- 从剪贴板收藏；
- 自动切换聊天窗口；
- 自动粘贴；
- 自动发送；
- 最近使用磁盘持久化；
- GIF 动画剪贴板格式。

未执行 `git commit` 或 `git push`。
