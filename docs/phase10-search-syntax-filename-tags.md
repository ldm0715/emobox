# Phase 10：`组*标签` 精确搜索 + 导入自动文件名标签

> 实施完成。本阶段让表情包能**按「分组*标签名」精确找到**，并为未归组的存量数据兜底：
>
> 1. **搜索语法 `组*标签`**：`parse_exact_query` 在最早出现的 `*` / `:` 处切分（全角 `＊` / `：` 归一化，`:` 保留为别名）。`list_indexed_impl` 从 `exact: bool` 升级为 `SearchMode{Exact, Lenient, FuzzyGroup, PlainLike}`，`list_indexed` 按「精确 → 组精确+标签 LIKE → 组名子串+标签 LIKE → 普通整串 LIKE」四级回退。
> 2. **导入自动打文件名标签**：`commit_staged_as_source_type` 对非剪贴板来源用完整文件名（含扩展名，如 `开心.png`）自动建标签并挂到新表情；失败仅 `log::warn!`，不失败导入。`TagRepository` 新增 `find_or_create_id`。
> 3. **启动一次性回填存量**：`lib.rs::setup` 调用 `ImportService::backfill_filename_tags`（纯 DB、幂等、跳过回收站、批次 500），让存量无标签表情也拿到文件名标签。
> 4. **模糊组名兜底**：组名精确匹配不到（分组不存在 / 表情未归组）时，组名子串去命中 分组名 / 文件名 / 标签名 任一，再叠加标签子串 —— 未归组的表情包也能 `包名*表情` 搜到（分组存在时精确优先）。
> 5. **前端镜像**：新建 `src/lib/searchSyntax.ts`（TS 版解析 + 过滤），recent 视图客户端过滤走同一回退阶梯；`RecentImageRecord` 补 `groupIds/tagIds`，顺带修复 recent 投影 `id:0` 隐患。

---

## 一、用户拍板的关键决策

| 决策 | 选 | 不选 |
|---|---|---|
| 分隔符 | `*` 为主（全角 `＊` 归一化），`:` / `：` 保留为别名。Windows 文件名不含 `*`，天然无歧义 | 只保留冒号 / 弃用冒号 |
| 自动标签名 | **完整文件名含扩展名**（`开心.png` → 标签 `开心.png`） | 去扩展名 stem |
| 剪贴板收藏 | **不打标签**（合成名 `clipboard-…` 无搜索意义） | 所有导入统一打标 |
| 存量回填 | **启动时一次性回填**（纯 DB，立即生效，幂等） | 惰性随导入补 / 不回填 |
| 组名不精确时的兜底 | 组名子串命中 分组名/文件名/标签名 任一 + 标签子串（**分组存在时精确优先**） | 组名不匹配就返回空 |

**为什么标签用完整文件名而非去扩展名**：搜索的宽松回退是「标签 LIKE」，`%开心%` 能命中标签 `开心.png`；但若标签存 stem `开心`，查询 `组*开心.png` 时 `%开心.png%` 匹配不到 `开心`，反而落空。用完整文件名 + LIKE 回退，`组*开心`（省略扩展名）和 `组*开心.png`（网格显示名）都能命中。

**为什么要有模糊组名兜底**：真机诊断发现用户的表情包大量**未归组**（`2233*来吗` 搜不到，因为打 `来吗` 标签的表情不在任何分组）。严格「组精确 AND 标签」对未归组数据完全不可用，故加最后一层：组名子串去匹配文件名/分组名/标签名。

---

## 二、搜索语法（`src-tauri/src/repositories/emoji_repository.rs`）

### 2.1 `parse_exact_query`

```rust
/// `组名*标签名` 为主（全角 `＊` 归一化），`组名:标签名` 保留为别名（全角 `：` 归一化）。
/// 在最早出现的 `*` 或 `:` 处切分成两部分。
/// 返回 `(组名, 标签名)`；无分隔符或两侧都为空 → `None`（走普通 LIKE）。
```

- 归一化 `：`→`:`、`＊`→`*`；取最早出现的 `*` 或 `:` 位置切片成 `(left, right)`，两侧 trim。
- 两侧都空（如 `*`）→ `None` → 普通 LIKE。
- 支持 `组名*标签名` / `组名*` / `*标签名` / `组名:标签名` / `组名:` / `:标签名`。

### 2.2 `SearchMode` 枚举（替换原 `exact: bool`）

| 模式 | 组约束 | 标签约束 |
|---|---|---|
| `Exact` | `g.name = ? COLLATE NOCASE` | `t.name = ? COLLATE NOCASE` |
| `Lenient` | `g.name = ? COLLATE NOCASE` | `t.name LIKE '%' || ? || '%' COLLATE NOCASE` |
| `FuzzyGroup` | `g.name LIKE '%x%'` **OR** `LOWER(original_filename) LIKE '%x%'` **OR** `t.name LIKE '%x%'`（组名子串，绑定 3 次） | `t.name LIKE '%x%'`（若标签部分存在） |
| `PlainLike` | 整串跨字段 OR（文件名 / 标签名 / 分组名），绑定 3 次 | 同左 |

`list_indexed_impl` 的调用点只有 `list_indexed` 内部，改动封闭。`tag_ids`（除法语义：必须同时拥有所有给定标签）在模式分支**之后**追加，与模式无关。

### 2.3 `list_indexed` 回退编排

```
parse → None            → PlainLike
Exact                   → 非空即返回
(tag 存在) Lenient      → 非空即返回
(group 存在) FuzzyGroup → 非空即返回
PlainLike
```

- Lenient 只在标签部分存在时调用（组精确 + 标签 LIKE 才有意义）。
- FuzzyGroup 只在组名部分存在时调用（组名子串才需要兜底）。
- PlainLike 兜底保留，处理含字面分隔符的文件名场景（如 `foo:bar.png`，Windows 上本不会出现但测试锁定该行为）。

### 2.4 锁步参数绑定

FuzzyGroup 分支组名子串在 SQL 里出现 3 次（分组名 / 文件名 / 标签名），`params` Vec 对应 push 3 次克隆；标签 LIKE 再 push 1 次。延续「SQL `?` 出现顺序与 `params` 完全一致」的不变量。

---

## 三、导入自动打文件名标签

### 3.1 `TagRepository::find_or_create_id`（`tag_repository.rs`）

先 `SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE`，命中直接返回；未命中走既有 `create_tag`。空名 → Err。幂等。

### 3.2 挂载点（`import_service.rs::commit_staged_as_source_type`）

`insert_managed` 成功、构造 `ImportOneOutcome::Imported` 之前：

```rust
if source_type != "clipboard" && !original_filename.trim().is_empty() {
    match TagRepository::find_or_create_id(connection, original_filename)
        .and_then(|tag_id| EmojiRepository::add_tags(connection, &[tag_id], &[insert_result.emoji_id]))
    {
        Ok(()) => {}
        Err(error) => log::warn!("导入自动打标签失败 emoji_id={} …", insert_result.emoji_id),
    }
}
```

- 标签名 = `original_filename`（完整文件名含扩展名）。
- 剪贴板合成名（`clipboard-YYYYMMDD…png`）无搜索意义，跳过。
- **任何标签失败只 `log::warn!`，不失败导入**（标签是锦上添花；emoji/分组事务已提交）。

---

## 四、启动一次性回填存量（`lib.rs` + `import_service.rs`）

- `EmojiRepository::list_untagged_emojis(connection, limit)`：活跃（`is_deleted = 0`）且无任何标签的行，返回 `(id, original_filename)`。
- `ImportService::backfill_filename_tags(connection, batch)`：取一批 → 逐条 `find_or_create_id` → `add_tags`，返回实际回填数。幂等（只处理无标签行）。
- `lib.rs::setup` 在 `app.manage(database_state)` 之后循环调用（批次 500），直到返回 < batch；任何失败仅 `log::warn!`，不阻塞启动。

**与感知哈希回填的区别**：`backfill_perceptual_hashes` 要解码图片所以惰性分批；标签回填是纯 DB 操作，便宜，故启动时一次性补全。

---

## 五、前端（`src/lib/searchSyntax.ts` + `App.tsx` + placeholder）

- `src/lib/searchSyntax.ts`：`parseExactQuery`（TS 镜像）+ `filterItemsByQuery`（精确 → 组精确+标签子串 → 组名子串+标签子串 → 整串子串）。recent 视图客户端过滤与后端语义一致。
- `RecentImageRecord` 补 `groupIds: number[]` / `tagIds: number[]`（后端 `fill_relations_for_recent` 早就填充并序列化，前端此前丢弃）。
- `App.tsx` recent 视图映射保留 `r.groupIds` / `r.tagIds` 并用 `filterItemsByQuery`；顺带把合成 `id: 0` 改为 `r.item.id`（recent 网格按 id 取缩略图，`id:0` 会查空）。
- 主窗口 `AppToolbar` 与浮层 `QuickSearchContent` 的 placeholder 改为「搜索表情、标签或分组（组*标签）」。

主窗口四个列表视图（all / favorites / ungrouped / group）走后端 `search_emojis`，浮层同理 —— 只有 recent 视图是客户端过滤，需要镜像。

---

## 六、真机诊断案例（`2233*来吗` 搜不到）

用户反馈 `2233*来吗` 完全搜不到。直接查 `%APPDATA%/com.emobox.app/emobox.sqlite3`：

- 打 `来吗` 标签的表情 `[2233绘梦酱_吹哨子].png`（emoji 194）**不在任何分组**（只有手动 `来吗` 标签；启动回填只处理「完全无标签」的行，所以它也没拿到文件名标签）。
- `2233` 分组不存在或为空（快照里只剩 `cat` 一个组）。
- 用等价 SQL 验证：`2233*来吗`（组精确+标签）0 条；`*来吗`（仅标签）命中 194。

结论：**代码行为正确，是数据未归组**。随后加 FuzzyGroup 兜底，再用真实数据验证：`2233*来吗` 命中 emoji 194。

**附：外键核查**：应用一直启用 `PRAGMA foreign_keys`（`database.rs::configure_connection`）。库中「emoji 198 残留指向已删 `2233` 组」的孤儿行是历史遗留（FK 不会自动清理既有孤儿），无害。删分组/标签当前会正确 CASCADE。

---

## 七、关键不变量（Phase 10 新增）

- `组*标签` 精确 AND 优先；组精确命中为空才走 Lenient / FuzzyGroup / PlainLike，**分组存在时精确匹配不退化**。
- 自动标签 = 完整文件名含扩展名；剪贴板收藏不打标签。
- 回填幂等：只处理「无任何标签的未删除行」；已手动打标的存量不会被补文件名标签。
- 标签失败（导入 / 回填）一律非致命，只 `log::warn!`。
- `searchSyntax.ts` 与 Rust `list_indexed` 保持同一回退阶梯；新增层级必须两边同步。

## 八、已知边界 / 风险

- **手动打过标签的表情不会自动补文件名标签**：回填只看「无任何标签」，`[2233绘梦酱_吹哨子].png`（有手动 `来吗`）就搜不到 `*吹哨子`。如需可改成「缺文件名标签就补」，属后续增强。
- FuzzyGroup 是最后兜底，命中面较宽（组名子串命中文件名/分组名/标签名任一）；只做标签子串叠加，不做组名与标签互换。
- PlainLike 对含 `*` 的查询基本无意义（字面 `*` 不会出现在任何字段），保留只为 `:` 文件名场景（Windows 实际不可达，测试锁定）。
- recent 视图镜像依赖 `RecentImageRecord.groupIds/tagIds` 由后端填充；旧版本后端不返回这两字段时 TS 类型为必填，若出现 `undefined` 会异常（当前后端恒返回）。

## 九、验证

- `cargo check`、`cargo clippy -- -D warnings` ✅
- `cargo test`：**123 passed**（新增 `*` 分隔符、组/标签单独、全角 `＊`、Lenient 回退、FuzzyGroup 命中未归组包、导入自动打标、剪贴板跳过、回填幂等跳过回收站等）✅
- `npm run build`（tsc + vite）、`npx vitest run`：**25 passed**（`searchSyntax.test.ts` 11 例：解析、精确、Lenient、FuzzyGroup、整串子串）✅
- 真机数据核对：`2233*来吗` → 命中 `[2233绘梦酱_吹哨子].png`；`*来吗` → 命中同一表情 ✅
- 手动清单：导入文件夹 → 每个表情带文件名标签；主窗口 / 浮层输入 `组*名`、`组*`、`*名`、`组:名` 都能搜；未归组包用 `包名*表情` 能搜；recent 视图同语法；剪贴板收藏无标签。
