# Phase 33：标签弹窗重设计（搜索驱动 + OCR 手动识别）

## 需求与决策

Phase 32 之后 OCR 会给表情打大量标签（一行文字一个标签），原 `TagPickerDialog`
「全量 checkbox 列出所有标签 + 全选行 + 单个『新建并应用』输入框」的形态不可用
——标签总量可能上千，全部铺开既慢又找不到目标。重设计目标（用户确认）：

1. **不显示全部标签，搜索驱动**。空查询显示「常用标签」（按 `count` 降序取
   `POPULAR_TAGS_COUNT = 12`，同数按名称码元升序）；输入后 NOCASE 子串过滤、
   上限 `TAG_SEARCH_RESULT_LIMIT = 50` 行，超出时在分区标题提示剩余数量。
2. **删除「全选/全不选」行**——搜索模式下对全量标签全选没有意义（OCR 后标签
   数百，全选是误操作源）。
3. **新建标签改为「暂存」语义**：搜索词无 NOCASE 精确匹配时列表底部出现
   「创建「query」」行；Enter 同语义（有精确匹配 → toggle 该标签，无 → 暂存）。
   可暂存多个新标签（chips 里带 `Add16Regular` 图标区分），统一在「保存标签」
   时逐个 `createTag` 并应用——替代原来一次只能建一个的「新建并应用」按钮。
   `onConfirm` payload 相应从 `newTagName: string | null` 改为
   `newTagNames: string[]`（App 侧循环 `createTag`，同名冲突仍走 MessageBar 报错）。
4. **已选标签以 chips 呈现**（`TagGroup` + `InteractionTag` + `InteractionTagSecondary`
   的 X 移除），限高 76px 滚动；dismiss = 反选（若是初始选中则计入 `-N` 移除差量）。
   该版本（react-tags）`dismissible` 必须挂在 `TagGroup` 上，`InteractionTag`
   只带 `value`；X 按钮是 `InteractionTagSecondary`（点击经 context 调
   `TagGroup.onDismiss`，`data.value` 取回 `InteractionTag.value`）。
5. **OCR 手动识别按钮内置在弹窗**（独立区块卡片）。用户确认的重复识别语义：
   **强制重新识别**——对 `ocr_text` 非 NULL 的行也重跑引擎并覆盖识别文字。

## 后端改动

- `ocr/mod.rs`：
  - `OcrPhase` 新增 `Manual`（serde `"manual"`），前端据此区分事件流。
  - `process_emoji_ids` 新增 `force: bool` 尾参：force 时 `load_pending_path`
    去掉 `AND ocr_text IS NULL`（保留 `is_deleted = 0`）、落库 UPDATE 去掉
    `AND ocr_text IS NULL` 守卫（覆盖旧文字）。**标签语义只增不删**——新结果经
    `extract_tags → find_or_create_id + add_tags`（`INSERT OR IGNORE`，幂等）追加，
    绝不删除旧标签，防误删手工标签。**force 时文件级失败（缺失/解码失败）改为
    跳过并保留旧 `ocr_text`**（非 force 仍写 `''` 防回填空转）——重识别失败
    不能摧毁历史识别结果。导入×3 与 backfill 调用点传 `force = false` 行为不变。
  - 识别结果落库抽成 `apply_recognition_result(connection, emoji_id, lines, force)`
    便于单测（覆盖 + 只增不删 + 幂等 + 非 force NULL 守卫）。
  - 新增 `filter_existing_emoji_ids(database_path, ids)`：过滤出未软删的 id
    （保持入参顺序），供手动识别命令先算 queued 数。
- `commands.rs` 新增两个命令（invoke_handler 注册数 51 → 53）：
  - `ocr_recognize_emojis(app, database_state, emoji_ids) -> Result<u32, String>`：
    engine off → `Err("请先在设置中选择 OCR 引擎")`；`id <= 0` 过滤；
    `spawn_blocking(filter_existing_emoji_ids)` 后 queued=0 直接 `Ok(0)`，
    否则 `std::thread::spawn(process_emoji_ids(..., OcrPhase::Manual, config, true))`
    fire-and-forget、立即返回 queued（与 backfill 同模式）。
  - `get_emoji_tags(database_state, emoji_ids) -> Result<Vec<EmojiTagsDto>, String>`：
    复用 `EmojiRepository::get_relations_for_ids` 只投影 tagIds；
    `EmojiTagsDto { emojiId, tagIds }`。这是前端**唯一**能读到某表情标签 id 集合的
    命令（`IndexedEmoji.tagIds` 只在当前视图已加载页里有，弹窗不能依赖分页状态）。

## 前端改动

- `types.ts`：`OcrTagsUpdatedPayload.phase` 加 `"manual"`；新增 `EmojiTags`。
- `tauri.ts`：`ocrRecognizeEmojis(emojiIds): Promise<number>`、
  `getEmojiTags(emojiIds): Promise<EmojiTags[]>`。
- `tagPickerHelpers.ts`（纯函数 + `tagPickerHelpers.test.ts`）：
  `sortPopularTags` / `filterTagsByQuery`（NOCASE 子串 + 上限）/ `findExactTag` /
  `canStageNewTagName` / `mergeOcrSelection` / `intersectTagIds`。
- `TagPickerDialog.tsx` 整体重写（布局自上而下）：
  副标题 → 已选 chips（可空）→ SearchBox（`width:100% + maxWidth:"none"`，Fluent
  SearchBox 自带 468px 截断坑）→ 列表区（分区标题「常用标签」/「搜索结果（N）」+
  checkbox 行 + 「创建」行）→ OCR 卡片（`ScanText20Regular` + 说明 caption +
  「开始识别」/运行中「正在识别 N/M…」）→ error/warning MessageBar →
  footer（`+N / -M` 摘要 + 取消/保存标签）。多选初始选中仍取交集（App
  `handleAddTags` 不变）；`emojiIds` 成为新 prop（open 时快照进
  `emojiIdsSnapshot`）。

### OCR 流程（弹窗自持）

对话框直调 tauri 包装并自订阅 `OCR_TAGS_UPDATED_EVENT`（先例：SettingsMenu 直调
`backfillOcrTags`/`getOcrCapabilities`）：

1. 「开始识别」→ `ocrRecognizeEmojis(emojiIdsSnapshot)`；queued=0 → warning
   「所选表情均不存在或已在回收站」，否则置 `ocrProgress {processed:0, total:queued}`
   （`ocrProgressRef` 为门）。
2. 监听只过滤 `phase === "manual"`；**以 `ocrProgressRef` 非空为门**，只响应本弹窗
   启动的批次（事件 payload 不带 id，App 关弹窗后重开再启动的第二批与残留在途
   批无法区分——已知边角，最终态以 `getEmojiTags` 为准）。
3. 批末 `finished` → 清进度 → `getEmojiTags(emojiIdsSnapshot)` 取各表情 tagIds
   **交集**（`intersectTagIds`）→ `mergeOcrSelection(selected, common, initial)`:
   `merged = selected ∪ (common − (initial − selected))`——识别出的新标签并入选中集，
   但**不复活用户已手动反选的标签**。
4. **批末分级提示**（`buildOcrNotice` 纯函数 + vitest；2026-09 补充）：
   事件 payload 增 `tagged` / `empty` / `failed` 三个累计计数（Rust 侧
   `RowOutcome::{Tagged,Empty,Failed}` 行级枚举统计，processed = 三者之和；
   云端中止的出错行不计入 failed，靠 `processed < total` 体现），弹窗据此弹：
   - 全部成功且有标签 → 不提示（chips 出现即反馈）；
   - 全部成功但无标签 → **info「识别成功，但未从图片中识别出可用的文字」**，
     Windows 引擎附加「本地 OCR 效果有限，可切换 AI Studio 重试」建议（用户
     反馈 Windows 默认 OCR 效果一般、无结果时无提示，此为常见场景）；
   - 全部失败 → **error「识别失败：N/M 张未能识别」**；
   - 部分失败 / 云端中止（processed < total）→ warning 汇总（提取到标签 /
     无文字 / 失败 / 中止于 X/Y）。
5. App 的 `ocr-tags-updated` 监听里 manual 批次走原 import 刷新分支
   （`refreshSidebar` + `viewReloadTick`），网格标签 chip 及时更新；App 不 toast
   （弹窗有内联进度/提示）。

### 已知取舍

- 引擎关闭时按钮禁用、caption 提示「设置 → 存储 → 文字识别」；引擎可用性
  （Windows 语言包缺失等）不在弹窗探测——识别失败由批末 `processed < total` 提示。
- OCR 运行中允许继续勾选/保存（保存即关闭弹窗，事件继续到达但 `ocrProgressRef`
  门在弹窗快照重置时清零；App 刷新链路照常）。
- 搜索结果上限 50 行是渲染保护，超长标签列表靠继续输入缩小范围。

## 2026-09 即时生效模式重构（用户多轮反馈后的定案）

Phase 33 的「勾选 + 暂存 + 保存」模式经用户多轮使用反馈后**整体废弃**，改为
**所见即所得**：弹窗无暂存概念，所有操作直接写库，经 `onTagsMutated` 回调刷新。
同时修复三个真机 bug、接上重命名/删除 UI。变更明细：

### 交互语义（全部即时写库）

| 操作 | 行为 | 确认 |
|---|---|---|
| 右栏行首「＋」 | `addTagsToEmojis([id], emojiIds)` 即时加到所选表情；已添加态换对勾、禁用（移除入口在左栏） | 无（可逆，去左栏移除） |
| 左栏「当前标签」🗑 | ConfirmDialog 确认 → `removeTagsFromEmojis([id], emojiIds)` 从所选表情移除（标签本身保留） | 有（用户要求） |
| 左栏 Checkbox 多选 + 批量条 | 勾选 ≥1 浮出「已选 N · 取消选择 · 移除所选」批量条 → ConfirmDialog 汇总确认 → `removeTagsFromEmojis(ids, emojiIds)` 矩阵单事务批量移除（一个一个点太慢——用户反馈） | 有（汇总数量） |
| 两栏行内 ✏️ | 行内 `Input appearance="underline"`（Enter/失焦提交、Esc 取消）→ `renameTag` 即时落库 | 无 |
| 右栏 🗑 | ConfirmDialog 确认 → `deleteTag` 全局删除（库中所有表情失去） | 有（destructive 红按钮） |
| 搜索 Enter / 「创建并添加」 | 有精确匹配 → `applyAddTag`；无 → `createTag` + `addTagsToEmojis` 即时建标签 | 无 |
| OCR 识别 | 后台批处理**直接落库**（`add_tags` 追加，识别结果默认加上不暂存——用户指定），批末弹窗重算左栏并集 | 无 |

- footer「保存标签」退化为「完成」（关闭弹窗），「取消」改「关闭」；摘要文案
  「修改即时生效，无需手动保存」。
- `mutating` state 是写操作串行锁：进行中禁用一切操作与关闭（Esc/遮罩/按钮）。
- 左栏 `currentTagIds`（open 时 `getEmojiTags` 自取**并集**）是唯一展示真源——
  不再有 `selected` 勾选集、`initiallySelectedTagIds` prop、`newNames` 暂存数组。
- **`onConfirm` 契约已删**；App 侧 `handleTagPickerConfirm`（批量保存）改为
  `handleTagsMutated({addedTagIds, removedTagIds, fullReload?})`：加/移除做
  `currentEmojis` + `recentItems` **双乐观补丁**（recent 视图数据源是
  recentItems，漏一边会被旧值覆盖——「保存后不实时刷新」根因）+ `refreshSidebar`；
  `fullReload: true`（全局删除，影响全部表情不能局部补丁）时再 `viewReloadTick++`。

### 同轮修复的三个真机 bug

1. **关弹窗后网格乱抖/滚动跳位**：①App 的 `ocr-tags-updated` 监听器对
   import/manual 批次**每个进度 tick**（Rust 每 10 张发一次）就 `viewReloadTick++`
   重拉——改为只在 `payload.finished` 时刷新；②视图 effect 重拉只拉第 1 页
   （200 条）替换全部已加载内容 → 网格塌缩 → 浏览器钳制 scrollTop → 哨兵
   补页 → 连续抖动——`fetchViewPage` 增 `limit` 参数，同 key 重拉取
   `max(PAGE_SIZE, currentEmojisRef.length)`（latest-ref，不进 deps）。
2. **保存标签后网格不实时刷新**：`recentItems` 未补丁（见上）；非 recent 视图
   靠 `tagById` → `tagsByPath` WeakMap 失效链路换 chips 名（无需重拉）。
3. **重命名/删除无 UI**：后端 `rename_tag` / `delete_tag` + `tauri.ts` 包装
   从 Phase 6 起就存在但从未接线——本轮接上（见上表）。

### 布局与样式（Fluent 规范 + 踩坑记录）

- 760px 双栏：左「当前标签」｜竖向 Divider（`flexGrow:0`，Phase 14 陷阱）｜
  右「标签库」（SearchBox `width:100% + maxWidth:"none"`）。两栏 `pane` 定高
  400px + `calc(100vh - 320px)` 兜底、`paneScroll` flex:1——右栏多一个 SearchBox，
  各自独立 `maxHeight` 会让右栏滚动区更矮（左右大小不一根因）。
- 行模板 `actionRow` grid **4 列** `auto minmax(0,1fr) auto auto` =
  ［＋/占位］｜名称｜✏️🗑｜计数。**列数必须与子元素数匹配**：右栏行渲染 ＋
  按钮、左栏行渲染同宽 24px 占位（`rowAddSlot`），缺位整行错列（真机踩过
  「右侧模板样式不全 + 字体不居中」）。
- hover 操作可见性走**行级 `hovered` state + `rowActionsVisible` mergeClasses
  切换**——Griffel makeStyles 不支持 `":hover .literal-class"` 后代选择器
  （产物里该规则不生成，按钮永远 `visibility:hidden`，真机踩过）。
  `visibility` 占位（非 display:none）防行宽跳动。
- 长标签名截断：名称 span 块级 + 三件套（`tagNameStyles.tagName` 模块级共享
  给 TagRow——它定义在主组件外拿不到主 styles）；inline span 上截断无效
  （Phase 18 同坑）；悬浮全名走原生 `title`。
- 两个 ConfirmDialog 与主 `<Dialog>` 是 **Fragment 兄弟节点**——塞进主 Dialog
  children 会被 Fluent 当 trigger 无条件渲染、弹窗自己蹦出来且关不掉
  （Phase 31 同款坑）。
- 后端（Rust）零改动；纯函数 `tagPickerHelpers.ts` 增 `unionTagIds` /
  `canSubmitRename`（vitest 覆盖；`removeDeletedTag` / `mergeOcrSelection` /
  `intersectTagIds` / `canStageNewTagName` 随暂存语义移除已无调用方，保留
  纯函数与测试作为回归防线）。
