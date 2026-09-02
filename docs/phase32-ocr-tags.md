# Phase 32：OCR 识图自动打标签

## 需求与决策

导入表情时自动识别图内文字作为标签。文件名标签（`commit_staged_as_source_type`
里的既有逻辑）**原样保留作兜底**，OCR 标签是追加而非替代。

用户确认的三个决策：

1. **云端引擎 = 百度 AI Studio PaddleOCR 在线 API**（不是本地 PaddleOCR，也不是
   百度智能云 aip.baidubce.com 的旧 OCR API）。AI Studio 的服务形态：
   - 用户在 `aistudio.baidu.com/paddleocr/task` 创建**个人 API_URL**——模型
     （PP-OCRv5 / PP-OCRv6 / PaddleOCR-VL 等）在创建 URL 时选定，**请求体没有
     model 字段**（文档检索时确认：同步 API 文档页收录的还是 PP-OCRv5，v6 已上线
     在异步文档侧边栏有「新品」入口，但两者请求形态一致——模型绑定 URL）；
   - 鉴权：请求头 `Authorization: token <Access Token>`；
   - 请求：`POST {API_URL}`，JSON `{"file": "<base64>", "fileType": 1}`；
   - 响应：`result.ocrResults[0].prunedResult.rec_texts`（PP-OCR 产线 res 的简化
     JSON，文本行数组）；错误 `errorCode` 非 0（12001 每日配额 / 12002 频率限制
     映射成友好文案）；
   - 选**同步 API** 而非异步 API（`/api/v2/ocr/jobs` + 轮询）：异步为多页 PDF /
     批量文档设计，表情包单张场景单次 POST 延迟更低、实现简单得多；
   - 每日免费额度约 2 万次（用户口述），以 AI Studio 页面为准，代码里不写死。
2. **默认引擎 = 系统 OCR**（Windows.Media.Ocr，本地离线、零额度成本）。中文识别
   依赖系统语言包（设置 → 时间和语言 → 语言 → 中文 → 可选功能「文字识别」），
   未装时引擎创建失败、按行 warn 跳过，不影响导入。
3. **范围 = 导入自动 + 设置页「存量回填」按钮**（不做右键单张识别）。

## 架构

```
导入命令成功（ManagedImportSummary.items 的 emoji id）
  └─ schedule_ocr_for_new_emojis：engine≠off 时 std::thread::spawn 后台批处理
       └─ ocr::process_emoji_ids（OCR_LOCK 串行化所有批次）
            每张：load_pending_path（is_deleted=0 AND ocr_text IS NULL 守卫）
              → decode_for_import（EXIF + 动画首帧）
              → 超长边降到 768 → AssetService::encode_png_bytes（统一 PNG 输入管线）
              → 引擎分发：windows_ocr::recognize_lines（WinRT）
                         / ai_studio_ocr::recognize_lines（ureq，批内 1s 节流）
              → UPDATE ocr_text + tag_text::extract_tags → find_or_create_id + add_tags
              → 每 10 张 emit_to(main, "ocr-tags-updated") + 批末必发一次
              → tagged>0 时 quick_search::notify_library_changed

设置页「为现有表情补跑识别」
  └─ backfill_ocr_tags 命令：list_pending_emoji_ids（ocr_text IS NULL AND is_deleted=0）
       → 同一 process_emoji_ids（phase=backfill）
```

### 关键设计

- **后台异步而非导入内同步**：云端 1–3s/张会拉长 `IMPORT_LOCK` 持有时间，文件夹
  批量导入不可接受。导入命令立即返回，标签几秒后经事件刷出（App 监听
  `ocr-tags-updated` → `refreshSidebar` + `viewReloadTick+1`，同 key 重拉不重播
  入场动画）。
- **`ocr_text` 列（迁移 0008）**：NULL=未识别、''=识别过但无文字。幂等守卫
  `IS NULL` 防重复跑/重复烧额度；应用退出丢掉的批次由回填自动补上；也为将来
  「按图内文字搜索」留了数据（本次不做）。不建索引（同 perceptual_hash 先例）。
- **失败分级**：文件级问题（文件缺失/解码失败）写 `ocr_text=''` 防止回填无限
  空转；Windows OCR 单张失败跳过（行保持 NULL）；AI Studio 错误**中止整批**
  （配额/网络/token 错误继续打剩下的只会徒劳烧时间），剩余行保持 NULL。
- **`OCR_LOCK`**：所有后台批处理串行（并发导入/回填排队），批内云端引擎 1s 节流。
  `poisoned.into_inner()` 恢复毒化锁（与 `lock_import` 同语义）。
- **不动 `updated_at`**：OCR 标签概念上是导入的一部分，不触发 modified-time 排序
  跳动。回收站行不跑 OCR（`is_deleted=0` 守卫）。
- **设置推送**：`ocrEngine` / `aiStudioOcrApiUrl` / `aiStudioOcrToken` 存
  `localStorage: emobox.settings`（事实源），ThemeProvider 挂载/变更时经
  `set_ocr_config` 推到 Rust `OcrState` 内存镜像（两窗口幂等，同 selectionSearch
  模式）。**Access Token 只存本机 localStorage**，随命令读内存镜像，不进日志。

### Windows OCR（WinRT）实现要点

`windows` crate 0.61 增 features：`Foundation` / `Globalization` /
`Graphics_Imaging` / `Media` / `Media_Ocr` / `Storage` / `Storage_Streams`。

- 管线：PNG 字节 → `InMemoryRandomAccessStream` → `DataWriter::CreateDataWriter`
  写入 + `StoreAsync`/`FlushAsync` + **`DetachStream`**（writer drop 会关流）→
  `Seek(0)` → `BitmapDecoder::CreateAsync` → `GetSoftwareBitmapAsync` →
  非 Bgra8/Gray8 时 `SoftwareBitmap::Convert`（OcrEngine 只认这两种）→
  `OcrEngine.RecognizeAsync`。
- WinRT async 一律 `IAsyncOperation::get()` 阻塞等待（调用点都在后台线程）。
- 引擎创建：`TryCreateFromUserProfileLanguages` → 失败/null（Try* 约定失败返回
  null，用一次廉价方法调用验真）→ 可用语言里按 zh → en → 任意挑。
- 不缓存引擎实例：OCR 本身占大头，每次创建开销可忽略，且避免 WinRT 对象跨线程
  共享的心智负担。

### 标签提取规则（`ocr/tag_text.rs`，纯函数）

一行文本 = 一个标签（无分词器不切词，中文整行保留）：trim → 掐掉首尾标点
（ASCII + 常见 CJK 标点/装饰符）→ 过滤 URL / 纯数字符号 / <2 字符 → 超长截断
到 24 字符（截断后仍可被子串回退搜索命中）→ NOCASE 去重 → 最多 5 个。

### 前端

- 设置页「存储与导入」新增「文字识别（OCR）」组：引擎 Dropdown、Windows 引擎的
  可用性状态行（`get_ocr_capabilities` 懒检测一次，进入 storage 页才跑 WinRT）、
  aiStudio 展开的 API URL + Token（password）输入与「打开 AI Studio 控制台」
  按钮（`open_external_url` 白名单新增 `aistudio.baidu.com`）、「存量回填」按钮。
- 回填进度：命令返回待识别总数（立即），进度经 `ocr-tags-updated`
  （`phase: backfill`）事件推进 → App 存 `ocrBackfill` state 传给设置弹窗；
  finished 时按 processed/total 分 success / warning / error toast。
- 批末事件**无条件发一次**（哪怕整批被跳过）——前端靠它解除回填「进行中」状态。

## 联网例外

全应用联网行为从两处变三处：新增 AI Studio OCR（用户显式配置 API URL + Token
才会发生，默认引擎是本地 OCR）。设置页文案明确标注「图片会上传到百度服务器」。

## 验证

- `ocr::tag_text`（10 用例：拆分/过滤/截断/去重/上限）、`ocr::ai_studio_ocr`
  （响应解析契约/错误码/配置校验）、`ocr`（OcrState 读写/引擎枚举/默认值）、
  `windows_ocr` 冒烟（枚举语言不 panic）。
- 全量：cargo fmt/check/clippy -D warnings/test（216）+ npm run build + vitest。

## 手动验收

见 `MANUAL_ACCEPTANCE.md`「OCR 识图自动打标签（Phase 32）」一节。
