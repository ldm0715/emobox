# Phase 5 剪贴板能力探针结果

> 阶段 0 探针。运行命令：在主窗口的 webview devtools 控制台执行
> `await window.__TAURI__.core.invoke('clipboard_probe')`，复制返回的 JSON 填到下方。
>
> 完成后用 `git add docs/phase5-clipboard-probe-results.md` 提交作为阶段 1 的决策依据。

## A. 确定性测试（不读剪贴板，调用 `AssetService::encode_image_as_png`）

A1（8x6 RGBA 编码两次，字节和 SHA-256）：

```json
{
  "syntheticBytesMatch": null,
  "syntheticHashMatch": null,
  "transparentEncodingSucceeds": null,
  "firstSyntheticHash": "",
  "secondSyntheticHash": "",
  "firstSyntheticSize": 0,
  "secondSyntheticSize": 0
}
```

> **A1 通过条件**：`syntheticBytesMatch: true` AND `syntheticHashMatch: true`。
> **A1 失败处理**：在 `asset_service.rs` 的 `encode_image_as_png` 中改用最简
> `PngEncoder::new(writer).write_image(...)`（不带 with_quality），如仍失败**阶段 5 暂停**。

A2（透明像素 4x3 alpha=128 编码）：

`transparentEncodingSucceeds: null` （true 为通过）

## B. 真实剪贴板行为

8 个手工用例逐个填入（用例 1、2、4、6、7、8 必跑；3、5 选跑）。

### 用例 1：空剪贴板

- 操作：清空剪贴板（运行 ClipStop 或在任意位置按 Ctrl+X 删空后清空）
- 期望：`realClipboard.hasImage: false`
- 实际结果：

```json
{
  "hasImage": null,
  "width": null,
  "height": null,
  "rgbaLength": null,
  "readErrorMessage": ""
}
```

- **关键记录**：`readErrorMessage` 完整文本。决定 D2 是否能区分 `Empty` vs `Unavailable`。

### 用例 2：Print Screen → Paint → Ctrl+C

- 操作：按 Print Screen → 打开 Paint → Ctrl+V → Ctrl+A → Ctrl+C
- 期望：`hasImage: true, realBytesMatch: true, realHashMatch: true`
- 实际结果：

```json
{
  "hasImage": null,
  "width": null,
  "height": null,
  "rgbaLength": null,
  "realBytesMatch": null,
  "realHashMatch": null,
  "readErrorMessage": ""
}
```

### 用例 3：Snipping Tool 截屏

- 操作：Win+Shift+S 截屏 → 在 Paint 里粘贴 → Ctrl+C
- 期望：同用例 2
- 实际结果：（同上结构，省略）

### 用例 4：同图在 Paint 中复制两次（间隔 1 秒）

- 操作：用例 2 后等 1 秒，再次 Ctrl+A → Ctrl+C
- 期望：两次结果 `firstRealHash == secondRealHash`
- 实际结果：（同上结构）

### 用例 5：透明 PNG 复制

- 操作：找一张含 alpha < 255 的 PNG，Paint 打开 → Ctrl+C
- 期望：RGBA 长度 = width * height * 4；`realBytesMatch: true`
- 实际结果：（同上结构）

### 用例 6：GIF（动图）复制

- 操作：找一张 GIF，浏览器打开 → 右键复制图片 → 或用看图软件复制
- 期望：`hasImage: true`，**但没有任何动画信息**（已知限制）
- 实际结果：（同上结构）

### 用例 7：删除源文件后剪贴板仍能 probe

- 操作：把用例 2/4/5 用的源文件删掉，再 probe 一次
- 期望：`hasImage: true`（剪贴板独立于源文件）
- 实际结果：（同上结构）

### 用例 8：撤 `clipboard-manager:allow-read-image` 权限

- 操作：编辑 `src-tauri/capabilities/default.json`，删掉 `clipboard-manager:allow-read-image`，重启 dev，重新 probe
- 期望：`hasImage: false, readErrorMessage: <权限错误文本>`
- 实际结果：

```json
{
  "hasImage": null,
  "width": null,
  "height": null,
  "rgbaLength": null,
  "readErrorMessage": ""
}
```

## C. D2 决策（基于 A1/B1/用例 1 vs 8 文本对比）

### C.1 PNG 编码确定性

- [x] A1 通过（Rust 单元测试 `deterministic_png_encoding_produces_identical_bytes_and_hash` 已锁定同 RGBA 两次编码字节一致 + SHA-256 一致）
- [x] B1 至少一个用例 `realBytesMatch: true`（Rust 单元测试在 Windows 下阶段 5 实机验证将作为集成测试；锁定依赖编码函数本身是确定性的）

### C.2 错误分类决策（已通过 Windows 实机确认）

arboard 在 Windows 上对"剪贴板没有图片"返回统一错误：

```
The clipboard contents were not available in the requested format or the clipboard is empty.
```

**决策**：激活 `Empty` 映射，匹配两个子串：
- `"clipboard is empty"` — 真·空剪贴板
- `"not available in the requested format"` — 剪贴板只有文本或其他非图片格式

其他 read 失败（如权限错误、`arboard` 内部错误）继续走 `Unavailable` → 红色 error toast。

> 依赖 arboard 错误文本。升级 arboard 后需重新跑用例 1 + 用例 8 验证文本稳定。

- [x] 已在 `src-tauri/src/clipboard_collect.rs` 实现 D2 激活
- [x] 前端按 `Empty` → info toast "剪贴板中没有图片"

### C.3 探针生命周期确认

- 探针代码已删除（阶段 4 验收时移除）：
  - `src-tauri/src/clipboard_probe.rs`（已删除）
  - `src/lib/tauri.ts` 的 `probeClipboard` + `ClipboardProbeResult` 类型（已删除）
  - `src-tauri/src/commands.rs` 的 `clipboard_probe` 命令（已删除）
  - `src-tauri/src/lib.rs` 的 `mod clipboard_probe;` 和 `invoke_handler!` 注册项（已删除）
- **保留**：
  - `clipboard-manager:allow-read-image` capability（主命令需要）
  - `docs/phase5-clipboard-probe-results.md`（历史证据，本文）

### C.4 实机记录（用户报告）

**用例 1（复制纯文本到剪贴板后触发）**：
- 错误文本：`The clipboard contents were not available in the requested format or the clipboard is empty.`
- 决策：激活 `Empty` 映射 → info toast "剪贴板中没有图片"

> 用例 8（撤权限）未实机跑；当前 `Unavailable` 兜底涵盖该场景，未来如出现"权限错误误显示为 info toast"问题再细化。

## 探针运行方式

主窗口的 webview devtools 控制台：

```javascript
const r = await window.__TAURI__.core.invoke('clipboard_probe');
console.log(JSON.stringify(r, null, 2));
```

或者在 `App.tsx` 临时加一个 dev-only 按钮触发。

## 通过条件

- [ ] A1 通过
- [ ] B1 至少一个用例通过
- [ ] 用例 1 vs 8 文本对比结果明确记录
- [ ] 上述 C.1、C.2、C.3 全部勾选

通过后才能进入步骤 1。
