# Phase 13：侧边栏分组区重设计（搜索 / 滚动 / 置顶 / 空间压缩）

> 实施完成。侧边栏（`src/app/LibrarySidebar.tsx`）分组区的一次**前端布局重构 + 一个小后端功能**：
>
> 1. **分组搜索收进按钮**：搜索框不再常驻，点击「我的分组」标题栏右侧的 🔍（在 ＋ 左侧）才展开，自动聚焦；再点收起。
> 2. **分组列表独立滚动**：分组列表是侧边栏唯一 `flex:1` 弹性区，占满剩余高度、多则内部滚动（6px 细滚动条）。
> 3. **置顶分组**：分组右键菜单新增「置顶 / 取消置顶」，置顶组排到列表顶部，持久化到 SQLite（新迁移 0006 加 `groups.is_pinned` 列）。
> 4. **空间压缩**：固定项全部紧凑——导航行 28px、快捷键单行 32px、分隔线边距 4px、根 padding 6px；删掉「资料库」标题和快捷键副标题。
> 5. **布局顺序**：全部表情/最近使用/收藏 在最顶，「我的分组」在下方（吃掉剩余空间），未分组/回收站、快捷键/设置 紧凑贴底。
>
> 中间经历了三轮布局模型反复（自然高度 ↔ flex 撑满 ↔ 全栏滚动），最终按用户拍板定为「分组列表 flex:1、其余固定紧凑」。决策细节见「二、布局模型迭代」。

---

## 一、用户拍板的关键决策

| 决策 | 选 | 不选 |
|---|---|---|
| 分组搜索形态 | **按钮收纳**：标题栏右侧 🔍（＋ 左侧），点击才展开输入框，再点收起 | 搜索框常驻外露 |
| 置顶持久化 | **新迁移 0006 加 `is_pinned` 列**，`list_groups` ORDER BY 承担排序 | 复用闲置的 `sort_order` 做哨兵值（语义混淆，未来手动排序会冲突） |
| 布局模型 | **侧边栏撑满窗口 + 分组列表 `flex:1` 吸收剩余空间（「我的分组」变长）+ 其余固定紧凑高度** | ① 全栏按内容自然高度（分组少时撑不满）② 全栏整体滚动（底部固定项会滚出视口） |
| 空间优先级 | 全部表情/最近使用/收藏 固定最顶；未分组/回收站/快捷键/设置 固定紧凑贴底；空白只允许出现在「我的分组」区内 | 让任何空白落在固定项之间 |
| `set_group_pinned` 语义 | 只改 `is_pinned` + 组行 `updated_at`；**不**刷新成员表情 `updated_at`；**不**发 `notify_library_changed` | 视为内容修改（会波及表情修改时间与快速搜索结果） |

---

## 二、布局模型迭代（为什么最终是这样）

三轮「空白条」反馈驱动的反复，最终收敛：

| 轮次 | 模型 | 问题 |
|---|---|---|
| 1 | 分组区自然高度 + 底部 `spacer { flex:1 }` | 分组一多就被根 `overflow:hidden` 裁掉，不可滚动 |
| 2 | 分组列表 `flex:1` + 内部滚动，固定项自然高 | 分组少时 `flex:1` 空白区顶在「未分组/回收站」「快捷键」上方 → 用户反馈「未分组上面怎么有那么多空间」 |
| 3 | 整栏内容自然高度 + 根 `overflow-y:auto`（`alignSelf:start` + `maxHeight:100%`） | 分组少时**整栏撑不满**，用户反馈「这样撑不起来了」 |
| **4（最终）** | **根 `height:100%` + `overflow:hidden`；分组列表 `flex:1; min-height:0; overflow-y:auto`；其余全部固定紧凑** | 用户拍板：「把其他部分的固定高度缩短，把我的分组弄长」。空白只属于「我的分组」区 |

关键结论：**侧边栏必须撑满窗口**，剩余空间**只**给「我的分组」，其余部分给刚好撑住自己组件的高度——这样既不出现固定项之间的孤立空白，也让「我的分组」始终是长区。

---

## 三、后端改动（置顶持久化）

### 3.1 迁移 `src-tauri/migrations/0006_add_group_pinned.sql`

```sql
ALTER TABLE groups ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
```

- `DEFAULT 0` 自动回填存量行；`DEFAULT 0` 也保证 `list_groups` 现有测试顺序不变。
- **不建索引**：分组几十行，普通索引无加速（与 Phase 8 `perceptual_hash` 不加索引同理）。
- `src-tauri/src/database/mod.rs`：`MIGRATIONS` 数组追加 `(6, ...)`；测试 `migrations_are_idempotent_and_create_required_schema` 的 `migration_count` 断言 5→6，并新增断言 `groups` 表含 `is_pinned` 列。

### 3.2 `src-tauri/src/repositories/group_repository.rs`

- `GroupRow` 加 `pub is_pinned: bool`；`list_groups` 的 SELECT 加 `g.is_pinned`，ORDER BY 改为 **`g.is_pinned DESC, g.sort_order ASC, g.id ASC`**（置顶组在前，组内仍按原 sort_order/id 序）。
- `create_group` 返回 `is_pinned: false`；`rename_group` 回读带 `is_pinned`。
- 新增：

```rust
pub fn set_group_pinned(connection: &Connection, id: i64, pinned: bool) -> Result<(), String> {
    let updated = connection
        .execute(
            "UPDATE groups SET is_pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![pinned, unix_time_millis(), id],
        )
        .map_err(|error| format!("无法更新分组置顶状态：{error}"))?;
    if updated == 0 {
        return Err(format!("找不到要置顶的分组：{id}"));
    }
    Ok(())
}
```

**注意**：取 `&Connection`（单条 UPDATE，无需事务）；**不**连带刷新成员表情 `updated_at`——置顶只是侧栏排序，不改变表情内容，与 `rename_group` / `delete_group`（算"修改内容"、会刷成员）语义区分。

### 3.3 `src-tauri/src/commands.rs` + `lib.rs`

- `GroupDto` 加 `pub is_pinned: bool`（`#[serde(rename_all="camelCase")]` 自动产出 `isPinned`）；`From<GroupRow>` 同步映射。
- `delete_group` 后新增命令，**同步**函数、**不**调 `quick_search::notify_library_changed`（置顶不影响快速搜索结果——浮层只监听 `library-changed`）：

```rust
#[tauri::command]
pub fn set_group_pinned(
    database_state: State<'_, database::DatabaseState>,
    id: i64,
    pinned: bool,
) -> Result<(), String> {
    let connection = database_state.connect()?;
    GroupRepository::set_group_pinned(&connection, id, pinned)?;
    Ok(())
}
```

- `lib.rs` 的 `generate_handler!` 在 `commands::delete_group` 后注册。

### 3.4 测试

- 新增 `set_group_pinned_toggles_and_orders`：建两组 → 置顶第二个 → `list_groups` 置顶者在前；取消置顶恢复 id 序；对不存在 id 报错。

---

## 四、前端改动

### 4.1 数据接线

- `src/types.ts`：`LibraryGroup` 加 `isPinned: boolean`。
- `src/lib/tauri.ts`：加 `setGroupPinned(id, pinned)`。
- `src/App.tsx`：import `setGroupPinned`；`<LibrarySidebar>` 挂载处新增 `onTogglePinGroup`（成功后 `refreshSidebar()` 重拉 `list_groups()`——排序由后端 ORDER BY 完成，**前端不重排**；失败 `setError(getErrorMessage(e))`，与既有分组操作同款错误模式）。

### 4.2 `src/app/LibrarySidebar.tsx`（主要工作）

**最终 DOM 顺序**：

```
<aside root>
  全部表情 / 最近使用 / 收藏          ← 固定最顶（nav）
  ── Divider ──
  我的分组 [🔍][＋]                   ← 标题栏，🔍 在 ＋ 左侧
  SearchBox（searchOpen && !collapsed && groups>0 时渲染）
  分组列表（navigation + groupList）  ← 唯一 flex:1 弹性/滚动区
  ── Divider ──
  未分组 / 回收站                     ← 固定紧凑
  ── Divider ──
  快捷键（单行）/ 设置                ← 固定紧凑
</aside>
```

**分组搜索（按钮收纳）**：
- `searchOpen` state；标题栏右侧 `groupHeaderActions` 里 🔍 按钮（`appearance={searchOpen ? "secondary" : "subtle"}` + `aria-pressed`）切换开合。
- 展开时 `SearchBox` 自动聚焦（`useRef<HTMLInputElement>` + effect）；再点 🔍 收起。
- **过滤只在展开时生效**：`filteredGroups = searchOpen && trimmedQuery ? filter : groups` —— 避免「收起搜索框但残留关键词仍在过滤」的隐藏过滤 bug。
- 折叠侧边栏时 effect 重置 `searchOpen`。
- 无匹配显示「无匹配分组」（复用 `emptyGroup` 样式）；`groups.length === 0` 仍显示「还没有分组」。

**置顶 UI**：
- 分组右键菜单在「重命名」前加「置顶/取消置顶」MenuItem（`group.isPinned ? PinOffRegular : PinRegular`）。
- 置顶分组的名字前渲染小号 `PinRegular fontSize={12}`（`pinLabel` flex span，包住图标+名字，`minWidth:0` 保省略号）。

**空间压缩指标**：

| 元素 | 值 |
|---|---|
| 导航行 `navItem` minHeight | **28px** |
| 快捷键提示块 `hintButton` | **单行 32px**（删副标题「在聊天时快速找图」，hover tooltip 仍含完整说明） |
| 分隔线 `divider` 上下边距 | **4px**（`spacingVerticalS`） |
| 根 `root` padding | **6px 上下 / 8px 左右** |
| `groupHeader` 高 | 28px |
| 已删除 | 「资料库」`sectionTitle`、`hintText`、`shortcutDescription` 样式 |

**滚动**：根 `height:100%` + `overflow:hidden`；分组列表 `flex:1; min-height:0; overflow-y:auto; overflow-x:hidden` + 6px `::-webkit-scrollbar`（thumb `colorNeutralStroke3`）。

---

## 五、关键不变量（Phase 13 新增）

- **分组列表是侧边栏唯一弹性/滚动区**（`flex:1; min-height:0; overflow-y:auto`）。`min-height:0` 必须有，否则 flex `min-height:auto` 阻止收缩、滚动失效。其余部分固定紧凑，**不要再给任何固定项 `flex` 或大留白**。
- 置顶排序唯一入口是后端 `list_groups` 的 `ORDER BY is_pinned DESC, sort_order, id`；前端从不在本地重排 `groups`。
- `set_group_pinned` 语义边界：不刷成员 `updated_at`、不发 `notify_library_changed`。若未来有人把置顶改成"修改内容"类操作，需重新审视这两条。
- 搜索框收起后过滤必须失效（`searchOpen` 参与 `filteredGroups` 条件）。
- 折叠态：`overflow-x:hidden` 防 6px 滚动条压窄 44px 图标行（图标居中仍完整可见）；搜索 state 在折叠时重置。
- **图标陷阱**：`Pin24Regular` / `PinOff24Regular` 不存在于 `@fluentui/react-icons@2.0.338`，必须用 `PinRegular` / `PinOffRegular`。

---

## 六、已知边界 / 风险

- **Fluent `Divider` 默认 `flex-grow: 1`（Phase 13 后实测发现的坑）**：`@fluentui/react-divider@9.7.4` 的 root 样式自带 `flex-grow: 1`。侧栏是 flex column，本设计「分组列表 `flex:1` 独占剩余空间」会因此失效——每个 `<Divider>` 都参与平分剩余高度（分隔线被撑到约 95px、细线因 `align-items:center` 居中在空壳里，分组列表只分到约 1/4 空间，只能显示三四个分组）。修法：`LibrarySidebar.tsx` 的 `divider` 样式显式 `flexGrow: 0` + `flexShrink: 0`（Griffel 中用户类在组件默认类之后合并，可覆盖）。审计结论：`TagPickerDialog` / `MoveToGroupDialog` 里的 Divider 处于内容自然高度的 flex column（对话框只有 `maxHeight`），没有可吸收的富余空间，无需处理。**今后任何 flex column 里放 Fluent `Divider` 都要先想这件事。**
- 折叠态分组多时，滚动条占位会使图标行右侧窄 6px；`overflow-x:hidden` + 图标居中兜底，无裁剪。若日后想要真正的 overlay 滚动条，需放弃自绘 `::-webkit-scrollbar`（那时 Chromium 用系统 overlay 滚动条，不占位）。
- 导航行 28px 属紧凑档，点击目标偏小；用户明确要求极限压缩。若觉挤可回 30px，代价是少看一两个分组。
- 分组少时，「我的分组」区的 `flex:1` 空白是**用户接受的"拉长"效果**，不要再去掉 `flex:1`（否则回到「撑不起来」）。
- 删了「资料库」标题与快捷键副标题，属有意取舍；若用户想要回其中任一项，单行回退即可。
- 移动端/窄屏未适配（本项目 Windows 优先，本就 `overflow:hidden` 定宽布局）。

---

## 七、验证

- `cargo check` ✅；`cargo clippy -- -D warnings` ✅
- `cargo test`：**131 passed**（含新 `set_group_pinned_toggles_and_orders`、迁移计数 6、`groups.is_pinned` 列断言）
- `npm run build`（tsc --noEmit + vite）✅
- `npx vitest run`：**25 passed**（布局/置顶改动不影响逻辑测试）
- 手动清单：建十几个分组 → 分组列表独立滚动、其余固定项贴底；点击 🔍 展开搜索、自动聚焦、无匹配空态、收起后过滤失效；置顶某组 → 跳顶 + 图钉 + 菜单变「取消置顶」，重启仍在；折叠侧栏 → 搜索重置、分组图标行仍可滚动；全部表情在最顶、我的分组在其下。
