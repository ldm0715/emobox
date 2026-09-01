# Phase 21：剪贴板收藏原生回退链（PNG 注册格式 → CF_DIBV5 → CF_DIB）

> 2026-09。修复「QQ 复制静态图收藏失败」「Chrome 截图收藏失败」两类问题。
> 改动集中在 `clipboard_collect.rs` + `platform/windows/clipboard_raw.rs` +
> `Cargo.toml`（image 加 `bmp` feature）。CLAUDE.md 同步条目已更新。

## 背景与问题

剪贴板收藏的静默降级末端是 `app.clipboard().read_image()`（tauri-plugin-clipboard-manager
→ arboard 3.6.1）。实机排查发现 arboard 在 Windows 上有两大缺口：

1. **剪贴板有 `"PNG"` 注册格式时只解它，解码失败不回退。** 某些截图工具 /
   浏览器放的 PNG 字节有前导垃圾或截断，arboard 直接抛
   `ConversionFailure`（"could not be converted..."），整次收藏失败——
   而剪贴板上明明还有可解的位图格式。
2. **无 PNG 时只认 `CF_DIBV5`，从不尝试 `CF_DIB`。** QQ 复制静态聊天图
   只放老式 BITMAPINFOHEADER 的 `CF_DIB`，arboard 报
   "not available in the requested format"——D2 分类把它映射成
   `Empty`，用户看到「剪贴板中没有图片」，实为误报。

另外 Chrome / Electron 复制图片放的是 Chrome 形态 DIB：**32bpp + BI_RGB +
alphaMask=0xff000000**（BITMAPV3/V4/V5 头）。文档说 BI_RGB 的高字节"未使用"，
实际这些生产者在 alpha 通道放了真实透明度——按普通 BI_RGB 解码会丢 alpha。

## 方案：read_image 失败后的原生回退链

`collect_image_from_clipboard` 读剪贴板改为两级：

```
app.clipboard().read_image()          ← 插件（arboard），主路径不变
        │ Err
        ▼
read_image_native_fallback()          ← 仅 Windows，按序静默尝试：
  ① read_registered_format_bytes("PNG") → decode_clipboard_png
  ② read_standard_format_bytes(CF_DIBV5) → decode_clipboard_dib
  ③ read_standard_format_bytes(CF_DIB)   → decode_clipboard_dib   ← QQ 静态图
        │ 全部 None（或非 Windows）
        ▼
classify_clipboard_read_error(text)   ← 原 D2 分类抽成独立函数，逻辑不变
```

不变量：回退链任何一步失败 → `None` 降级到下一级 / 既有错误分类，**绝不**
让收藏因回退失败而多报错；插件主路径成功时行为零变化。

### DIB 解码（`decode_clipboard_dib`）

- `< 40` 字节（连 BITMAPINFOHEADER 都不够）→ `None`。
- **Chrome 形态检测 `has_dib_alpha_mask`**：头长 ≥56 且 ≤ 输入长度、
  32bpp、BI_RGB、alphaMask（头偏移 52）= `0xff000000`。
  头字段偏移：`bV5Size=0 / bV5Width=4 / bV5Height=8 / bV5BitCount=14 /
  bV5Compression=16 / bV5AlphaMask=52`。BITMAPINFOHEADER（40 字节）没有
  掩码字段，不会误判。
- 命中 → **`decode_dib_32bpp_bgra` 手解**：像素是 BGRA（4 字节/像素，行
  天然对齐），正高度 = bottom-up、负高度 = top-down，像素紧跟 `bV?Size`
  字节的头。尺寸上限 65535（与 BmpDecoder 一致，防异常头 OOM），
  `checked_mul` 防溢出，数据不足 → `None`。
- 未命中或手解失败 → `image::codecs::bmp::BmpDecoder::new_without_file_header`
  兜底（alpha 会丢，好过没有）——**Cargo.toml 的 image features 必须含
  `bmp`**。
- 解码结果统一过 `force_opaque_if_alpha_all_zero`：有些生产者 32bpp 的
  alpha 高字节**恒填 0**（假透明），解码出全 0 alpha 时整体置 255，
  防止导入一张全透明 PNG。

### 为什么不走 arboard 的 tweak 方案（勿改回）

arboard 自家的 `maybe_tweak_header` 是把 BI_RGB 改写成 BI_BITFIELDS 让
BmpDecoder 走掩码路径。**在 image 0.25.10 下这条方案解不开 arboard 自己的
Chrome 测试样本**：image 对 V3/V4/V5 头 + BI_BITFIELDS 会跳过头后 12 字节
（假定头后还有一份 RGB 掩码），而 Chrome 样本的真实像素紧跟 124 字节头，
跳过 12 字节整图错位。实测复现，故手解 BGRA。测试
`decode_clipboard_dib_decodes_arboard_chrome_sample` 用 arboard 测试的原始
样本字节锁定这条路径（原始字节探针存档 `src-tauri/chrome_dibv5_probe.txt`）；
`decode_clipboard_dibv5_keeps_alpha_via_tweak` 测试名里的 "tweak" 只是历史
遗留命名，实际断言的是手解路径。若未来升级 image crate 修复了该行为，
重新评估后再考虑简化。

### clipboard_raw.rs 重构

原 `read_registered_format_bytes` 的 guard + 可用性检查 + GlobalLock 拷贝
逻辑抽成私有 `read_format_bytes(format: u32)`（数据所有权属系统：只拷贝，
绝不 GlobalFree）；新增公开 `read_standard_format_bytes(format)` 给
CF_DIB / CF_DIBV5 用；`read_file_drop` 改为复用 `read_format_bytes` +
`parse_drop_files`，行为不变。

## 测试（`clipboard_collect.rs` `#[cfg(test)]` 新增 7 个）

| 测试 | 锁定 |
|---|---|
| `decode_clipboard_png_roundtrip` | PNG 注册格式解码 + 非 PNG 字节 → None |
| `decode_clipboard_dib_decodes_24bpp_rgb` | BITMAPINFOHEADER 24bpp bottom-up + BGR 行对齐；<40 字节 → None |
| `decode_clipboard_dibv5_keeps_alpha_via_tweak` | Chrome 形态手解 BGRA 保 alpha（200 保留） |
| `decode_clipboard_dibv5_handles_top_down` | 负高度 top-down |
| `decode_clipboard_dib_decodes_arboard_chrome_sample` | arboard Chrome 原始样本 5×5，锁定手解、防误回 tweak |
| `decode_clipboard_dib_resolves_opaque_alpha` | 40 字节头 32bpp alpha=0 → 输出不透明 |
| `tweak_dibv5_alpha_header_flips_bitfields` | 占位断言防误恢复 tweak 方案 |

## 验收

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml decode_clipboard
npm run build
```

手动验收：QQ 复制静态聊天图 → `Ctrl+Alt+S` 收藏成功（此前误报「剪贴板中
没有图片」）；Chrome 复制带透明区域图片 → 收藏后透明保留。

## 附带变更

- `src/app/LibrarySidebar.tsx`：置顶图钉图标从 20px（`PinRegular` /
  `PinOffRegular`）换成 16px（`Pin16Regular` / `PinOff16Regular`）——
  20px 图钉在分组行内视觉过大、且与行内其他 16/20px 图标不齐。

## 补充修复（同日）：资源管理器复制图片文件不进库

**现象**：在资源管理器里复制图片**文件**（.png/.jpg 等）再 `Ctrl+Alt+S`
收藏，误报「剪贴板中没有图片」。

**根因**：资源管理器复制文件只往剪贴板放 `CF_HDROP` 文件路径 + 文件名类
格式，**没有任何位图格式**；而既有 CF_HDROP 通道（动画通道 0 的通道 2）
只认 `.gif`，静态图直接漏掉，落到 arboard 又读不到 → D2 误判 `Empty`。
（对比：从网页复制图片走 DIB 位图，Phase 21 回退链已覆盖，与
「联网下载网页 GIF」开关无关——开关只管网页 **GIF 动图**的原始字节下载。）

**修复**：新增**通道 0.1 `try_collect_file_drop_image`**，插在动画通道 0
与网页 GIF 通道 0.5 之间：

- 从 `CF_HDROP` 列表取第一个受支持扩展名（`scanner::supported_extension`
  白名单去掉 GIF，GIF 仍由通道 0 保动画优先）且存在的文件，**只读**源文件
  字节（沿用 Phase 16 的只读不变量）；
- 防御扩展名与内容不符：`image::load_from_memory` 解不出 → warn + 返回
  `None` 降级既有路径；
- 按原始字节 `import_bytes`（格式/质量不重编码，GIF 之外同理；静态 >512px
  的缩放规则与既有导入一致），文件名用源文件名，`source_type='clipboard'`；
- 结果映射抽成 `import_bytes_to_outcome` 与 GIF 通道共用（GIF 的重复文案
  统一为「这张图片已在素材库中。」）。

**测试**：`static_drop_extension_accepts_supported_non_gif` /
`static_drop_extension_rejects_gif_and_unsupported`（`#[cfg(windows)]`；
HDROP 端到端依赖真实剪贴板，不进单测）。

**手动验收**：资源管理器复制 .png / .jpg / .webp 文件 → `Ctrl+Alt+S`
收藏成功，素材库文件名/格式与源文件一致。
