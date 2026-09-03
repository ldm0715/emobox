# Phase 36：导入后新图不按排序落位 + 图库手动刷新按钮

> 结论先行：①导入后「看不到新图」不是没重拉，而是重拉结果走了**同 key merge**
> 路径（`mergeReloadedItems`）——新导入项被**追加到列表尾部**，不按当前排序插到
> 顶部；用户按「添加时间 / 最近优先」排序时新图应该在第一屏，却在尾部，主观上
> 就是「没刷新」，要切一次排序（landingKey 变化触发全量替换）才能看到。
> ②顺带补了图库级**手动刷新按钮**（LibraryHeader「多选」左侧）——右键刷新是
> WebView 整页重载（等于重启前端），不是图库刷新。
>
> 修复 = 新增 `forceFullReloadRef`（一次性标志）：导入完成 / 手动刷新置位，视图
> effect 消费时**绕过 merge 走全量替换**并重播入场动画、滚动回顶。标签写操作 /
> OCR 批末的同 key merge 语义**保持不变**（那是「网格不跳」的正确行为）。

---

## 1. 现象

主窗口「全部表情」视图，排序 = 按添加时间（或最近优先）。导入一张图片，toast
报成功、侧栏计数 +1，但网格第一屏**没有新图**；切换一次排序方式再切回来，新图
才出现（出现在它按排序应在的位置）。

## 2. 根因链

### 2.1 「全部」视图下导入本来就没有显式重拉

`prepareAfterImport(targetGroupId)`（Phase 22）只在「带 targetGroupId 且仍停留在
`group:<id>` 视图」时才 `setViewReloadTick(+1)`；其余情况切回 `all`、清搜索词，
指望 `currentView` / `debouncedQuery` 变化触发视图 effect。但用户本来就在
`all` 视图、没有搜索词时这两个 deps 都不变——重拉只靠 `refreshSidebar()` 换出的
新 `groups` / `tags` 数组引用（它们在视图 effect deps 里）间接触发。这条间接
路径能跑，但下一节说明它跑到了错误的落地分支。

### 2.2 merge 把新图追加到尾部，而不是按排序落位

视图 effect 落地时按 `landingKey = view|query|sort` 判定：

- key 变化（真切换视图/搜索/排序）→ 全量替换 `setCurrentEmojis(items)`，顺序 =
  服务端排序结果；
- key 不变（同 key 重拉）→ `mergeReloadedItems(old, items)`：沿用旧数组顺序与
  对象身份，**新项追加在尾部**。

merge 是 2026-09 为「标签弹窗写操作后网格不跳」设计的（保序 + 保对象身份，WeakMap
投影缓存命中、memo 不失效）。对标签操作它是正确取舍（被编辑项跳顶可以等下次真
切换）；对**导入**它就是错的——新图必须按当前排序出现在正确位置（按添加时间排序
时就是第一屏第一位），尾部追加等于不可见。

于是：导入 → 间接重拉 → landingKey 不变 → merge → 新图在尾部 → 「看不到」。
切排序 → landingKey 变化 → 全量替换 → 新图在正确位置 → 「这才刷出来」。

## 3. 修复：`forceFullReloadRef` 一次性绕过标志

`src/App.tsx`：

- 声明：`const forceFullReloadRef = useRef(false)`（latest-ref 模式，**不进
  effect deps**——进 deps 会让每次置位都多跑一轮 effect）。
- 消费：视图 effect **开头**读取并立即清零（`const forceFull = ...; ref = false`），
  保证标志只影响下一次 effect 运行：
  - `sameKey = !forceFull && lastLandedKeyRef.current === landingKey`——force 时
    不走 merge，全量替换；
  - 落地判定 `if (forceFull || lastLandedKeyRef.current !== landingKey)` → 更新
    `lastLandedKeyRef` + `setViewGeneration(+1)`——重播入场动画、
    `EmojiLibraryView` 的 `contentRef` 滚动回顶（真视图切换的同款行为，对导入 /
    手动刷新都是期望语义）。
- 置位方：
  - `prepareAfterImport`：**无论停留哪个视图**统一 `forceFullReloadRef = true` +
    `setViewReloadTick(+1)`（不再只对分组停留路径 bump——「全部」视图从此有
    显式重拉，不再依赖 groups/tags 引用变化的间接触发）。切回 `all` / 清搜索词 /
    清选区 / `refreshLibrary` / `refreshSidebar` 逻辑不变。
  - `handleManualRefresh`（新增，见 §4）。

其余不变式不受影响：重拉 limit 仍是 `max(PAGE_SIZE, 已加载量)`（深滚动后导入不会
把第 2/3 页砍掉）；`viewTotal` / `hasMore` / `nextOffsetRef` 仍按服务端行数赋值；
`mergeFavoriteFlags` 照常合并。

## 4. 图库手动刷新按钮

用户诉求：右键「刷新」/ F5 是 WebView 整页重载（前端状态全丢、等于重启界面），
需要一个**图库级**刷新。

实现：

- `LibraryHeader`（`src/features/library/LibraryHeader.tsx`）：actions 区最左
  （「多选」之前，用户指定的位置）加 subtle 图标按钮
  （`ArrowClockwise20Regular`，与该行 20px 图标规格一致），Tooltip / aria-label
  「刷新图库」，`refreshDisabled`（= `importing`，导入中禁用）。prop 经
  `EmojiLibraryView`（`onRefresh`）从 App 透传——**不放顶部 AppToolbar**：刷新
  是图库视图级操作，与排序 / 密度 / 多选同一行语义才对（用户反馈第一版放工具栏
  「很奇怪」后移入）。
- `App.tsx::handleManualRefresh`（useCallback）：
  1. `forceFullReloadRef.current = true` + `setViewReloadTick(+1)`——当前视图
     全量重拉（含 recent 视图）；
  2. `getRecentImages().then(setRecentItems)`——**recent 视图的数据源
     `recentItems` 只在启动和 `image-copied` 事件更新**，手动刷新必须重取（新
     数组引用本身也会触发视图 effect，与 force 标志配合全量替换）；
  3. `refreshLibrary()`（侧栏/头部计数）+ `refreshSidebar()`。
  不切视图、不清搜索词——用户要的是原地刷新。

## 5. 行为对照

| 触发源 | 走 merge？ | 入场动画 / 回顶 | 说明 |
|---|---|---|---|
| 标签写操作 / OCR 批末 / `viewReloadTick`（一般） | 是 | 否 | 「网格不跳」语义，保持不变 |
| 导入完成（`prepareAfterImport`） | **否**（force） | 是 | 新图按排序落位 |
| 手动刷新（`handleManualRefresh`） | **否**（force） | 是 | 当前视图按排序重排 |
| 真视图 / 搜索 / 排序切换 | 否 | 是 | 既有行为不变 |

## 6. 验收清单（手动）

- 「全部」+ 按添加时间排序 → 导入图片 → 新图**立即出现在第一位**，无需切排序。
- 分组视图内导入（停留该分组）→ 新图出现在组内正确排序位置。
- LibraryHeader「刷新图库」→ 当前视图按当前排序重排、计数刷新；recent 视图刷新
  后反映最新复制记录。
- 导入进行中刷新按钮禁用。
- 标签弹窗写操作后网格仍不跳（merge 路径未回归）。

自动化：`npm run build`（tsc + vite）+ `npx vitest run` 全绿（本次无新增测试文件；
`viewReloadMerge.test.ts` 锁定的 merge 纯函数语义未动）。
