# Phase 28：表情重命名（单张右键重命名 + 分组视图批量模板编号）

> 实施完成。需求来源：很多表情图片下载下来文件名是一串乱码（如 `鲸鱼abc123.png`），需要能改名；分组视图的多选再加一个「批量重命名」——输入一个模板名，其余图片按模板编号（`鲸鱼1.png`、`鲸鱼2.png`…）。核心设计：**显示名（`emojis.original_filename`）与磁盘文件（`sha256.ext`）完全解耦**——重命名只 UPDATE SQLite 一列，绝不触碰文件系统；但导入时自动打的「文件名标签」是文件名快照，重命名必须同步（打新名标签、删旧名标签），否则 `组*新名` 搜不到、`组*旧名` 反而能搜到。

---

## 一、用户确认的四个决策

| 决策点 | 结论 |
|---|---|
| 批量编号规则 | **全部编号、无裸名**：模板「鲸鱼」+ 3 张 → `鲸鱼1.png`、`鲸鱼2.png`、`鲸鱼3.png`（没有一张保留裸名 `鲸鱼.png`） |
| 文件名标签同步 | **同步更新**：打上新名标签，旧名标签从该表情移除；无人引用（含软删行的关联）时物理删标签行 |
| 批量入口范围 | **仅分组视图**（`menuMode === "group"`）；单张重命名在所有非回收站视图的右键菜单 |
| 编号顺序 | **当前视图排序**（`selectedItems` 保持 `items` 顺序 = 网格显示顺序；用户想控制编号结果可先切排序） |

## 二、显示名与磁盘文件为什么解耦（改动前探明）

- 磁盘文件名在 `asset_service.rs::StagedAsset::commit` 生成：`emojis_directory.join(format!("{}.{}", sha256, file_extension))`——**sha256 十六进制 + 扩展名**，与原始文件名毫无关系。重命名显示名不需要动文件。
- 列表投影 `row_to_indexed_emoji`：`IndexedEmoji.name` 直接来自 `original_filename` 列；排序 `name-asc/desc` 也是 `ORDER BY e.original_filename COLLATE NOCASE`。改这一列即全链路生效。
- `original_filename` **无唯一约束**（0001 迁移只有 source_path / managed_path / sha256 唯一）——允许重名。磁盘名是 sha256 无冲突风险；同名文件名标签经 NOCASE find-or-create 自然合并为同一标签。
- 唯一的耦合副作用：`import_service.rs::commit_staged_as_source_type` 在导入后用**完整文件名（含扩展名）**打标签（`组*开心` / `组*开心.png` 精确搜索依赖它）。改版前全仓库**不存在任何** `UPDATE emojis SET original_filename` 的代码。

## 三、Rust 侧

### 3.1 `emoji_repository.rs`：`rename_emojis`（单事务）

```
pub fn rename_emojis(connection, renames: &[(i64, String)]) -> Result<(), String>
```

事务内逐条处理：

1. **前置校验**（开事务前逐条跑完，任一非法整体不进事务）：`validate_display_filename`——trim 空 / Windows 非法字符 `/ \ : * ? " < > |` / `\x00`-`\x1F` 控制字符 / 255 字符上限 → 中文 Err。显示名虽不落盘，但用户预期它就是文件名。
2. `SELECT original_filename WHERE id = ? AND is_deleted = 0` 取旧名（软删 / 不存在的 id **静默跳过**，不报错——批量操作里混进软删行不该让整批失败）。
3. `UPDATE emojis SET original_filename = ?, updated_at = ?`（`updated_at` 事务内一并刷新，不走 `touch_updated_at`——那不是事务安全的）。
4. **文件名标签同步**（仅当新旧名 NOCASE 不相等）：
   - **先加**新名标签：`SELECT id FROM tags WHERE name = ? COLLATE NOCASE`，无则 `INSERT INTO tags`；`INSERT OR IGNORE INTO emoji_tags`。
   - **再删**旧名标签：查旧名 tag id → `DELETE FROM emoji_tags WHERE emoji_id = ? AND tag_id = ?` → 引用计数 `SELECT COUNT(*) FROM emoji_tags WHERE tag_id = ?` → **计数 0 才** `DELETE FROM tags`。

三个承重细节（都踩过/推演过才定下来）：

- **不能复用 `add_tags` / `remove_tags` / `TagRepository::find_or_create_id`**——它们各自内部开事务，rusqlite 事务不可嵌套。标签同步全部内联 SQL（新增模块级 `find_or_insert_tag(&Connection, name, now)`，同语义但不自开事务）。
- **引用计数不过滤 `is_deleted`**：软删表情保留 emoji_tags 关联（CASCADE 只在物理 DELETE 触发），按全量关联计数才能保证「回收站恢复后文件名标签仍在」。孤儿标签物理删除的理由：`TagPickerDialog` 列表按引用计数展示，留孤儿会污染选择器。
- **新旧名 NOCASE 相同跳过标签同步**：否则「仅大小写变化」的重命名会走一遍先删后加，中间态计数为 0 可能把仍在用的标签行误删；此时 `original_filename` 照常 UPDATE（大小写变化生效）。
- 顺序「先加后删」保证新标签先落地，标签查找/创建失败整体 Err 回滚（用户显式操作，错误应可见——与导入打标签失败仅 warn 不同）。

### 3.2 命令层

`commands.rs` 新增同步命令（与 `set_emojis_favorite` 同型，纯 SQLite 无需 `spawn_blocking`）：

```rust
#[derive(Deserialize)] #[serde(rename_all = "camelCase")]
pub struct RenameEntry { pub emoji_id: i64, pub filename: String }

#[tauri::command]
pub fn rename_emojis(app, database_state, renames: Vec<RenameEntry>) -> Result<(), String>
```

**一个命令同时服务单张（`vec![一条]`）与批量**——符合「批量命令接受 Vec、不要加单 id 新命令」的既定约定。成功后 `notify_library_changed`（快捷搜索浮层收到 `library-changed` 自动重载）。`lib.rs` invoke_handler 注册（命令数 46 → 47）。

## 四、前端侧

### 4.1 纯函数 `src/features/library/batchRename.ts`（新）

| 函数 | 职责 |
|---|---|
| `stripExtension(filename)` | 剥最后一个 `.ext`（无 `.` / 点文件原样返回）——单张弹窗初始值 |
| `normalizeExtension(ext)` | 去前导点、转小写（`PNG` / `.png` → `png`） |
| `validateRenameStem(stem)` | Rust `validate_display_filename` 的 **TS 镜像**，合法返回 null——前端优先拦截，Rust 兜底 |
| `buildBatchFilenames(template, extensions)` | 第 i 项 = `` `${trim(template)}${i+1}.${ext}` ``，全部编号、空扩展名不加 `.` |

校验规则前后端同源（空名 / 非法字符 / 控制字符 / 255 上限），改一边必须同步另一边。

### 4.2 弹窗 `src/features/library/RenameEmojiDialog.tsx`（新，single/batch 双模式）

仿 `GroupDialog`（create/rename 双模式先例）：

- 输入框只收**主名 / 模板**（不含扩展名）；single 提示「扩展名 .png 将自动保留」，batch 提示「将按当前排序依次命名为 模板1、模板2…（各保留原扩展名）」。
- open 键控快照 effect（open 变 true 写初始值、清 error——防退场动画期间 props 闪回退值）、错误 span + `FadeSnappy`、busy 禁用、Enter 提交、`DialogSurface` 宽度 `min(420px, calc(100vw - 48px))`。
- 校验错误**实时**显示（输入了内容才显示，空输入不弹「名称不能为空」）；提交异常进 error span（`getErrorMessage`）。

### 4.3 接线

- **右键菜单**（`EmojiItemMenu`）：default / group 两分支加 `{!multi && onRename && 「重命名」}`（`Rename20Regular` 图标，位置在「管理标签」后）；trash 分支不渲染。`EmojiGrid` 共享 Menu 透传 `onRename={() => onRename(targetItems)}`（不进卡片，不影响 memo）。
- **批量条**（`EmojiLibraryView`）：`menuMode === "group"` 时渲染「批量重命名」按钮——仅分组视图成立，天然排除 trash / all / favorites / ungrouped / recent；`selectedItems` 保序 = 当前排序，编号按此分配。
- **App.tsx**：`renameEmojiState: { id, name, extension } | null`（单张）、`batchRenameState: IndexedImage[] | null`（批量，顺序即编号顺序）、共用 `renameEmojiBusy`；两个 `RenameEmojiDialog` 常挂载 + open 控制；键盘快捷键豁免列表（`dialogOpen`）追加两个 state；`handleRenameEmoji` 读 `currentViewRef` 防御拒绝 trash（第三重守卫，前两重是菜单不渲染 / 批量条不显示）。

## 五、重命名后的视图刷新策略

**本地改名 + 视图重拉，两者都做**（`prepareAfterImport` 同款组合）：

- `setCurrentEmojis` 本地替换改名项为新对象——新引用让 `viewItems` 投影 / `tagsByPath` 的 WeakMap 身份缓存自动重投影，界面即时反馈（Phase 18 性能不变量不破坏）。
- `refreshSidebar()`：标签列表可能增删（文件名标签同步）。
- `setViewReloadTick(t => t + 1)`：重拉第 1 页修正 name-asc/desc 排序位置与 tagIds（新标签 id 前端拿不到，只能重拉）。landingKey 不变 → 不递增 viewGeneration、不重播入场动画、不重置滚动（Phase 17/22 语义）。
- `setRecentItems` 对改名 id 的 `item.name` 补丁（recent 视图数据源在客户端，`recentItems` 本身是视图 effect 的 dep）。
- 快捷搜索浮层：`rename_emojis` 命令里的 `notify_library_changed` 自动覆盖，前端零额外处理。

## 六、边界情况

| 场景 | 行为 |
|---|---|
| 重名 | 允许（无唯一约束；磁盘 sha256 名无冲突） |
| 非法字符 | 前端镜像校验优先拦截（弹窗内联）；Rust 兜底（错误消息透传回弹窗显示） |
| trash 视图 | 三重排除：菜单 trash 分支不渲染 / 批量条按钮仅 `menuMode === "group"` / App 处理器读 `currentViewRef` 拒绝 |
| clipboard 来源 | 导入时不打文件名标签 → 重命名只补新名标签，移除步骤无操作 |
| 新旧名 NOCASE 相同 | 跳过标签同步；`original_filename` 照常 UPDATE（大小写生效） |
| 批量中混入软删 id | `is_deleted = 0` 守卫静默跳过 |
| 空 renames | repo 层早退 `Ok(())` |
| 批量任一条目非法 | 事务前校验整体失败，零半成品 |

## 七、测试

**Rust**（`emoji_repository.rs` `#[cfg(test)]`，in-memory + run_migrations 样板，9 个新用例）：改名生效 + updated_at 刷新 / 标签同步（旧删新增）/ 孤儿标签删除 vs 他人引用保留 / NOCASE 复用既有标签 / 无旧标签时补新标签 / 同名跳过标签 churn / 软删行忽略 / 非法文件名逐个拒绝 / 批量原子性。

**JS**（`batchRename.test.ts`，第 9 个 vitest 文件，14 用例）：编号 1..n 无裸名 / 混合扩展名各自保留并规范化 / 空扩展名不加点 / `stripExtension` 三态 / 非法字符逐个 / 控制字符（`String.fromCharCode(1)`，避免源码嵌裸控制字节被工具链吞掉）/ 中文名合法 / 模板先 trim。

**验收链**：`cargo fmt --check` + `cargo check` + `cargo clippy -D warnings` + `cargo test`（188 passed）+ `npm run build` + `npx vitest run`（63 passed）。

## 八、手动验收要点

1. 右键单张 → 重命名 → 输入「鲸鱼」→ 卡片名变 `鲸鱼.png`；`组*鲸鱼` / `鲸鱼` 搜索能命中，`组*旧文件名` 搜不到。
2. 分组视图多选 3 张 → 批量条「批量重命名」→ 模板「鲸鱼」→ 按当前排序得到 `鲸鱼1/2/3.png`；先切到「按名称排序」可控制编号顺序。
3. trash 视图右键菜单无「重命名」；非分组视图批量条无「批量重命名」按钮。
4. 快捷搜索浮层（`Ctrl+Alt+Space`）搜新名能搜到（`library-changed` 自动重载）。
5. 「按修改时间排序」下重命名项排到最前（`updated_at` 刷新生效）。
