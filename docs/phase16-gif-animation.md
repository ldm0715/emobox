# Phase 16：GIF 动画全链路（悬停播放 / 剪贴板收藏保留动画 / 复制保留动画）

## 背景与问题

GIF 在三处被静态化，而磁盘导入的 GIF **原始动画字节一直完好保存在受管库**
（`{sha256}.gif`，Phase 8 起 GIF 不缩放不重编码）：

1. **展示层**：网格/浮层缩略图走 `load_thumbnail` 返回磁盘缓存的 PNG 首帧
   data URL，动画数据从未被展示。
2. **收藏路径（读）**：`clipboard_collect.rs` 的 `app.clipboard().read_image()`
   只返回解码后的 RGBA 位图（= GIF 第一帧），随后 `stage_dynamic_image`
   确定性重编码为 PNG —— 动画在读剪贴板第一步就丢了。
   根因是 `tauri-plugin-clipboard-manager`（2.3.2 / arboard 3.6.1）**没有
   读取自定义剪贴板格式的 API**，只能拿到 RGBA。
3. **复制路径（写）**：`clipboard.rs` 主动取首帧写 RGBA
   （`animationPreserved=Some(false)`），粘贴出去是静态图。

## 方案总览

| 子项 | 方案 | 降级路径 |
|---|---|---|
| A. 悬停播放 | 开启 Tauri assetProtocol，`.gif` 项 hover/选中时把 `<img src>` 切到 `convertFileSrc(原始文件)` | asset URL 加载失败 → 回落静态缩略图（实例内不重试） |
| B. 收藏保留动画 | 三条通道按序：①`"image/gif"` 原始字节（Firefox）②`CF_HDROP` 文件路径（QQ/资源管理器）③网页 GIF URL 联网下载（**设置开关**，默认关）→ `import_bytes`（`source_type='clipboard'`） | 通道①②读不到且③关闭/失败 → 原 RGBA→PNG 首帧路径 + toast 提醒 |
| C. 复制保留动画 | 插件写完 RGBA 首帧后，追加 **CF_HDROP 文件列表**（主通道）+ 注册格式 `"image/gif"` 原始字节（辅通道），均不 `EmptyClipboard` | 追加失败 → warn + 维持 `Some(false)`，不影响复制主流程 |

三者互不依赖（A 纯前端 + 配置；B/C 共享 Win32 模块），均不破坏既有不变量：
`encode_image_as_png` 确定性（GIF 字节路径不重编码）、`IMPORT_LOCK`、
SHA-256/dHash 双通道去重、unsafe 只在 `platform/` 且 `#[cfg(windows)]`。

## A. 悬停播放（展示层）

- `tauri.conf.json` `app.security.assetProtocol`：
  `scope: ["$APPDATA/assets/emojis/**", "$APPDATA/assets/trash/**"]`。
  注意 **asset 协议走 tauri.conf.json 的 security 配置，不是 capability**；
  同时 `tauri` crate 需 `protocol-asset` feature。trash 目录实际在
  `app_data_dir/assets/trash/`（`trash_service.rs` 推导），纳入 scope 让回收站
  视图行为一致。缩略图目录不需要（走 data URL）。
- `src/lib/tauri.ts::emojiAssetUrl(path)` 是唯一 asset URL 出口（`convertFileSrc`）。
- `src/features/library/useGifPreview.ts`：共享 hook。`isGifExtension` 大小写
  不敏感；`failed` state 在 `item.path` 变化时重置，加载失败后实例内不重试。
- 主网格 `EmojiGridItem`：本地 `hovered` state，`src={gifSrc ?? source}`。
- 浮层 `QuickSearchItem`：`useGifPreview(item, selected)` —— 浮层里鼠标 hover
  （`onMouseEnter→onPoint`）与键盘选中统一驱动 `selectedIndex`，一套状态覆盖
  两种输入。副作用：默认选中第 0 项，首个结果是 GIF 会常驻播放（"当前选中项
  预览"语义，验收接受）。
- **性能取舍**：受管 GIF 是原始字节（未压缩），WebView2 对 custom protocol
  响应的缓存不保证，每次 hover 可能重新读盘+解码。v1 接受现状（本地盘毫秒级，
  且 GIF 本就该从第 0 帧重放）；**不做全量预载**（整页 GIF 会把全部原始字节
  拉进内存）。首帧延迟明显再迭代（视口内 IntersectionObserver 预热）。

## B. 收藏保留动画（读路径）

调用链：`collect_image_from_clipboard` 最前调 `try_collect_gif_bytes`，**两条
通道按序尝试**：

1. **注册格式 `"image/gif"` 原始字节**（Firefox 复制 GIF 时放置）：
   `RegisterClipboardFormatW` → `OpenClipboard`（5×10ms 重试）→
   `IsClipboardFormatAvailable` → `GetClipboardData` → `GlobalSize`/`GlobalLock`
   拷贝。**GetClipboardData 的 HGLOBAL 所有权属系统，绝不 free。**
2. **`CF_HDROP` 文件路径**（QQ 复制聊天图片 / 资源管理器复制 .gif 文件时
   放置）：`read_file_drop` 解析 `DROPFILES`（20 字节头，仅 `fWide=1`）取
   路径列表，找第一个 `.gif` 文件**只读**其字节。QQ 的原图缓存在
   `nt_qq\nt_data\Pic\...\Ori\*.gif`（真机实测确认复制时带完整本地路径，
   同时 HTML Format 里也有 `file:///` 引用）—— 动画由此保真、免联网。
   文件名用源文件名（如 QQ 哈希名），非 `clipboard-*` 合成名。

拿到字节后：`is_gif_bytes`（"GIF87a"/"GIF89a" magic）+ `gif_first_frame_decodable`
（GifDecoder 首帧）双重校验 → `ImportService::import_bytes` →
`AssetService::stage_bytes`（SHA 对原始字节算、`animation_status` 判 gif 恒
`Animated` → 原始字节保留、缩略图首帧）→ `commit_staged_as_source_type(...,
"clipboard", ...)`。`stage_file` 的解码/判动画/缩放段抽成 `stage_temporary`
与 `stage_bytes` 共用。

去重语义：SHA-256 对**原始 gif 字节**计算 —— 同一 GIF 反复收藏、或与磁盘导入
的同一 GIF 都撞 ExactSha；dHash 对首帧。`source_type='clipboard'` 守卫使自动
文件名标签自然跳过。

导入失败（磁盘/DB）返回 `Failed` **不回退** RGBA：字节已验证合法，失败大概率
是共性问题，RGBA 路径也会失败，如实报错更好。

### 通道 3：网页 GIF URL 联网下载（设置开关「联网下载网页 GIF」，默认关）

Chrome/Edge 复制网页动图时剪贴板上只有首帧位图 + 源 URL（HTML Format 的
`<img src="https://....gif">` 与 `UniformResourceLocatorW`），本地没有任何
GIF 数据。`attempt_web_gif` 按设置分派：

- **开关关闭（默认）**：走 RGBA 静态导入，但检测到网页动图时在
  `Imported.message` 携带提示「检测到网页动图：已保存静态首帧；可在设置中
  开启『联网下载网页 GIF』保留动画」，前端拼进导入 toast（`App.tsx` 的
  `showManagedImportResult(summary, note)`）。
- **开关开启**：`download_web_gif`（ureq 2，rustls）下载原始字节——仅
  `http(s)://` 且路径 `.gif` 结尾的 URL、连接超时 5s、读取超时 15s、上限
  20 MB、UA `Mozilla/5.0 (compatible; EmoBox/0.1)`；下载后 `is_gif_bytes` +
  首帧解码校验，合法则 `import_bytes` 动画导入（文件名取 URL 末段）。
  下载失败 / 内容非 GIF → 降级静态导入 + 失败原因提示（截断 80 字符）。

这是全应用**唯一的网络行为**，由设置开关显式控制；「无云端、无账号、无网络
同步」原则的例外只此一处（下载的是用户刚复制的那个 URL，不做任何上传）。

## C. 复制保留动画（写路径）

`copy_image` 在插件 `write_image` 成功后，对 `.gif` 调 `append_gif_animation`：

- 防御：`is_gif_bytes` 不通过直接 return（不信任扩展名）。
- **主通道 CF_HDROP 文件列表**：`write_file_drop(&[受管 .gif 路径])` 构造
  `DROPFILES`（20 字节头，`fWide=1`）+ 双 NUL 结尾的宽字符路径列表。
  **实测微信/QQ 不消费 `"image/gif"` 位图格式**——用户从资源管理器 Ctrl+C
  一个 .gif 文件粘贴到 QQ 是动图，证明它们认的是 CF_HDROP（按文件粘贴）。
  所以动画保真的主通道是文件列表，指向受管 `.gif` 原始文件。
- **辅通道 `"image/gif"` 原始字节**：一并放上（Telegram 等认它），失败仅 warn
  不影响主通道的 outcome。
- `SetClipboardData` 不要求先 `EmptyClipboard`：插件 write 完成后（其内部已
  CloseClipboard）再独立 Open→Set→Close，不破坏插件刚写的 DIB/PNG。不识别
  这些格式的应用（画图/Office 默认粘贴）仍拿静态首帧 —— 最坏等于旧行为。
- 文件列表追加成功 → `animationPreserved=Some(true)`、message「GIF 已连同
  动画一起复制。」；失败 → warn + 维持 `Some(false)`，绝不影响复制主流程。
- **取舍**：CF_HDROP 在剪贴板上会让部分应用（如 Word）在"选择性粘贴"里多出
  "文件"选项，默认 Ctrl+V 仍贴位图（Gif123 的 Word FAQ 即此行为）。

## 环境实测记录（probe 结果）

- **Win32 剪贴板 API 签名**（windows 0.61.3，`Win32_System_DataExchange` +
  `Win32_System_Memory` feature）：`GetClipboardData/SetClipboardData` 收发
  `HANDLE`（HGLOBAL 需转换）；**`GlobalFree` 在 `Win32::Foundation` 而非
  `System::Memory`**，签名为 `(Option<HGLOBAL>) -> Result<HGLOBAL>`。
- **开发机剪贴板曾被持续占用**：`OpenClipboard` 一律 `ERROR_ACCESS_DENIED`
  （0x5），且 `GetOpenClipboardWindow` 返回 NULL（占用者以 NULL owner 打开），
  连 PowerShell `Set-Clipboard` 都失败。表现为某个进程持有剪贴板未释放。
  这不是 EmoBox 代码问题——代码对占用有重试 + 优雅降级。若复现：检查正在
  运行的 `emobox.exe` 旧实例 / 微信 / 剪贴板工具，关闭后用
  `cargo test registered_format_write_read_roundtrip -- --ignored` 验证。
- Firefox 复制 GIF 会放 `image/gif` 格式；**Chrome/Edge 只放 DIB/PNG 位图 +
  网页 URL**（HTML Format 带 `<img src="https://...gif">`），没有本地 GIF
  数据 —— 由通道 3（设置开关控制的联网下载）覆盖，关闭时降级静态首帧并提醒。
- **QQ 复制聊天图片**（真机实测）：剪贴板放 `QQ_Unicode_RichEdit_Format` +
  HTML Format（`<img src="file:///...">`）+ **CF_HDROP（完整本地路径，指向
  `nt_qq\nt_data\Pic\...\Ori\*.gif` 原图）** + DIB 位图。读路径走 CF_HDROP
  通道免联网拿到动图。
- **QQ/微信粘贴端不消费 `"image/gif"` 位图格式**（真机实测：EmoBox 复制 GIF，
  `image/gif` 追加成功、toast 报"已连同动画一起复制"，但 QQ 粘贴仍是静态图）。
  它们粘贴动图的通道是 **CF_HDROP 文件列表**（资源管理器 Ctrl+C 一个 .gif
  → QQ 粘贴为动图，用户真机验证）—— 写路径据此改为主推 CF_HDROP。

## 设置与 UI

- `ThemeProvider.tsx` 新增 `downloadWebGif: boolean`（默认 `false`），持久化
  `localStorage: emobox.settings`；开关在 `SettingsMenu.tsx`「常规 → 行为」。
- 值按次传给 `collect_image_from_clipboard` 命令（`downloadWebGif` 参数），
  Rust 不做内存镜像（与 selectionSearch 不同——Rust 不需要提前知道）。
- 前端 `App.tsx::handleCollectFromClipboard` 把 `outcome.message` 作为 note
  拼进导入 toast（网页动图提醒 / GIF 动画保留说明对用户可见）。

## 手动验收清单

1. **悬停播放**：主网格 `.gif` 项 hover 播放动画、移开恢复静态首帧；浮层 hover
   或方向键选中播放；回收站视图同样生效。
2. **收藏**：**QQ 聊天窗口对 GIF 右键复制 → `Ctrl+Alt+S`** → toast「已从剪贴板
   收藏（GIF 动画已保留）」→ 素材目录出现 `.gif` 原始字节文件（源文件名）、网格
   悬停可播（CF_HDROP 通道）。Firefox 右键"复制图像"同效（image/gif 字节通道）。
   **Chrome/Edge 复制 GIF → 开关关闭**：静态 PNG + toast 提醒可开启下载；
   **开关开启**：联网下载 → `.gif` 动画导入（需真实网络环境）。
3. **复制**：主网格/浮层复制 GIF → toast「GIF 已连同动画一起复制」→ 微信/QQ
   粘贴出动图（CF_HDROP 文件格式）；画图/PowerPoint 粘贴静态首帧（DIB 仍在）。
4. **回归**：PNG 复制/收藏不变；同一 GIF 二次收藏 toast「这张 GIF 已在素材库中」；
   快速连按 `Ctrl+Alt+S`（IMPORT_LOCK 排队 + Duplicate）。
5. **失败兜底**：把 assetProtocol scope 临时改窄 → GIF 悬停不播放但静态缩略图
   正常显示，无报错。

## 测试

- Rust：`is_gif_bytes` magic 校验、`stage_bytes_gif_keeps_original_bytes`、
  `import_bytes_inserts_clipboard_gif_with_original_bytes`（受管文件字节与输入
  完全一致 + 无文件名标签）、`import_bytes_dedupes_on_second_call`、
  `gif_first_frame_decodable_*`、`parse_drop_files_*`（DROPFILES 解析：宽字符
  列表 / ANSI 拒绝 / 截断拒绝）、`is_web_gif_url_*` / `extract_web_gif_url_*` /
  `web_gif_filename_*`（URL 解析纯函数）、`mark_gif_animation_appended_flips_outcome`、
  `append_gif_animation_ignores_non_gif_bytes`。
  `registered_format_write_read_roundtrip` / `file_drop_write_succeeds`（含
  write→read 闭环）标 `#[ignore]`（触碰真实系统剪贴板，手动
  `cargo test -- --ignored`）。联网下载不做自动化测试（需真实网络）。
- 前端：`useGifPreview.test.ts`（扩展名大小写、active/failed 语义、失败不重试、
  path 变化重置）。

## 相关文件

- `src-tauri/tauri.conf.json`（assetProtocol）、`src-tauri/Cargo.toml`（windows
  features + `protocol-asset`）
- `src/lib/tauri.ts`、`src/features/library/useGifPreview.ts`、
  `src/features/library/EmojiGridItem.tsx`、`src/features/search/QuickSearchContent.tsx`
- `src-tauri/src/platform/windows/clipboard_raw.rs`（新）
- `src-tauri/src/clipboard_collect.rs`、`src-tauri/src/clipboard.rs`
- `src-tauri/src/services/asset_service.rs`（`is_gif_bytes` / `stage_bytes` /
  `stage_temporary` 重构）、`src-tauri/src/services/import_service.rs`（`import_bytes`）
