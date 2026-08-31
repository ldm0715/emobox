# Phase 18：表情卡片交互重设计（单击复制 / 双击预览 / Tag 下移）与网格性能修复

> 实施完成。纯前端改动（React + Fluent UI v9），不涉及 Rust。三个主题：
> ① 卡片视觉重排——黑色文件名覆盖条移到图片下方、Tag 移出图片区；
> ② 交互统一——单击复制（250ms 单双击消歧）、双击大图预览、右键菜单不动；
> ③ 性能——修复卡片加重后整网格变卡的回归（memo + 稳定 props + 原生 title）。
> 附带：大图预览弹窗左右布局、密度切换图标区分。

---

## 一、动机

Phase 17 合入后的卡片状态：

- 文件名是覆盖在图片底部的黑色半透明条（`overlay` 样式 + 全局类名 `emoji-overlay` hover 联动），遮挡表情内容；
- Tag pill 条同样覆盖在图片左下角；
- 单击只是选中（无实际动作）、双击是空行为（replace 单选）；
- 大图预览功能完全缺失。

用户拍板的交互语义：

| 决策点 | 结论 |
|---|---|
| 普通模式单击 | **仅复制、不选中**（选中入口仍充足：Ctrl/Shift、右键 openMenuFor 的 replace 兜底、Enter/Space、多选模式、Ctrl+A） |
| 复制反馈 | 复用 App 现有 toast（`已复制 xxx`，success intent） |
| 双击 | 打开大图预览，弹窗带完整操作栏（文件名 + 尺寸/大小/分组/标签 + 收藏/复制/关闭） |
| Tag 展示 | 图片区只留固定状态角标（GIF 徽标等）；Tag 放文件名下方，可点击筛选 |

## 二、行为矩阵（改后全貌）

| 输入 | 普通模式 | multiSelectMode |
|---|---|---|
| 单击 | 250ms 后复制 + toast（**不改选区**） | 立即 toggle 选中（无延迟、不复制） |
| Ctrl/Cmd 单击 | 立即 toggle 选中 | 同左 |
| Shift 单击 | 立即 range 选中 | 同左 |
| 双击 | 取消挂起的复制 → 打开预览 | 打开预览 |
| 右键 / hover 更多 | 现有共享菜单照旧 | 同左 |
| Enter / Space | replace 选中（键盘选中入口保留） | 同左 |
| hover 复制按钮 | 立即复制（stopPropagation） | 同左 |
| 网格空白单击 | 清空选区（不变） | 同左 |
| 点击卡片 Tag | 注入 `*标签` 精确搜索筛选（stopPropagation，不触发复制） | 同左 |
| Ctrl+A / Delete | 照旧；**预览 Dialog 打开时豁免**（新增） | 同左 |

## 三、单击/双击消歧：`useClickIntent`

新 hook：`src/features/library/useClickIntent.ts`（配套 `useClickIntent.test.ts` 5 用例）。

核心机制：

- 浏览器双击序列是 `click(detail=1) → click(detail=2) → dblclick`。`handleClick` 遇 `event.detail > 1` 直接取消第一击挂起的 timer 返回，`handleDoubleClick` 再 cancel 一次兜底 + 触发预览；
- `isImmediate` 返回 true（Ctrl/Shift/multiSelectMode）→ **同步立即**执行选中类动作，完全不进 timer（选中不能有 250ms 延迟感）；
- 普通单击 → 250ms timer 后复制；
- 回调全部存 `optionsRef.current`（latest-ref 模式）：multiSelectMode 切换、item 换绑不产生 stale closure，hook 返回的 handler 身份恒定（对 memo 友好）；
- 卸载 effect 清 timer：渐进渲染回收 / 切视图时不复制已卸载项。

**已知权衡**：Windows 双击阈值约 500ms > 250ms，间隔 250–500ms 的「慢速双击」会先复制再开预览——无害，接受。延迟上限不建议超 300ms。

## 四、卡片 DOM/样式重排（`EmojiGridItem.tsx`）

```
root (flex column, memo)
├─ frame (position:relative, aspectRatio 1/1)
│  ├─ img（缩略图 / hover 时 GIF asset URL）
│  ├─ GIF 徽标 / 多选复选框        ← 仅固定状态角标
│  ├─ actions 悬停按钮组（星标[非 trash] + 复制 + 更多，opacity 0 hover 淡入）
│  └─ （Tag 覆盖条已删除）
├─ captionRow：文件名（ellipsis + 原生 title）＋ 紧凑密度时右端内联「🏷 N」
└─ tagRow（标准/大图密度，tags 非空时）：最多 2 个 Badge + “+N”
```

要点：

- **悬浮元素必须收进 `frame`**：root 变 flex column 后，原来锚在 root 上的绝对定位元素（角标/按钮/标签）会错位到 caption 行，全部移入 `frame`（`frame` 加 `position: relative` 接管锚点）；
- 选中态语义迁移：原 `overlayVisible`（覆盖条常显）→ `captionSelected`（文件名品牌色 + semibold）+ 原有边框描边；
- `emoji-overlay` 全局类名与 `:hover .emoji-overlay` 规则删除；`emoji-actions` 联动保留；
- 网格布局不变：`--emoji-tile-size` / auto-fill / 1:1 比例照旧，卡片整体多出 caption（+标准密度下的 tagRow）一行高度。

### Tag 展示（密度分级）

| 密度 | 展示 |
|---|---|
| comfortable / large | 文件名下方独立 Tag 行：`<Badge size="small" appearance="outline">` × 2 + `+N`；单个 maxWidth 84px 截断，原生 title 展示全名（`+N` 的 title 列出剩余全部） |
| compact | 不展开 Tag 行（**卡片高度不变**）；文件名行右端内联 `Tag16Regular` + 数量，title 列出全部 Tag 名 |

- Tag 可点击 → `onTagClick(tag)` → App 注入 `setSearchQuery(`*${tag}`)`——复用现成 `*标签` 精确语法（后端 `list_indexed` 与 recent 视图客户端 `searchSyntax` 都支持，带精确→宽松回退阶梯），工具栏搜索框可见该查询；
- 点击/双击 Tag 均 stopPropagation（不触发卡片复制/预览）；
- **Badge 没有内建 truncate prop**：需 className 覆盖 `display: "block"`（默认 inline-flex 下文本节点无法 ellipsis）+ `maxWidth` + `overflow: hidden` 三件套。

## 五、大图预览：`EmojiPreviewDialog.tsx`（新建）

- 状态在 **App 层**（`previewItem: IndexedImage | null`）：① `keyShortcutRef` 的弹窗豁免需要感知预览打开（否则预览中 Ctrl+A 背后全选、Delete 弹 confirm）；② 预览内复制/收藏直接复用 `handleCopy` / `toggleFavorite` / `favoriteIds`；③ 与 GroupDialog/SettingsDialog 持有层级惯例一致。
- **左右布局**：左图片（`width/height auto` + `maxWidth min(88vw,720px)` / `maxHeight 68vh` 双约束按比例缩放，无留白框），右 232px 固定窄信息面板。
- 信息行**图标开头**：`Image20Regular`（宽×高·格式）、`DataUsage20Regular`（大小）、`FolderOpen20Regular`（分组 chips，无则「未分组」）、`Tag20Regular`（标签 chips，无则「暂无标签」）。
- 操作区沉底竖排：收藏（星标 toggle）/ 复制 / 关闭（Dismiss）。
- 分组/标签名由 App 的 `previewMeta` memo 解析（`indexedById` 的 `groupIds`/`tagIds` + `groups` / `tagById` 映射；previewItem 必来自当前视图已加载集，覆盖必有）。
- GIF 直接用 `emojiAssetUrl(item.path)`，img 自动播放；`onError` → 「预览不可用」，open/换项时重置失败标记。

### 坑：DialogSurface 不会收缩贴合内容

Fluent `DialogSurface` 默认样式（读 `node_modules/@fluentui/react-dialog/lib/components/DialogSurface/useDialogSurfaceStyles.styles.js`）：

```css
position: fixed; inset: 0; margin: auto; height: fit-content; max-width: 600px;
```

固定定位块 + `inset: 0` + `width: auto` 的宽度会**拉伸到 max-width**，不是 shrink-to-fit——只覆盖 `maxWidth`（如 1080px）时弹窗恒定撑满该宽度，小图两侧全是留白（Phase 14 Divider 同类组件库隐藏默认值问题）。

修法：`width: "fit-content"` + `maxWidth: min(94vw, 960px)`。图片约束用 `width/height auto + 双 max`（替换元素按比例缩放），**不要** `maxWidth: 100%` + `objectFit: contain`（会产生空盒留白）。

## 六、性能回归与修复（本轮最重要的经验）

### 症状

卡片交互重设计合入后用户报告整网格「非常卡」。**不是分页的问题**（`PAGE_SIZE=200` / 渐进渲染 72 一批是 Phase 17 既有行为）。

### 根因

1. 每张卡片新增了 2 个 Fluent `Tooltip`（caption 全名 + 复制按钮）。Tooltip 是重型组件——`useTooltipBase` 263 行，每实例多个 state/ref/事件回调 hook。滚动加载后 200+ 卡 × 4 实例 ≈ **800+ 常驻组件**；
2. 整棵列表**没有任何 memo**：传给卡片的回调（`handleCopy` / `handleItemSelect` / `toggleFavorite` / 右键 handler）每次 App 渲染都是新函数，`viewItems` 投影每次新建对象——即使加 memo 也全部失效；
3. 于是每次单击复制的 toast、选中、收藏等任何 App 级状态变化都**全量重渲染所有已渲染卡片**；
4. 鼠标扫过网格时，全宽 caption 上的 Fluent Tooltip 反复开合（portal + popper 定位）加剧卡顿。

### 修复（两层）

**减重**：caption 全名改用**原生 `title` 属性**（原覆盖条本就用 title，UX 一致）。数百个 Tooltip 实例直接消失。悬浮按钮上的 3 个 Fluent Tooltip 保留（改动前就有的模式、目标小）。

**memo 化并让它真正生效**——`React.memo(EmojiGridItem)` 要生效，**所有 props 身份必须稳定**，缺一不可：

| 手段 | 位置 | 解决的问题 |
|---|---|---|
| `handleCopy` 包 useCallback | App | 复制回调身份稳定 |
| `rangeSelect` / `favoriteIds` 走 latest-ref | App | `handleItemSelect`（依赖随 anchor 变化的 rangeSelect）、`toggleFavorite`（依赖 favoriteIds）身份恒定 |
| `viewItems` 投影 WeakMap 缓存 | App | 同一 `IndexedEmoji` 引用 → 同一 `IndexedImage` 对象；翻页追加/乐观收藏更新时未变化项不重建对象 |
| `tagsByPath` names 数组按 emoji 引用缓存（tagById 变化整体失效） | App | 收藏乐观更新等 currentEmojis 引用变化时不重建 tags 数组（防改名后读旧名） |
| `handleContextItem` / `handleMoreButton` 经 `openMenuForRef` latest-ref | EmojiGrid | 右键/更多回调身份恒定 |
| 模块级 `EMPTY_TAGS` 常量 | EmojiGrid | 无标签项不再每次渲染新建 `[]` |
| `handleTagClick` 包 useCallback | App | Tag 点击回调稳定 |

效果：toast / 选区 / 收藏等 App 级重渲染只触碰真正变化的卡片，其余全部被 memo 跳过；滚动翻页只挂载新增的 72 张。

**后续选项**：深滚动到上千张后若仍卡，下一步是列表虚拟化（只渲染视口内卡片）——改动较大，本轮未做。

### 经验沉淀

- **判断组件库坑的高效路径**：读 `node_modules` 里实际生成的 CSS/JS（按短类名 grep），不要信记忆（Phase 14 Divider、本次 DialogSurface 均如此）；
- **网格里每个单元格挂 Fluent Tooltip 之类的重型交互组件前先算总量**：组件数 × 已渲染卡片数，>500 就该换原生 `title`；
- **`React.memo` 是全有或全无**：props 链上一个不稳定引用（内联回调、新建 `[]`、重建投影对象）就让整张卡白 memo。回调不稳定时用 latest-ref（本仓库 `keyShortcutRef` / `collectFromClipboardRef` 同模式），派生数据用 WeakMap identity 缓存。

## 七、密度切换图标区分（小修）

`LibraryHeader.tsx` 的密度组里 `标准`（comfortable）与 `宽松`（large）都用 `Grid20Regular`。改为：紧凑 `GridDots20Regular`、标准 `Grid20Regular`/激活 `Grid20Filled`、宽松 `Apps20Regular`/激活 `Apps20Filled`（2×2 大方格语义 = 更少更大的格子，激活态补齐 Filled 反馈）。

## 八、文件清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `src/features/library/useClickIntent.ts` | 新增 | 单双击消歧 hook（250ms + detail 拦截） |
| `src/features/library/useClickIntent.test.ts` | 新增 | 5 用例（延迟触发/双击取消/立即路径/卸载清理） |
| `src/features/library/EmojiPreviewDialog.tsx` | 新增 | 大图预览（左右布局 + 图标信息行 + 操作栏） |
| `src/features/library/EmojiGridItem.tsx` | 重写 | DOM 重排、caption/tagRow、useClickIntent、memo、hover 复制按钮 |
| `src/features/library/EmojiGrid.tsx` | 小改 | 透传 density / onCopy / onOpenPreview / onTagClick；稳定右键回调；EMPTY_TAGS |
| `src/features/library/EmojiLibraryView.tsx` | 小改 | 透传 onOpenPreview / onTagClick |
| `src/features/library/LibraryHeader.tsx` | 小改 | 宽松密度图标 Apps20Regular/Filled |
| `src/App.tsx` | 中改 | previewItem 状态 + EmojiPreviewDialog 渲染 + previewMeta；dialogOpen 豁免；回调稳定化（handleCopy/handleItemSelect/toggleFavorite/handleTagClick）；viewItems/tagsByPath identity 缓存 |

`EmojiItemMenu.tsx` 未改（右键菜单需求已满足）。Rust 侧零改动（复制、asset 协议、`*标签` 搜索均为既有能力）。

## 九、后续修复：复制出现双 toast

**症状**：单击复制后出现两条「已复制 猫猫.gif」，其中一条还带「GIF 已连同动画一起复制」。

**根因**（与点击逻辑无关，是双 toast 源）：主窗口复制成功有两条路径同时弹 toast——

1. `App.tsx handleCopy` 成功后自己 `dispatchToast`；
2. Rust `copy_image_to_clipboard` 命令**每次**成功都 `emit_to("main", "image-copied")`（`commands.rs`），App 挂载 effect 里的监听器收到后又弹一条（该监听器本意是给快捷搜索浮层的复制在主窗口报信，含 `outcome.message` 详情——「GIF 已连同动画一起复制」正是它的 ToastBody）。

该 bug 右键菜单复制时代就存在，单击复制（高频操作）让它暴露。

**修法**（三轮迭代后的最终形态——主窗口复制不依赖事件链路）：
1. `handleCopy` **直接用命令返回的 `ClipboardCopyOutcome.message` 弹 toast**（`copy_image_to_clipboard` 的返回值），并在弹之前打 `localCopyToastRef` 标（`{ path, at }`）。曾尝试"删掉 handleCopy 的 toast、只靠事件监听弹"，结果在长 dev 会话里 HMR 残留让监听失效，复制变成**零反馈**——用户可见反馈不应依赖跨窗口事件链路。
2. `image-copied` 监听器保留两个职责：`recentItems` 更新（幂等，不防重）+ 快捷搜索浮层复制的主窗口报信。监听器弹 toast 前先查 `localCopyToastRef`（3s 内同 path = 本窗口 handleCopy 已弹过，跳过，防双弹）；再查 1.2s 同图 `lastCopyToastRef` 防重（兜住 HMR 累积的重复监听/重复投递，曾出现单击一次弹 2–3 条且条数随会话增长）。

**排查结论**：Fluent `dispatchToast` 本质是往 `document` 派发 CustomEvent，每个挂载的 `<Toaster>` 各渲染一次——一次 dispatch 多条 toast ⇔ 同窗口多个活跃监听/Toaster；App 每窗口只有一个 `<Toaster>`、`dispatchToast` 是稳定 memo、监听的 disposed-flag 注销模式正确，干净加载下不存在重复；增长型重复与长 dev 会话的 Vite HMR 周期吻合。

**经验**：
- 给"命令 + 事件"双通道的操作加用户反馈时：**命令发起方直接用返回值反馈**（链路最短、不依赖事件投递），事件监听只服务"另一窗口发起"的场景并用标记跳过本地方；两处都弹必然双 toast。
- dev 会话热更次数多了以后出现的"越用越多/越用越没"类事件症状，先怀疑事件监听器被 HMR 弄脏；对反馈加时间窗防重是最便宜的兜底，但**主反馈通道不应押在事件链路上**。

## 十、验证

- `npm run build`（tsc --noEmit + vite）✅
- `npx vitest run`：35 passed（5 文件，含新增 useClickIntent 5 用例；useMultiSelection / useGifPreview / useQuickSearchQuery / searchSyntax 无回归）✅
- 手动验收清单：
  - 文件名在图片下方、超长省略、原生 title 全名；选中项 caption 品牌色加粗；
  - 标准/大图密度 Tag 行在文件名下方（≤2 + “+N”）、点击 Tag 网格按标签过滤、搜索框出现 `*标签名`；紧凑密度文件名右端「🏷 N」、卡片高度不变；
  - 悬停三按钮（trash 视图无星标）；单击 250ms 后 toast「已复制」；快速双击不复制、开预览；
  - 预览：左右布局贴合图片宽度、GIF 播放、Esc/遮罩关闭、收藏/复制可用、预览中 Ctrl+A/Delete 豁免；
  - Ctrl/Shift/多选/右键/Enter/Space/网格空白点击与改前一致；三档密度无错位；hover GIF 播放正常；
  - 性能：单击复制弹 toast、Ctrl 多选、收藏切换时网格不再整页重渲染（React DevTools Profiler 可验证只有变化卡片 render）。
