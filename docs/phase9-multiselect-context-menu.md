# Phase 9：网格多选 + 各 tab 批量右键菜单

> 实施完成。本阶段补上表情库的**多选**能力，并把右键菜单升级为**按 tab 区分、跟随鼠标、对多选批量操作**：
>
> 1. **多选状态模型**：废弃孤立的 `selectedPath` 单选，`selectedIds: Set<number>` 成为唯一选中源，由新 hook `useMultiSelection` 托管（Ctrl 切换 / Shift 范围 / Ctrl+A 全选 / Delete 批量回收站 / 点空白取消）。
> 2. **显式多选模式**：头部「多选」开关（`ToggleButton`），开启后单击即切换选中、每个缩略图左上角出现复选框、批量条 ≥1 项即浮出。
> 3. **批量右键菜单**：网格层共享一个受控 `Menu`，用 Fluent `positioning={{ target }}` 光标定位；右键已选中的多选项 → 对整个多选批量操作，右键未选中项 → 先单选；`复制` / `查看文件位置` 单项操作在多选时隐藏。
> 4. **处理器统一为数组签名**：所有单项回调 `(item)` → `(items: IndexedImage[])`，批量 id 直接用视图项的真实 id，顺带修复 recent 视图合成 `id:0` 导致的操作失效。

Rust 侧零改动——后端批量命令（`set_emojis_favorite` / `add_emojis_to_group` / `add_tags_to_emojis` / `remove_tags_from_emojis` / `soft_delete_to_trash` / `restore_from_trash` / `permanently_delete_emojis`）和 `MoveToGroupDialog` / `TagPickerDialog` 自 Phase 6 起就已接受 `number[]`，缺的只是 UI 层。

---

## 一、用户拍板的关键决策

| 决策 | 选 | 不选 |
|---|---|---|
| 多选交互 | 完整标准套件：Ctrl+点击切换、Shift+点击范围、Ctrl+A 全选、Delete 批量回收站、点空白取消 | 只做鼠标 Ctrl 点击 |
| 显式多选模式 | 头部「多选」开关，开启后单击切换选中、缩略图显示复选框、批量条 ≥1 浮出 | 仅靠 Ctrl/Shift 修饰键 |
| 批量条出现时机 | 非多选模式选中 ≥2 项浮出；多选模式下 ≥1 项浮出（含「退出多选」） | 永远 ≥2 |
| 右键菜单行为 | 共享菜单光标定位；右键多选中已选项 → 批量；右键未选中项 → 先单选；多选隐藏 复制/查看文件位置 | 每 tile 一个菜单、锚定「更多」按钮下方 |
| 右键菜单内容 | 沿用 default/group/trash 三套，批量化 | 新增 tab 专属项 |
| 处理器签名 | 全部改 `(items: IndexedImage[])`，单选传 `[item]` | 保留单项 + 另加批量两套 |
| 批量收藏方向 | `favoriteIds` 单一来源：全部已收藏 → 取消，否则收藏 | path 集与 id 集并存 |
| 标签弹窗初选 | 选中项 tagIds 的**交集** | 空集合 / 单一项的 tagIds |
| 键盘快捷键 | 输入框 / 模态弹窗打开时豁免；切视图重置多选模式并清选区 | 无豁免 |

---

## 二、多选状态模型（`src/features/library/useMultiSelection.ts`）

`selectedIds: Set<number>` + `anchorId`（Shift 范围锚点）。返回 `{ selectedIds, selectOnly, toggle, rangeSelect, selectAll, clear, deselect }`。

### 2.1 prune 按「id 集合」而非「数组 identity」

`useEffect([items])` 只剔除**当前 items 中不存在的 id**：

- **换视图 / 搜索收窄** → 选区跟随可见集收缩或清空（自动）。
- **排序变化（同 id 集重排）** → **不清选区**，只校验 `anchorId` 是否仍存在（不存在则清 anchor）。若按数组引用变化清空，就会「一排序就丢选区」。

`selectOnly` 替换选区；`toggle` 增删并更新 anchor；`rangeSelect` 取 `items` 中 anchor→目标闭区间整体替换（anchor 为 null 退化为单选）；`deselect(ids)` 批量剔除（回收站/恢复等操作后同步删掉已消失的项）。

### 2.2 id 语义：各视图都带真实 id

`filteredItems`（网格渲染源）在**所有视图**（all / favorites / ungrouped / group / trash / recent）都携带真实 id：

- 非 recent：由 `currentEmojis`（`searchEmojis` / `listDeletedEmojis` 返回的 `IndexedEmoji`）投影，id 真实。
- recent：`viewItems` 返回 `recentItems[].item`（后端 `IndexedImage`，id 真实）——**不是** effect 里塞给 `currentEmojis` 的合成 `id:0`。

所以 `items.map(i => i.id)` 就是可直接传给后端批量命令的真实 id。这**顺带修复**了既有 bug：旧代码 `currentEmojis.find(path).id` 在 recent 视图会拿到 0，导致标签/分组操作失败。

---

## 三、交互行为

### 3.1 单击 / 修饰键（`EmojiGridItem`）

```ts
function handleClick(event) {
  event.stopPropagation();
  if (event.ctrlKey || event.metaKey) onItemSelect(item, "toggle");
  else if (event.shiftKey) onItemSelect(item, "range");
  else onItemSelect(item, multiSelectMode ? "toggle" : "replace");
}
```

- 普通单击：非多选模式 = 单选替换；**多选模式 = 切换选中**。
- Ctrl/Shift 两种模式下都生效（Shift 范围、Ctrl 切换）。
- Enter / Space / 双击 = `replace`（聚焦该项）。
- 点网格空白（`event.target === event.currentTarget`）→ `clear()`。

### 3.2 显式多选模式（`multiSelectMode`）

- 入口：`LibraryHeader` 的「多选」`ToggleButton`（`CheckboxUnchecked20Regular` / `CheckboxChecked20Filled` 图标，选中态）。
- 开启后每个缩略图左上角显示复选框（选中打勾 + 品牌色填充；GIF 角标此时让位）。
- 批量条 `showBar = selectedIds.size >= (multiSelectMode ? 1 : 2)`；条内含「退出多选」「清除选择」。
- 退出方式：头部开关 / 批量条「退出多选」（都会 `clear()`）；**切换侧栏视图**时 prevView effect 强制关模式并清空选区。
- `handleToggleMultiSelect`：`if (multiSelectMode) clear(); setMultiSelectMode(prev => !prev)`。

### 3.3 键盘（Ctrl+A / Delete）

`keyShortcutRef` **latest-ref** 模式：keydown effect deps 保持 `[]`，每次渲染把最新闭包写进 ref，杜绝闭包过期。

- **豁免**：`INPUT` / `TEXTAREA` / `contentEditable` / `role="textbox"`（搜索框内 Ctrl+A 只选文字）；任一模态弹窗打开时（`groupDialogOpen` / `moveToGroupState` / `tagPickerState` / `settingsOpen`）整体跳过。
- `Ctrl+A` → `preventDefault` + `selectAll()`。
- `Delete`（非 trash 视图）→ `preventDefault` + `handleDelete(当前可见选中项)`（带数量 confirm）。
- 保留既有 Ctrl+F 聚焦搜索框。

### 3.4 切视图只清一次

视图 effect 的 deps 含 `debouncedQuery` / `recentItems`，每次搜索/复制事件都会重跑——不能在那里无脑清空（会误伤「搜索中的选区」）。改用 `prevViewRef` effect，**仅当 `currentView` 真正变化时** `clear()` + `setMultiSelectMode(false)`，覆盖侧栏切换 / `handleMoveToGroupConfirm` 跳转 / `prepareAfterImport` / `deleteGroup` 所有切视图路径。

---

## 四、共享右键菜单（`EmojiGrid`）

一个受控 `<Menu open={menuOpen} positioning={{ target: contextTarget }}>`，内容为 `EmojiItemMenu`。取代旧的「每 tile 一个 Menu + 锚定更多按钮」。

### 4.1 光标定位

Fluent v9 官方有 `usePositioningMouseTarget()`，但它在 `@fluentui/react-positioning` 而非 `@fluentui/react-components` 公共导出，且 setter **只接受 MouseEvent**、不能传按钮 rect。改用本地小 helper，同时服务事件与元素两种锚点（结构上等价 `PositioningVirtualElement`，不加依赖）：

```ts
interface VirtualTarget { getBoundingClientRect: () => { x, y, top, left, bottom, right, width, height } }
// 事件锚点：clientX/Y 构造 1×1 rect
// 按钮锚点：{ getBoundingClientRect: () => button.getBoundingClientRect() }
```

已核实 Fluent 内部：`usePositioning` 把 `positioning.target` 存入 `overrideTargetRef`，`targetRef.current` 因无触发器元素保持 `null`；`useOnClickOutside` 对 null ref 用 `?.` 安全短路，不会因虚拟 target 崩溃。`renderMenu` 支持「仅 popover 单子元素」的受控 Menu（`state.menuTrigger` 为 null）。

### 4.2 批量感知

```ts
function openMenuFor(item, target) {
  const multi = selectedIds.has(item.id) && selectedIds.size > 1;
  if (!multi) onItemSelect(item, "replace");   // 右键未选中项 → 先单选
  setTargetItems(multi ? selectedItems : [item]);
  setContextTarget(target);
  setMenuOpen(true);
}
```

- 右键已选中的多选项 → 菜单作用于整个多选（`targetItems = selectedItems`）。
- 右键未选中项 → 先单选该项，菜单只操作它。
- 「更多」按钮也打开同一个菜单（`virtualTargetFromRect` 按钮锚点，定位在按钮下方）。
- `menuFavorite = targetItems.every(i => favoriteIds.has(i.id))` —— 与 App 处理器同源。
- **stale 防御**：`menuOpen && targetItems.some(i => !selectedIds.has(i.id))` → 关菜单（Delete 键 / 批量条清除把选区改掉时兜底）。
- `onOpenChange(false)` 只清 `menuOpen`；`targetItems` / `contextTarget` 留到下次打开覆盖（避免关闭动画期间 handler 读到空数组；已验证 MenuItem 的 onClick 先于 `onOpenChange(false)` 触发，闭包读到 render 时的正确值）。

### 4.3 `EmojiItemMenu` 加 `multi`

`multi === true` 时三套菜单（default/group/trash）都**隐藏**「复制到剪贴板」与「查看文件位置」（单项操作，多选无意义）；其余项保留，收藏 label 由 `favorite` 布尔驱动（批量方向）。

---

## 五、批量条（`EmojiLibraryView`）

`.content` 滚动容器内 `position: sticky; bottom: 0` 的浮条，`margin: 0 -{spacingHorizontalXL}` 抵消容器 padding：

- 左侧「已选 N 项」。
- 按钮按 `menuMode` 分组：非 trash → 收藏/取消收藏、加入分组、管理标签、移入回收站；group → 加「从当前分组移除」；trash → 恢复、彻底删除。
- 多选模式下追加「退出多选」（secondary）；恒有「清除选择」（subtle）。

---

## 六、批量处理器（`App.tsx`）

所有单项回调统一为数组签名 `(items: IndexedImage[])`，单选传 `[item]`：

| 操作 | 实现 |
|---|---|
| 收藏 `toggleFavorite(items)` | `allFav = ids.every(id => favoriteIds.has(id))`，`next = !allFav`；乐观更新 `indexedEmojis` / `favorites` / `favoriteIds`（`idSet` / `pathSet` 去重），失败回滚同结构反向 |
| 移入回收站 `handleDelete(items)` | `softDeleteToTrash(ids)`（数量 confirm）后从 `currentEmojis` / `allItems` / `indexedEmojis` / `favorites` / `favoriteIds` 剔除，**必须剪 `recentItems`**（recent 视图渲染源是 recentItems，不剪会残留网格），`deselect(ids)` |
| 加入分组 `handleMoveToGroup(items)` | `setMoveToGroupState({ emojiIds: ids })`（弹窗已按 `emojiCount` 显示「为 N 个表情…」） |
| 管理标签 `handleAddTags(items)` | `initialTagIds = ids.map(id => indexedById.get(id)?.tagIds ?? []).reduce(交集)` |
| 从当前分组移除 `handleRemoveFromGroup(items)` | `removeEmojisFromGroup(groupId, ids)` + filter `currentEmojis` + `deselect(ids)` |
| 恢复 / 彻底删除 | 批量调用；permanent 按 delete 同款剪所有缓存 + favorites/favoriteIds；restore 只剪 `currentEmojis` + `recentItems` |
| 复制 / 查看文件位置 | `if (items.length !== 1) return` 守卫（批量菜单已隐藏，防御性） |

`indexedById = new Map(indexedEmojis.map(e => [e.id, e]))` 供标签交集/收藏方向解析。`indexedEmojis` 仍是「全库缓存」（mount 时 `refreshLibrary()` 拉全量 + all 视图更新）。

---

## 七、关键不变量（Phase 9 新增）

- `selectedIds` 是唯一选中源，由 `useMultiSelection(filteredItems)` 托管；`selectedPath` 已整体删除。
- 多选 id 取自视图项的 `IndexedImage.id`（各视图真实 id），不再经 path 反查。
- 排序变化不清选区、换视图/搜索收窄按 id 集 prune、真正切视图时 prevView effect 统一清空。
- 批删后 `recentItems` 必须同步剪除。
- 批量收藏方向、菜单 label、批量条按钮共用 `favoriteIds` 单一来源。
- 共享右键菜单只清 `menuOpen`，不中途清 `targetItems`（stale 由防御 effect 关闭兜底）。
- 键盘 latest-ref：keydown effect deps 恒为 `[]`；输入框与模态弹窗打开时豁免 Ctrl+A/Delete。

## 八、已知边界 / 风险

- `indexedEmojis` 只拉 `limit: 500`：大库（>500 张）时 recent 视图的标签交集 / 收藏方向可能不全（既有 `refreshLibrary` 限制，未扩大）。recent 项若在后端 recent 记录里仍被返回（软删后重启），前端无解，只做内存剪除——需手动验收确认后端是否过滤 `is_deleted`。
- recent 视图 `currentEmojis` 仍合成 `id:0`（仅用于 `tagsByPath` 渲染标签 chip，recent 视图标签 chip 为空是既有行为）。
- 网格 key 用 `path`：同一图跨视图重复的 key 冲突是既有行为，未改。
- 批量删除 / 彻底删除沿用 `window.confirm` 原生确认（既有模式），未升级为 Fluent Dialog。
- `useMultiSelection` 的 range 按「anchor id 在新顺序中的位置」解析：排序后 Shift 范围跟随新顺序（标准行为）。

## 九、验证

- `npx tsc --noEmit` ✅
- `npx vitest run`（`useMultiSelection` 10 例 + 浮层 `useQuickSearchQuery` 4 例）✅
- `npm run build`（tsc + vite）✅
- Rust 侧零改动，cargo 三连跳过。
- 手动清单：多选模式开关 + 复选框 + 单击累积；Ctrl/Shift/Ctrl+A/Delete；各 tab 右键（多选批量 / 单选 / 复制与查看文件位置隐藏）；批量条 ≥1/≥2 浮出与退出；批量收藏方向、加入分组"N 个表情"、标签交集、group 批量移除、trash 批量恢复/彻底删除；recent 视图删除即时消失。
