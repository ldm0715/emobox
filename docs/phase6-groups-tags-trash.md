# Phase 6：分组 / 标签 / 收藏持久化 / 批量操作 / 统一搜索 / 回收站

> 实施完成。本阶段打通五个长期缺口：
>
> 1. 分组与标签：从 SQLite 关系表到 UI 弹窗
> 2. 收藏：从纯前端内存升级为 `emojis.is_favorite` 持久化
> 3. 统一搜索：搜索框 query 走后端 `search_emojis`，跨文件名 / 标签名 / 分组名 OR 匹配
> 4. 删除：物理删 → 真正的回收站（"先移文件再写 DB；DB 失败回移文件"）
> 5. 最近使用：从双源（JSON + SQLite）统一为 SQLite 主源

---

## 一、用户拍板的关键决策

| 决策 | 选 | 不选 |
|---|---|---|
| emoji 业务标识符 | `emojis.id` (INTEGER) | path (TEXT, 路径易变) |
| 删除策略 | 回收站（先移文件再写 DB） | 直接物理删 / 软删但不进回收站 |
| 软删时分组 / 标签关联 | **保留**（`UPDATE is_deleted=1` 不触发 CASCADE） | 随软删一起清 |
| 永久删除时关联 | CASCADE 清 | 保留孤儿关联 |
| 标签多选 | N 个 AND 过滤（SQL 动态拼 N 个 `?`） | 隐式截断到 4 个 |
| 批量收藏 | 单次 `set_emojis_favorite(ids, bool)` 事务 | N 次 `Promise.all` |
| recent 主源 | SQLite (`last_used_at` / `usage_count`) | 旧 `recent-images.json` |
| 搜索 query | 走后端（跨字段 OR） | 纯前端 `String.includes` |
| 分页 | `limit/offset` 传给后端，默认 200 | 全量加载 |
| 路径语义 | `path = COALESCE(managed_path, source_path)`；回收站用 `COALESCE(trash_path, ...)` 三参数 | 单一字段 |

---

## 二、数据模型

### 2.1 新增 4 张表（migration `0002_create_groups_tags.sql`）

```sql
CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_groups_name ON groups(name COLLATE NOCASE);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_tags_name ON tags(name COLLATE NOCASE);

CREATE TABLE emoji_groups (
  emoji_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (emoji_id, group_id),
  FOREIGN KEY (emoji_id) REFERENCES emojis(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE TABLE emoji_tags (
  emoji_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (emoji_id, tag_id),
  FOREIGN KEY (emoji_id) REFERENCES emojis(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

### 2.2 `emojis` 表加 3 列（migration `0003_add_emoji_trash_columns.sql`）

```sql
ALTER TABLE emojis ADD COLUMN deleted_at INTEGER;
ALTER TABLE emojis ADD COLUMN trash_path TEXT;
ALTER TABLE emojis ADD COLUMN trash_thumbnail_path TEXT;
CREATE INDEX idx_emojis_is_deleted_deleted_at ON emojis(is_deleted, deleted_at);
```

**CASCADE 触发规则（用户已澄清）**：
- `ON DELETE CASCADE` 只在物理 `DELETE FROM emojis` 时触发
- `UPDATE emojis SET is_deleted=1, ...` 不触发 → 软删保留分组/标签关联，恢复后立即可用
- 永久删除（`permanently_delete` / `empty_trash`）走 CASCADE 自动清

### 2.3 路径语义矩阵

| 视图 | source_type | is_deleted | `path` | `thumbnailPath` |
|---|---|---|---|---|
| 全部/搜索 | external_directory | 0 | `source_path` | `thumbnail_path` |
| 全部/搜索 | managed/clipboard | 0 | `managed_path` | `thumbnail_path` |
| 回收站 | external_directory | 1 | `source_path` | `thumbnail_path` |
| 回收站 | managed/clipboard | 1 | `trash_path` | `trash_thumbnail_path` |

SQL 投影：`list_indexed / search` 用 `COALESCE(managed_path, source_path)`；`list_deleted` 用 `COALESCE(trash_path, managed_path, source_path)` 三参数。

---

## 三、后端架构

### 3.1 Repository 层

| 文件 | 新增方法 |
|---|---|
| `repositories/emoji_repository.rs` | `list_indexed(options, query, tag_ids)`、`list_deleted`、`fill_relations`、`fill_relations_for_recent`、`search_recent`、`record_image_used`、`set_favorite_for_ids`、`mark_deleted`、`set_trash_paths`、`clear_trash`、`delete_permanently`、`list_deleted_targets`、`add_to_group`、`remove_from_group`、`add_tags`、`remove_tags`、`get_relations_for_ids` |
| `repositories/group_repository.rs`（新） | `list_groups`（带 emoji 计数子查询）、`create_group`、`rename_group`、`delete_group` |
| `repositories/tag_repository.rs`（新） | `list_tags`（带 emoji 计数子查询）、`create_tag`、`rename_tag`、`delete_tag` |

### 3.2 Service 层

`services/trash_service.rs`（新）— 跨 FS-DB 编排：

```
soft_delete(ids) 流程（"先移文件，再写 DB"）：
  1. fs::create_dir_all(trash_dir)
  2. mark_deleted() UPDATE is_deleted=1 + deleted_at
  3. for each target:
     - move_file(managed_path, trash_path)
       - 失败 → rollback is_deleted=0 + push_failure，整行放弃
     - 缩略图 move_file 独立尝试，失败仅记日志，不阻塞
     - set_trash_paths 写库
       - 失败 → 移回原文件 + push_failure
  4. commit 失败 → 兜底回移所有成功行

restore(ids) 流程：与 soft_delete 镜像（先移动回，再清 trash 字段）
permanently_delete(ids)：先删物理文件，再 DELETE 行（CASCADE 清关联）
empty_trash()：分批 100 行处理，先删物理文件再 DELETE
```

**跨盘 fallback**：`fs::rename` 跨盘失败时退化为 `fs::copy + fs::remove_file`。

Group/Tag CRUD 走 Repository 直调，**不**进 service（业务简单，徒增抽象）。

### 3.3 Tauri commands

20 个新 command + 4 个 DTO + 1 个 `show_in_explorer`：

| Command | 返回 | spawn_blocking |
|---|---|---|
| `list_groups / create_group / rename_group / delete_group` | `Vec<GroupDto> / GroupDto / ()` | 否 |
| `list_tags / create_tag / rename_tag / delete_tag` | `Vec<TagDto> / TagDto / ()` | 否 |
| `add_emojis_to_group / remove_emojis_from_group` | `()` | 否 |
| `add_tags_to_emojis / remove_tags_from_emojis` | `()` | 否 |
| `set_emojis_favorite(ids, bool)` | `()`（单事务） | 否 |
| `search_emojis(options)` | `Vec<IndexedEmoji>` | 否 |
| `soft_delete_to_trash / restore_from_trash / permanently_delete_emojis / empty_trash` | `TrashResult` | **是** |
| `list_deleted_emojis` | `Vec<IndexedEmoji>` | 否 |
| `show_in_explorer(path)` | `()` | 否 |

修改：
- `copy_image_to_clipboard` 复制成功后 `EmojiRepository::record_image_used` 写 SQLite
- `get_recent_images` 改 `EmojiRepository::search_recent(50)`（走 SQLite）+ `fill_relations_for_recent` 填充关联

### 3.4 统一搜索 SQL（核心）

```sql
SELECT e.id, e.original_filename,
       COALESCE(e.managed_path, e.source_path) AS current_path,
       e.thumbnail_path, e.file_extension, e.width, e.height, e.file_size,
       e.source_type, e.is_favorite, e.last_used_at, e.usage_count
FROM emojis e
WHERE e.is_deleted = 0
  AND <view 子句>      -- favorites / ungrouped / search-recent / group
  AND <query 子句>     -- 跨字段 OR：filename / tag.name / group.name
  AND <tag_ids 子句>   -- N 个 AND 过滤（反 EXISTS）
ORDER BY
  CASE WHEN ?view = 'search-recent' THEN e.last_used_at END DESC,
  e.is_favorite DESC,
  COALESCE(e.imported_at, e.indexed_at) DESC,
  e.original_filename COLLATE NOCASE ASC
LIMIT ?L OFFSET ?O;
```

**占位符重排**（query / tag_ids 数量动态）：
- view 参数 → query → tag_ids → view string → limit → offset
- 用 `?Q` / `?T0..T(N-1)` 占位符，拼接 SQL 后 `replace` 为实际 `?<index>`

**fill_relations**（避免 N+1）：主查询返回 N 个 id 后，单次 `get_relations_for_ids` 批量查 `emoji_groups` + `emoji_tags`，再按 id 填充 `IndexedEmoji.group_ids / tag_ids`。

---

## 四、前端架构

### 4.1 状态（App.tsx）

```ts
const [currentEmojis, setCurrentEmojis] = useState<IndexedEmoji[]>([]);  // 视图数据源
const [indexedEmojis, setIndexedEmojis] = useState<IndexedEmoji[]>([]);   // all 视图缓存
const [allItems, setAllItems] = useState<IndexedImage[]>([]);              // 兼容旧 UI
const [favorites, setFavorites] = useState<Set<string>>(new Set());        // path-based 兼容
const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());    // 后端操作
const [groups, setGroups] = useState<LibraryGroup[]>([]);
const [tags, setTags] = useState<Tag[]>([]);
const [trashCount, setTrashCount] = useState(0);
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const debouncedQuery = useDebouncedValue(searchQuery, 200);
const tagById = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);
const tagsByPath = useMemo(() => /* currentEmojis → Record<path, name[]> */, ...);
```

### 4.2 useEffect 数据流

```ts
useEffect(() => {
  // 视图变化 / 搜索 query 变化时触发
  searchEmojis({ view, query: debouncedQuery, groupId, tagIds, limit: 500, offset: 0 })
    .then(setCurrentEmojis);
}, [currentView, debouncedQuery, recentItems]);
```

- `trash` 视图走 `listDeletedEmojis`（path 三参数 COALESCE）
- `recent` 视图走 `recentItems` 派生（前端已用 `search-recent` 排序）
- 其他视图走 `searchEmojis({ view, ... })`，后端按视图过滤 + 搜索 OR + tag AND

### 4.3 新增组件

| 组件 | 职责 |
|---|---|
| `GroupDialog` | 侧栏"新建分组"按钮弹出，单 Input 弹窗 |
| `MoveToGroupDialog` | 加入分组弹窗：多选已有分组 + inline 新建 + 提交后切到目标分组视图 |
| `TagPickerDialog` | 管理标签弹窗：勾选已有标签（diff 显示 added/removed）+ inline 新建 + 保存 |
| `TrashPanel`（待 Phase 7） | 回收站视图：每项"恢复"/"彻底删除" |
| `useDebouncedValue` | debounce hook（搜索 query 200ms） |

### 4.4 EmojiItemMenu 按 view 模式区分

| mode | 菜单项 |
|---|---|
| `default`（全部/收藏/未分组） | 收藏 / 复制 / 加入分组 / 管理标签 / 查看文件位置 / 移入回收站 |
| `group` | 收藏 / 复制 / 移至其他分组 / 从当前分组移除 / 管理标签 / 查看文件位置 / 移入回收站 |
| `trash` | 复制 / 查看文件位置 / 从回收站恢复 / 彻底删除 |

### 4.5 表情项标签 chip

- `IndexedEmoji` 加 `groupIds: number[]` / `tagIds: number[]`
- `EmojiGridItem` 接 `tags: string[]` prop（由 `tagsByPath` 派生）
- 右下角渲染前 2 个 tag + `+N` 计数
- 后端 `fill_relations` 在每次 `list_indexed` / `list_deleted` / `search_recent` 后自动填充

---

## 五、关键不变量

1. **路径永远是可读的**：`path` 字段经 COALESCE 投影，未删除项指向原位置，已删除项指向 trash 位置
2. **软删保留关联**：`UPDATE is_deleted=1` 不触发 CASCADE；恢复后分组/标签关系立即可用
3. **CASCADE 只清硬删**：`permanently_delete` / `empty_trash` 内的 `DELETE FROM emojis` 触发 emoji_groups / emoji_tags CASCADE
4. **先移文件再写 DB**：`soft_delete` / `restore` 主图移动成功才写 trash 字段；DB commit 失败回移文件兜底
5. **缩略图失败不阻塞**：trash 移动缩略图失败仅记日志；主图移动失败才整行放弃
6. **external 原文件绝不被修改**：`soft_delete` 对 `external_directory` 行的文件移动全部跳过
7. **批量收藏单次调用**：`set_emojis_favorite(ids, bool)` 一次事务完成；不用 N 次 `Promise.all`
8. **搜索 query 跨字段 OR**：filename / tag name / group name LIKE
9. **N 个 tag AND 过滤**：动态拼 `?` 占位符，无数量上限
10. **分页 limit 200**（临时上限）：前端 `LoadMoreButton`（Phase 7 实现）提醒

---

## 六、用户验收

`MANUAL_ACCEPTANCE.md` 新增章节：

| # | 用例 | 预期 |
|---|---|---|
| 1 | 分组 CRUD | 侧栏 +/+ 增/重命名/删除正常 |
| 2 | 标签 CRUD | 表情项右键 → 管理标签 → 勾选/新建/取消 |
| 3 | 收藏持久化 | 重启后仍存在；批量收藏 5 张只 1 个 `set_emojis_favorite` invoke |
| 4 | 多选（待 Phase 7） | Ctrl/Shift/Ctrl+A + BatchActionBar |
| 5 | 移入回收站 | 确认弹窗；external 原文件不动；managed 物理移至 `trash/` |
| 6 | 恢复 | 物理文件回移；关联保留 |
| 7 | 永久删除 | 二次确认；CASCADE 清关联 |
| 8 | 清空回收站 | 一键清空所有 is_deleted=1 |
| 9 | 路径语义 | 全部/回收站视图缩略图均能渲染 |
| 10 | 搜索 | 文件名/标签/分组跨字段 OR；debounce 200ms |
| 11 | `npm run tauri dev / build` | 均通过 |
| 12 | `cargo test` | 40 passed / 0 failed |

---

## 七、留作后续（Phase 7+）

- **多选 + 批量操作栏**（`BatchActionBar`）：Ctrl/Shift/Ctrl+A、批量加入/移出分组、加/删标签、收藏、移入回收站
- **完整 TrashPanel 视图**：每项"恢复"/"彻底删除"按钮（已在 EmojiItemMenu 提供，UI 容器待补）
- **标签筛选面板**：UI 暴露 `tag_ids: Vec<i64>` 筛选器（API 已有）
- **`useSearchRequest` 过期请求保护**：浮层快速输入避免旧 query 覆盖新 query
- **`LoadMoreButton` 分页提示**：`result.length === limit` 时提醒用户加载更多
- **FTS5 虚拟表**：库 > 5000 时升级全文索引

---

## 八、相关文件

### 数据库
- `src-tauri/migrations/0002_create_groups_tags.sql`（新增）
- `src-tauri/migrations/0003_add_emoji_trash_columns.sql`（新增）
- `src-tauri/src/database/mod.rs`（MIGRATIONS 数组）

### Rust 后端
- `src-tauri/src/repositories/emoji_repository.rs`（扩 +10 方法）
- `src-tauri/src/repositories/group_repository.rs`（新）
- `src-tauri/src/repositories/tag_repository.rs`（新）
- `src-tauri/src/services/trash_service.rs`（新）
- `src-tauri/src/commands.rs`（扩 +20 command）
- `src-tauri/src/scanner.rs`（IndexedEmoji 加 group_ids / tag_ids）
- `src-tauri/src/recent.rs`（RecentImageRecord 加 group_ids / tag_ids）
- `src-tauri/src/lib.rs`（注册 20 个新 command）

### 前端
- `src/types.ts`（IndexedEmoji + Group + Tag + EmojiRelations + SearchOptions + TrashResult）
- `src/lib/tauri.ts`（增 20 个 wrapper）
- `src/App.tsx`（状态重构 + 搜索端化 + 弹窗集成）
- `src/features/library/GroupDialog.tsx`（新）
- `src/features/library/MoveToGroupDialog.tsx`（新）
- `src/features/library/TagPickerDialog.tsx`（新）
- `src/features/library/useDebouncedValue.ts`（新）
- `src/features/library/EmojiItemMenu.tsx`（按 mode 分支）
- `src/features/library/EmojiGridItem.tsx`（加 tags chip + 多模式回调）
- `src/features/library/EmojiGrid.tsx`（透传 tagsByPath / onAddTags）
- `src/features/library/EmojiLibraryView.tsx`（透传）
- `src/app/LibrarySidebar.tsx`（启用"新增分组" + 每分组右键菜单 + 底部"未分组"/"回收站"）
- `src/features/search/QuickSearchWindow.tsx`（走 `search_emojis({view:"search-recent"})`）
