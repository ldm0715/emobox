# Phase 8：导入提速与压缩 / 感知哈希去重 / 移除外部索引 / 浮层同步 / 精确搜索

> 实施完成。本阶段优化四个长期痛点：
>
> 1. **导入慢 + 无压缩**：静态图超 512px 缩放重编码、单次解码、去 fsync、显式编码器、缩略图磁盘缓存生效
> 2. **去重漏**：字节级 SHA-256 之外增加 dHash 感知哈希双通道（跨格式 / 分辨率 / EXIF 都能判重）
> 3. **浮层不同步**：浮层改为全库后端搜索（空查询最近优先）+ 数据变更事件 `library-changed`
> 4. **无精确搜索**：支持 `组名:标签` 精确语法，`list_indexed` 重写为锁步参数绑定

另外**整个移除外部目录索引**：任何导入都是复制进受管库，`导入文件夹` 改为复制 + 顶层子文件夹自动建同名分组。

---

## 一、用户拍板的关键决策

| 决策 | 选 | 不选 |
|---|---|---|
| 受管副本压缩 | 静态图（PNG/JPG/WebP）任一边 >512px 缩到 512px 内 + 显式重编码 | 不压缩 / 仅编码加速 |
| 动画处理 | GIF / APNG / 动画 WebP **全部保持原始字节**；内容级检测，无法确认 → 保守保留 | 按扩展名假定可重编码 |
| 去重算法 | SHA-256 字节级（直接跳过）+ dHash 感知（阈值 4，标记"疑似重复"） | 只按原始字节哈希 |
| 感知重复处置 | 保留候选信息（id / 路径 / Hamming），前端可「强制导入」（`skipPerceptualDedup`） | 静默吞掉 |
| 存量数据 | 删除全部 `external_directory` 行（迁移 0004）；旧受管行感知哈希**惰性回填** | 保留 / 迁移为受管副本 |
| 文件夹导入 | 递归复制入库；**顶层子文件夹自动建同名分组**（懒建，不建空组）；根目录散图不归组 | 平铺不建组 |
| 浮层搜索 | 走后端 `searchEmojis`；空查询全库最近优先（`sort:"recent"`） | 本地文件名子串过滤 |
| 精确搜索 | `组名:标签` / `组名:` / `:标签`（NOCASE 精确），空结果回退一次普通 LIKE | 纯 OR 子串 |
| `load_thumbnail` | 按 `emoji_id` 查 DB 的 `thumbnail_path`，磁盘缓存优先 | 通过路径反查 emoji |

---

## 二、数据模型（migration `0004_remove_external_directory_add_perceptual_hash.sql`）

```sql
DELETE FROM emojis WHERE source_type = 'external_directory';
ALTER TABLE emojis ADD COLUMN perceptual_hash INTEGER;
```

- **不建 `perceptual_hash` 的普通 B-tree 索引**：去重是"加载候选后 Rust 全表 Hamming 距离扫描"，普通索引对 Hamming 距离无加速，千级库全表扫描毫秒级。
- external 行 `managed_path` / `thumbnail_path` 均为 NULL，删除只清 DB 行（文件本体不动），DELETE 触发 CASCADE 清其 group/tag 关联。
- `source_type` 的 CHECK 约束保留 `'external_directory'` 字面量（SQLite 不能 ALTER CHECK，删表重建不值当；不再产生新行即可）。

---

## 三、压缩与导入提速

### 3.1 受管副本压缩（`asset_service.rs`）

- `stage_file` / `stage_dynamic_image` **解码一次**：取尺寸 + EXIF 方向 + dHash + 缩放来源 + 缩略图来源，消除旧的二次全量解码。
- 静态图任一边 >512px：`thumbnail(512, 512)`（保宽高比）→ 按原扩展名**显式编码器**重编码：
  - PNG → `PngEncoder::new_with_quality(w, CompressionType::Fast, FilterType::Adaptive)`
  - JPG/JPEG → `JpegEncoder::new_with_quality(w, 85)`
  - WebP → `WebPEncoder::new_lossless(w)`（image 0.25 的 WebP 编码器仅支持 lossless）
  - 不用 `save_with_format` 的隐式默认参数。
- ≤512px 的静态图与全部动画**保留原始字节**（SHA 不变，向后兼容）。
- `encode_image_as_png` 压缩级别 `Default → Fast`；确定性测试 `deterministic_png_encoding_produces_identical_bytes_and_hash` 仍成立（同输入同输出）。

### 3.2 动画内容级检测（`AnimationStatus`）

扩展名只作辅助，以容器结构为准：

| 格式 | 检测 | 结果 |
|---|---|---|
| gif | 恒为动画（含静态 GIF） | `Animated` |
| png | 遍历 chunk，`IDAT` 前发现 `acTL` | `Animated` / `Static` |
| webp | RIFF 解析：`ANIM` chunk 或 `VP8X` features bit1 | `Animated` / `Static` |
| jpg/jpeg | 无动画概念 | `Static` |
| 解析失败 / 截断 / 超大 chunk 长度 / 无法确认 | — | `Unknown`（保守：保留原字节 + `log::warn`） |

chunk 解析用 `checked_add` 校验边界 / 长度 / 整数溢出；任何异常都不缩放不重编码。

### 3.3 EXIF Orientation

`decode_for_import(path)`：`ImageReader → into_decoder → decoder.orientation() → DynamicImage::from_decoder → apply_orientation`。方向在**计算尺寸 / dHash / 缩放 / 缩略图之前**统一应用；无 EXIF / 读取失败 → 安全回退 `NoTransforms`。剪贴板路径（内存 RGBA）无 EXIF，不涉及。

### 3.4 提速点

- 单次解码（见 3.1）；`copy_and_hash` 去掉 `sync_all`（保留 `flush`；写入序列 `write_all → flush → 同卷 rename`，失败路径由 `TemporaryFile::drop` / 哈希校验 / `CommittedAsset::rollback` 兜底）。接受"flush 不保证物理落盘"的断电窗口，与 DB 的 WAL `synchronous=NORMAL` 一致。
- `load_thumbnail(emoji_id, max_size)` 改按 id 查 DB 的 `thumbnail_path`：磁盘缓存存在且非空 → 直接 base64，不再每次从原图全量解码重生成。`IndexedImage` 因此增加 `id` 字段（7 字段）。

---

## 四、感知哈希去重（`perceptual_hash.rs` / `emoji_repository` / `import_service`）

### 4.1 dHash

- `dhash(&DynamicImage) -> u64`：灰度 → `resize_exact(9, 8, Lanczos3)`（**强制 9×8**，`resize` 会保宽高比导致非方图不是 9×8）→ 每行相邻像素明暗比较出 64 bit。
- u64 ↔ i64 用 `to_ne_bytes` / `from_ne_bytes` **位保持**转换存 SQLite INTEGER（避免 `as` 数值语义歧义）。
- `PERCEPTUAL_HASH_THRESHOLD = 4`（保守；dHash 是感知哈希，相似但不同的图可能接近——命中只标记"疑似"，不静默吞掉）。

### 4.2 双通道判重（`EmojiRepository::find_duplicate_content`）

1. SHA-256 字节级命中 → `DedupHitKind::ExactSha`，直接跳过。
2. 未命中且未跳过感知去重 → 加载活跃受管行候选 `(id, perceptual_hash)`，算最小 Hamming 距离；阈值内候选按 **(Hamming, id) 升序**取最优。
3. `skip_perceptual_dedup=true`（强制导入）只绕过感知，SHA 仍生效。

命中感知时返回 `PerceptualDuplicateInfo { source_path, candidate_id, candidate_path, hamming }`，前端 toast 区分「精确重复」与「感知相似 N 张」，并提供「强制导入」按钮（用同一批源路径 + `skipPerceptualDedup` 重调）。

### 4.3 惰性回填（`ImportService::backfill_perceptual_hashes`）

迁移 0004 后旧受管行 `perceptual_hash` 为 NULL。每次导入（未跳过感知时）先回填一批（≤50）NULL 行：用 `decode_for_import`（与 `stage_file` 一致的 EXIF / 首帧管线）算 dHash，`IS NULL` 守卫单条小事务 `UPDATE`。文件缺失 / 损坏 → `log::warn` 跳过，不阻塞当前导入；已回填记录不再重复解码。

---

## 五、移除外部索引 + 文件夹导入

### 5.1 移除

- `scanner.rs`：删 `ScanSummary` / `scan_directory` / `scan_and_persist`；保留 `IndexedImage` / `IndexedEmoji` / `supported_extension`；新增 `collect_image_files(root)`（walkdir 递归、只收支持扩展名、跳过符号链接）。
- `emoji_repository.rs`：删 `upsert_external_scan` / `list_available`。
- **重写 `import_legacy_recent`**：不再插入 external 行，只按路径匹配既有受管行 `UPDATE ... MAX(usage)`，未匹配跳过——否则迁移删掉的 external 行会在 setup 阶段重生。
- `commands.rs` / `lib.rs`：删 `scan_directory` / `get_indexed_images` 命令。

### 5.2 文件夹导入（`ImportService::import_folder`）

- 统一用 **canonical root**：`collect_image_files` 返回基于 `canonicalize()` 的路径，`top_level_subfolder` 的 `strip_prefix` 也必须用同一份根（Windows 上原路径与 canonical 路径可能因大小写 / 符号链接不一致）。
- 每个**顶层子文件夹** → 同名分组（`ImportGroup::ByName`），`insert_managed` **同一事务**内解析/创建分组 + 写 `emoji_groups` 关联；任何失败整体回滚，**绝不产生空组**（重复 / 失败 / 回滚均不建组）。
- **平铺文件夹**（所有图片都在根目录、无任何子文件夹）→ 把**文件夹本身**建成同名分组，根目录图全部归入（贴合"导入一个平铺表情包文件夹 → 一个组"）。有子文件夹时维持"子文件夹建组、根目录散图不归组"。
- 懒建：仅当该子文件夹（或平铺时文件夹）第一张图成功导入才建组；`groups_created` 只含本次真正 `INSERT` 的组名（复用既有组不计入）。
- 嵌套目录归其顶层子文件夹；有子文件夹时的根目录散图 `ImportGroup::None` 不归组。
- `FolderImportSummary { successCount, exactDuplicateCount, perceptualDuplicateCount, failedCount, groupsCreated, elapsedMs, items, failures, perceptualDuplicates }`。

---

## 六、浮层同步

- `QuickSearchWindow` 用 `useQuickSearchQuery` hook：空 query → `searchEmojis({view:"all", sort:"recent", limit:30})`（全库最近优先，未用过的新图也可见）；非空 → 全库跨字段搜索（支持 `组名:标签`）。
- **requestSeq 守卫**：query / activationId / reloadToken 触发的旧请求返回后一律丢弃；cleanup 递增序号作废挂起请求（含卸载场景），只有当前请求能更新 `items/loading/error`。
- Rust 侧 `quick_search::notify_library_changed` 向 `quick-search` 发 `library-changed`；所有库数据变更命令（导入 / 删除 / 恢复 / 永久删除 / 清空回收站 / 收藏 / 分组 CRUD / 标签 CRUD / 剪贴板收藏）成功后 emit，浮层收到后重载当前搜索（不重置输入）。
- 前端新增 vitest：`useQuickSearchQuery.test.tsx` 覆盖快速连续输入乱序、`library-changed` 保持 query、卸载后不 setState。

---

## 七、精确搜索（`list_indexed` 重写）

- **锁步参数绑定**：SQL 的 `?` 出现顺序与 `params` Vec 完全一致（view 的 group 参数 → query/精确 → tag_ids → LIMIT/OFFSET），废弃旧 `?Q` / `?T<i>` 手工编号。ORDER BY 由 Rust 按 `view` / `sort` 分支输出字面量，不绑定 view 参数。
- `parse_exact_query`：全角冒号 `：` 归一化为 `:`，`splitn(2, ':')`：
  - `组名:标签` → 精确 AND（组名 EXISTS + 标签名 EXISTS，`= ? COLLATE NOCASE`）
  - `组名:` / `:标签` → 单边精确
  - 无冒号 / 两侧都空 → 普通跨字段 LIKE（文件名 / 标签名 / 分组名 OR，query 绑定 3 次）
- **回退**：精确查询空结果时回退**一次**普通 LIKE（`log::debug` 记录耗时）；含冒号的组名/标签名仍可经回退命中。
- `ListOptions.sort = Some("recent")` → `ORDER BY (last_used_at IS NULL) ASC, last_used_at DESC, COALESCE(imported_at, indexed_at) DESC`。

---

## 八、关键不变量（Phase 8 新增）

- 任何导入 = 复制进受管库；不存在"仅索引原路径"模式。
- 动画（GIF/APNG/动画 WebP）与 ≤512px 静态图保持原始字节；只有确认静态且超限才缩放重编码。
- SHA-256 对**存储字节**算（缩放重编码后重算）；跨格式/分辨率去重由 dHash 通道负责。
- 感知命中是"疑似重复"不是"确定重复"：保留候选信息，可强制导入。
- 分组创建与 emoji 插入**同一事务**，失败/重复/回滚不产生空组。
- `load_thumbnail` 按 `emoji_id` 查 DB，不通过图片路径反查。
- `IMPORT_LOCK` 毒化恢复：一次 panic 不永久阻塞后续导入（`lock_import` 用 `poisoned.into_inner()`）。

---

## 九、已知边界 / 风险

- dHash 阈值 4 保守；「加字 / 变色 / 背景替换 / 轻微裁剪」的相似图可能被判接近——这是感知哈希的固有性质，命中只标记疑似、可强制导入。测试对这类样本只记录距离、不断言。
- 压缩仅影响受管副本且不可逆（原件 / 动画不动）；`image` crate 升级若改变重编码字节，SHA 变化但 dHash 通道仍能兜底跨格式判重。
- 惰性回填逐导入分批（≤50/次），存量库首次导入会多几次解码；`IS NULL` 保证不重复回填。
- 组名/标签含 `:` 时精确语法先按 `组:标签` 解析，空结果回退普通 LIKE 仍可命中。
- 迁移 0004 不可逆删除 external 行（文件本体不删）。

## 十、验证

- `cargo check` / `cargo clippy -- -D warnings` / `cargo test`（111 passed）✅
- `npm run build`（tsc + vite）✅
- `npx vitest run`（浮层 `useQuickSearchQuery` 乱序测试）✅
- 手动：大图压缩、跨格式/跨分辨率判重（含旧素材回填）、动画原样、文件夹导入建组/不建空组、浮层全库可见 + `组名:标签` + 强制导入 + `library-changed` 刷新。
