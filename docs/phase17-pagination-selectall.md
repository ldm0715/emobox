# Phase 17：主窗口分页（无限滚动）+ 多选全选按钮

> 状态：已实现。验收命令全绿（cargo fmt/check/clippy -D warnings/test + npm run build + vitest）。

## 背景与目标

两个用户痛点：

1. **主窗口网格一次抓全量元数据**：`all` / `favorites` / `ungrouped` / `group:N` 视图硬编码
   `limit: 500, offset: 0`；**trash 视图完全无限制**（`list_deleted` 无 LIMIT）。库大时启动/切
   视图开销大，且 500 上限本身也是个隐性地毯（超过 500 张的库显示不全）。
2. **多选模式没有全选/取消全选 UI**：`useMultiSelection.selectAll()` 已存在，但只有
   `Ctrl+A` 键盘路径，鼠标用户无法一键全选。

用户确认的交互决策：

- 分页形式 = **滚动到底自动加载**（复用 EmojiGrid 现有 IntersectionObserver 哨兵）；
- 「全选」语义 = **只选已加载的项**（不自动拉取剩余页；元数据很轻，但"全选=全部"会
  让批量操作静默作用于用户看不见的条目，不做）；
- 快捷搜索浮层**保持现状**（空 query 30 条 / 有 query 60 条，本来就是分页语义）。

## 两个必须先解决的结构冲突

### 1. 客户端排序 vs offset 分页

`App.tsx` 的 `filteredItems` 原来在客户端按名称/格式/时间排序，而后端 ORDER BY 固定为
收藏优先 + 导入时间。分页后每页来自后端顺序，客户端再排序 = 只对已加载子集排序，
顺序错乱。**排序整体下推到 SQL**：

- `SearchOptions.sort`（TS）/ `ListOptions.sort`（Rust）扩展为 7 个字面量：
  `recent` / `name-asc` / `name-desc` / `format` / `added-time` / `modified-time`
  （`SortOption` 五值与后端一一对应，字符串相同）。
- ORDER BY 分支每个都补 `e.id` 决胜列 —— offset 分页要求**全序确定**，SQLite 对并列
  键不保证稳定顺序，无决胜列会翻页重复/漏行。
- 已知行为差异：SQL `COLLATE NOCASE` 对中文按码点排序，原 `localeCompare("zh-CN")`
  按拼音 —— 可接受。
- **recent 视图保留客户端排序**（数据源在客户端 recentItems，上限 50，不分页）。

### 2. 四级搜索回退链 vs offset 分页（潜在 bug，已修）

`list_indexed` 原来用 `!exact.is_empty()` 判断是否回退下一级——第 2 页（offset=N）在
第 1 级必然返回空（行都在 offset 之前），会**错误地一路回退到 PlainLike**，把 LIKE 命中
的行混进精确搜索的翻页结果。

修复：阶梯选级改为 `resolve_search_mode()`，用 **COUNT 探测**（offset=0 语义）判定各级
是否非空，与请求的 offset/limit 完全无关；选定后跑一次列表查询 + 一次同 WHERE 的 COUNT。
offset=0 时行为与旧实现完全一致（旧实现本来就是"结果为空回退"）。

回归测试：`list_indexed_exact_syntax_pagination_keeps_stage_beyond_offset`
（Lenient 命中 3 条 + PlainLike 诱饵行；offset=3 应返回空页 + total=3，而非回退返回诱饵）。

## 契约变更：`{ items, total }` 分页返回结构

`search_emojis` 与 `list_deleted_emojis` 返回 `SearchPage { items, total }`
（Rust，serde camelCase）/ `SearchResult`（TS）。**单次往返拿全 total**，无需额外
count 命令：

- `hasMore = 已加载 < total`；
- header「共 N 张」与侧栏「全部表情 / 收藏」计数用 total —— 与已加载条数彻底解耦
  （原来 `allItems.length` / `favorites.size` 是从 500 行缓存派生的，分页后必须换成真值）；
- **纯计数用法**：`limit: 0` → items 空 + total 真（`refreshLibrary` / `refreshSidebar`）。

`list_deleted_emojis` 新增可选 `limit` / `offset` 参数；`refreshSidebar` 原来为拿
trashCount 全量拉回收站，现在 `{limit: 0}` 纯计数。

锁步 WHERE 构建从 `list_indexed_impl` 抽成 `build_search_where`（视图过滤 + 搜索模式 +
tag_ids 除法语义原样搬移），`list_indexed_impl`（列表）与新增 `count_indexed`（计数）
共用，保证计数与列表命中**同一回退级、同一结果集**——仍然只有 `list_indexed` 这一个
搜索 SQL 入口。

## 前端分页状态机（App.tsx）

- `PAGE_SIZE = 200`（模块级）。网格本身另有 72/批的渐进 DOM 渲染，两层独立。
- 状态：`viewTotal` / `hasMore`；`viewSeqRef`（视图序号）/ `loadingMoreRef`（防重入）/
  `nextOffsetRef`（下一页 offset 游标）。
- **按视图 effect**（deps 增加 `sortOption`，排序变更重拉第 1 页）：fetch →
  `setCurrentEmojis(items)` / `setViewTotal(total)` / `setHasMore(items.length < total)` /
  `nextOffsetRef = items.length`；`viewSeqRef.current += 1` 作废在途的 loadMore 响应。
- **`loadMore`**（哨兵触发）：
  - offset 用 `nextOffsetRef`（按**服务端返回行数**前进），不用 `currentEmojis.length` ——
    本地删除/去重会让两者错位，若用本地长度，全被去重的页会永远请求同一 offset
    **死循环**；
  - 响应回来先比对 seq（视图/搜索词/排序已变则丢弃）；
  - 追加按 id 去重（防 offset 漂移重复）。
- **计数解耦**：删除 `indexedEmojis` / `allItems` / `favorites: Set<string>` 三个 state
  与 `toLegacyImage`；`refreshLibrary` 重写为两个 `limit: 0` 计数请求；
  `favoriteIds` 改为**随每页加载合并**（`mergeFavoriteFlags`，只增不减——取消收藏的唯一
  入口 `toggleFavorite` 自带乐观同步）+ 乐观更新；`indexedById`（标签交集初选用）改为
  从 `currentEmojis` 派生——选中项必在当前视图已加载集内，不需要全量缓存。
- 批量删除/恢复的本地剪辑同步 `viewTotal -= n`；`hasMore` 不动 —— 哨兵自动 loadMore
  回填（去重 + offset 游标保证安全）。计数类副作用（allCount/favoriteCount）在
  `handleDelete` / `handleRestore` / `toggleFavorite` 成功后 `void refreshLibrary()`。

## EmojiGrid 哨兵双通道

- 新 props：`hasMore` / `onLoadMore` / `resetKey`（App 传 `${view}|${query}|${sort}`）。
- `visibleCount` 重置从「items 变化即重置」改为 **resetKey 变化才重置** —— 否则每追加
  一页（items 引用必变）都会把渲染量打回 72，滚动跳变。items 收缩时 clamp。
- 哨兵渲染条件 `canRevealMore || needsNextPage`；observer 回调：能揭示更多已加载项 →
  `+BATCH_SIZE`（原行为）；已渲染完已加载项且 `hasMore` → `onLoadMore()`（经 ref 转发，
  避免回调身份变化频繁重建 observer）。

## 全选/取消全选按钮

- `LibraryHeader`：多选模式开启时，「多选」按钮旁多一个 `Button size="small"`，
  `allSelected ? "取消全选" : "全选"`（`allSelected = selectedIds.size > 0 &&
  selectedIds.size >= filteredItems.length`）。
- 语义 = 已加载项：直接复用 `useMultiSelection` 现成的 `selectAll()`（选 items 全体）
  与 `clear()`，hook 零改动。`Ctrl+A` 行为保持（本就只选已加载项）。
- tooltip 明示「全选已加载项」，分页语义对用户可见。

## 测试

Rust（emoji_repository.rs `#[cfg(test)]`）：

- `list_indexed_exact_syntax_pagination_keeps_stage_beyond_offset` —— 回退链 offset 修复；
- `list_indexed_sort_name_asc_and_desc` / `list_indexed_sort_format_orders_extension_then_name` /
  `list_indexed_sort_added_and_modified_time_orders_desc` —— 5 个新 ORDER BY 分支；
- `list_deleted_paginates_with_total` —— 回收站分页 + id DESC 决胜拼页 + `limit:0` 纯计数。

JS：`useQuickSearchQuery.test.tsx` mock 改为 `{ items, total }` 形状（`resolveItems`
辅助）。EmojiGrid 无组件测试，手动验收覆盖。

## 手动验收清单

- [ ] 200+ 张库：打开主窗口只加载第 1 页（200 条），header「共 N」显示总数；滚动到底
      自动追加下一页，无滚动跳变；
- [ ] 五种排序切换：重新拉第 1 页且顺序正确；渲染量重置但滚动位置在顶部（预期）；
- [ ] `组*标签` 精确搜索命中 >200 时翻到第 2 页仍命中同一回退级（不串到 LIKE 结果）；
- [ ] trash 视图分页正常；侧栏回收站计数 = 总数（非已加载数）；
- [ ] 批量删除后：viewTotal 递减，滚动到底自动回填；
- [ ] 多选开 →「全选」→ 批量条「已选 N 项」= 已加载数；「取消全选」清空；Ctrl+A 一致；
- [ ] 收藏切换后侧栏「收藏」计数正确（refreshLibrary 计数刷新）；
- [ ] 快捷搜索浮层行为不变（空 query 30 / 有 query 60）。

## 关键文件

| 文件 | 改动 |
|---|---|
| `src-tauri/src/repositories/emoji_repository.rs` | `SearchPage`、`resolve_search_mode`/`count_indexed`/`build_search_where`、ORDER BY 5 分支 + id 决胜、`list_deleted(limit, offset)` |
| `src-tauri/src/commands.rs` | 两命令返回 `SearchPage`，`list_deleted_emojis` 加 limit/offset |
| `src/App.tsx` | 分页状态机、排序下推、计数解耦、全选接线、`fetchViewPage` |
| `src/features/library/EmojiGrid.tsx` | 哨兵双通道 + resetKey |
| `src/features/library/EmojiLibraryView.tsx` | 透传 total/hasMore/onLoadMore/resetKey/allSelected |
| `src/features/library/LibraryHeader.tsx` | 全选/取消全选按钮 |
| `src/lib/tauri.ts` / `src/types.ts` | `SearchResult` / `SearchSort` 契约 |
| `src/features/search/useQuickSearchQuery.ts` | 读 `.items` |
