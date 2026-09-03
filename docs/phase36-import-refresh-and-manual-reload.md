# Phase 36：导入后新图不按排序落位 + 图库手动刷新按钮

> 结论先行：①导入后「看不到新图」不是没重拉，而是重拉结果走了**同 key merge**
> 路径（`mergeReloadedItems`）——新导入项被**追加到列表尾部**，不按当前排序插到
> 顶部；用户按「添加时间 / 最近优先」排序时新图应该在第一屏，却在尾部，主观上
> 就是「没刷新」，要切一次排序（landingKey 变化触发全量替换）才能看到。
> ②顺带补了图库级**手动刷新按钮**（LibraryHeader「多选」左侧）——右键刷新是
> WebView 整页重载（等于重启前端），不是图库刷新。
>
> 修复 = 新增强制全量替换标志（现为 `forceReloadKindRef`，取值
> `"import" | "refresh" | null`；2026-09 前身是 bool `forceFullReloadRef`）：导入
> 完成 / 手动刷新置位，视图 effect 消费时**绕过 merge 走全量替换**。标签写操作 /
> OCR 批末的同 key merge 语义**保持不变**（那是「网格不跳」的正确行为）。
> 落地动画 2026-09 起按 kind 分流：import 重播入场动画；refresh 改走容器
> fade-through 不重挂载（见 §4.1）。

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

## 4.1 刷新动画：fade-through 替代重挂载（2026-09 追加）

Phase 36 初版让手动刷新与导入共用同一条落地路径（force → `viewGeneration++` →
`<FadeSnappy key={resetKey}>` 整树重挂载）。导入场景这是期望的「新内容到达」提示；
但刷新场景内容通常没变，重挂载带来三重突兀：

1. **「闪一下」主因**：旧网格瞬间卸载（无退场/交叉淡入）→ 全屏空白 → 新网格
   opacity 0→1 淡入 150ms；
2. `EmojiGrid` 重挂载使 `visibleCount` 归零为 72——已加载多页时刷新后网格缩水，
   要重新滚动才补齐；
3. `<img>` DOM 全部重建，缩略图重新请求/解码可能二次闪白。

改为 Fluent fade-through（内容变暗 → 原地换新 → 回亮，全程零空白帧）：

- `forceFullReloadRef: useRef(false)` 升级为 `forceReloadKindRef:
  useRef<"import" | "refresh" | null>(null)`——merge 绕过语义不变（`forceFull =
  kind !== null`），kind 只决定落地动画。
- `handleManualRefresh` 置 kind `"refresh"` + `isRefreshing(true)` +
  `refreshCycleRef`（latest-ref 周期标记）；`prepareAfterImport` 置 `"import"`
  （行为与初版完全一致）。
- `EmojiLibraryView` 新 props：`refreshing`（`content` div 经 `mergeClasses` 挂
  `contentRefreshing`（opacity 0.6），transition = durationNormal + curveEasyEase，
  `prefers-reduced-motion` 跳变——与 AppShell 侧栏折叠过渡同款写法）与
  `refreshLandedTick`（原地刷新不经 resetKey，由独立信号驱动 `contentRef` 回顶）。
- 视图 effect 落地分流：`inPlaceRefresh = !keyChanged && (forceKind === "refresh"
  || refreshLanding)` 时不递增 `viewGeneration`（不重挂载、visibleCount 保留、
  img DOM 保留）；落地同时复位刷新态 + bump `refreshLandedTick`；catch 分支同样
  复位（拉取失败回亮，不回顶——内容未变）。
- **`refreshCycleRef` 兜底（承重）**：`recentItems` / `groups` / `tags` 都在视图
  effect deps，一次手动刷新会连带多次重拉；forceKind 可能在被 `viewSeqRef` 作废
  的迟到 run 里消费丢失。只绑 kind 判定「哪次落地清刷新态」会让 `isRefreshing`
  永远为 true（按钮永久转圈）——落地时只要 `refreshCycleRef` 为 true 就复位 +
  bump 回顶信号，不依赖 kind 存活。
- 刷新按钮反馈：拉取中 `icon` 换 `<Spinner size="tiny" />` 并禁用（SettingsMenu
  既有范式）。

## 5. 行为对照

| 触发源 | 走 merge？ | 落地动画 | 说明 |
|---|---|---|---|
| 标签写操作 / OCR 批末 / `viewReloadTick`（一般） | 是 | 否 | 「网格不跳」语义，保持不变 |
| 导入完成（`prepareAfterImport`） | **否**（force `"import"`） | 重播入场动画 + 回顶 | 新图按排序落位 |
| 手动刷新（`handleManualRefresh`） | **否**（force `"refresh"`） | fade-through（变暗→原位换新→回亮）+ 回顶 | 当前视图按排序重排，不重挂载 |
| 真视图 / 搜索 / 排序切换 | 否 | 重播入场动画 | 既有行为不变 |

## 6. 验收清单（手动）

- 「全部」+ 按添加时间排序 → 导入图片 → 新图**立即出现在第一位**，无需切排序，
  且带入场动画重播（fade-through 是刷新专属，导入不适用）。
- 分组视图内导入（停留该分组）→ 新图出现在组内正确排序位置。
- LibraryHeader「刷新图库」→ 当前视图按当前排序重排、计数刷新；recent 视图刷新
  后反映最新复制记录。
- **刷新观感（2026-09）**：点击后按钮图标转 Spinner、网格平滑变暗回亮，**全程无
  空白帧**；深滚动（已加载 > 72 张）后刷新，网格不缩水、缩略图不重载闪白。
- 导入进行中刷新按钮禁用；刷新拉取中按钮同样禁用。
- 标签弹窗写操作后网格仍不跳（merge 路径未回归）。

自动化：`npm run build`（tsc + vite）+ `npx vitest run` 全绿（本次无新增测试文件；
`viewReloadMerge.test.ts` 锁定的 merge 纯函数语义未动）。
