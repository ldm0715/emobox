# Phase 35：弹窗交互后主窗口内容自动滚走（tabster Modalizer 焦点拉回）

> 结论先行：根因**不在应用代码里**，而在 `tabster`（Fluent 的模态焦点陷阱实现方）。
> 弹窗内的焦点一旦滞留到 `<body>`，tabster 的 `ModalizerAPI` 内部状态就会失准，随后
> **任意一次**普通点击都会触发它的"焦点拉回"——它在**整个应用**里挑一个可聚焦元素
> 并调 `focus()`，且**从不传 `preventScroll`**，浏览器于是把那个元素滚进视口，主网格
> 被拖走。
>
> 修复 = 在浏览器 API 边界把 tabster 漏传的那个参数补上：程序化 `focus()` 默认
> `preventScroll: true`。见 `src/lib/preventFocusScroll.ts`。
> （先做的"焦点守卫"方向是错的，真机连漏两条路径，复盘见 §7.1。）

相关版本：`@fluentui/react-components` 9.74.6 / `@fluentui/react-dialog` 9.18.3 /
`@fluentui/react-tabster` 9.26.17 / `tabster` 8.8.0 / React 19。

---

## 1. 现象

在主窗口把表情网格滚到中间位置，右键某张表情 →「管理标签」→ 关闭弹窗，主网格会
**瞬间跳走一段**（真机实测 `scrollTop` 1000 → 2406、99 → 7350、还有一次 → 5175）。

用户侧观察到的三条事实（后来全部被日志证实，也正是它们把范围切干净的）：

| 观察 | 含义 |
|---|---|
| 什么都不改、直接关闭也会跳 | 与标签数据、OCR、视图重拉全部无关 |
| 是"瞬间跳一段就停"，不是持续滚动 | 单次 `focus()`／`scrollIntoView()`，不是无限滚动哨兵失控 |
| 其它弹窗（大图预览／移动到分组／重命名）都不跳 | 与弹窗的**内容动态性**有关，不是 Dialog 的通用行为 |

## 2. 复盘：为什么前几次没修好

在这次定位之前，仓库里已经有过一次"修复"（`5f0f70e`），其结论写进了 `CLAUDE.md`：

> 「完成」必须与「关闭」同走 `DialogTrigger`（`action="close"`），不要 `onClick` 直调
> `onOpenChange(false)`——直调时弹窗内容瞬间卸载，Fluent 的焦点恢复让 tabster 的
> `scrollIntoView` 推了网格 `scrollTop`。

**这个结论是错的**，两处都站不住：

1. 读 `useDialogTrigger`（`node_modules/@fluentui/react-dialog/lib/components/DialogTrigger/useDialogTrigger.js`）可见它**无条件**调用 `useModalAttributes()` 并把
   `triggerAttributes`（`restorer: { type: Target }`）铺到 child 上——`action="open"` 和
   `action="close"` 完全同一条路径。所以"关闭走 DialogTrigger 所以不跳、完成直调所以跳"
   在机制上不可能成立。
2. 真正让人误判的是**首开不跳、重开才跳**（原因见 §6）。改完之后恰好试了一次首开，
   看着像好了，实际没动到根因。

教训：**这类"看起来修好了"的现象，必须先拿到运行时证据再下结论。**

## 3. 定位方法：运行时探针

纯读源码推演已经收敛不了（Fluent 的 body scroll lock、`resetKey` 重挂载、布局回流、
Restorer 焦点恢复都被逐一排除），于是加了一个临时探针（`src/debug/scrollProbe.ts`，
定位完成后已删除），在 dev 主窗口装载：

- `document` 上捕获阶段监听 `scroll` / `focusin` / `focusout`（含 `relatedTarget`）；
- 猴补丁 `HTMLElement.prototype.focus`、`Element.prototype.scrollIntoView` /
  `scrollTo` / `scroll`、以及 `Element.prototype.scrollTop` 的 setter，**每次调用都记
  调用栈**；
- `MutationObserver` 记录 `document.body` 的子节点增删（portal 挂载/卸载的时间锚点）；
- 浮层日志 + 复制按钮（F8 开关），用户复现一次就能把全文贴回来。

> 注意探针自噬：`render()` 里写 `pre.scrollTop` 会被自己的 setter 补丁记录 → 又触发
> render，形成每帧递归。必须把浮层自身的节点从所有钩子里排除。

**第一份日志就把元凶钉死了**：

```
[18648ms] focusin: button ... [tabster={"restorer":{"type":1}}] "完成"
[18782ms] focus(): button.fui-Button.r1f29ykk.___rd1zs30_e4lg0w0 preventScroll=false
        at FocusedElementState.focus
        <- at ModalizerAPI._restoreModalizerFocus      ← 元凶
[18785ms] SCROLL: div.___1wwo7xc_... scrollTop=2406    ← 网格从 1000 跳到 2406
```

不是 `Restorer`（焦点恢复到触发元素），是 **`Modalizer`（模态焦点陷阱）**。

## 4. 根因：三层机制叠加

### 4.1 Fluent 把模态焦点交给 tabster

`useDialog_unstable`（`react-dialog/lib/components/Dialog/useDialog.js`）：

```js
const dialogRef = useFocusFirstElement(open, modalType);
const { modalAttributes, triggerAttributes } = useModalAttributes({
  trapFocus: modalType !== 'non-modal',
  legacyTrapFocus: !inertTrapFocus,          // inertTrapFocus 默认 false → legacy = true
});
```

`useModalAttributes`（`react-tabster/lib/hooks/useModalAttributes.js`）把
`modalizer` + `restorer:Source` 铺到 `DialogSurface` 上，把 `restorer:Target` 铺到
`DialogTrigger` 上。**焦点陷阱的实现方是 tabster，不是 Fluent。**

另外 `useFocusFirstElement` 在 `open` 变 true 时用 `findFirstFocusable(surface)` 找
**弹窗内第一个可聚焦元素**并 `.focus()` ——这条后面会用到。

### 4.2 tabster 的"焦点拉回"

`node_modules/tabster/dist/esm/Modalizer.js`，`ModalizerAPI._onFocus`：

```js
_onFocus = (focusedElement, detail) => {
  const ctx = focusedElement && RootAPI.getTabsterContext(tabster, focusedElement);
  if (!ctx || !focusedElement) return;              // ← 焦点丢到 body 时直接返回
  ...
  if (modalizer?.userId === this.activeId) { ...; return; }   // 焦点在活动模态内 → 正常
  if (detail.isFocusedProgrammatically || this.currentIsOthersAccessible || ...) {
    this.setActive(modalizer);                      // 程序化聚焦 → 切换活动模态
  } else {
    // 焦点跑到活动模态之外 → 100ms 后把它拉回来
    this._restoreModalizerFocusTimer = win.setTimeout(
      () => this._restoreModalizerFocus(focusedElement), 100);
  }
};
```

`_restoreModalizerFocus`：

```js
const container = ctx?.root.getElement();           // ← tabster root = 整个应用
let toFocus = tabster.focusable.findFirst({ container, useActiveModalizer: true });
if (toFocus) {
  if (outsideElement.compareDocumentPosition(toFocus) & DOCUMENT_POSITION_PRECEDING) {
    toFocus = tabster.focusable.findLast({ container, useActiveModalizer: true });
  }
  tabster.focusedElement.focus(toFocus);            // ← 关键
  return;
}
```

### 4.3 致命细节：tabster 从不传 `preventScroll`

```
$ grep -rn "preventScroll" node_modules/tabster/dist/esm/*.js
(无输出)
```

`tabster.focusedElement.focus(el)` 最终就是 `el.focus()`。而 `HTMLElement.focus()` 的
默认行为是**把元素滚进视口，并逐级滚动所有可滚动祖先**。

讽刺的是 `preventScroll` **一直在签名里**（`tabster/dist/esm/State/FocusedElement.js`），
只是 `_restoreModalizerFocus` 那个调用点没传 —— 这也正是最终修复的切入点（§7.2）：

```js
focus(element, noFocusedProgrammaticallyFlag, noAccessibleCheck, preventScroll) {
    if (!this._tabster.focusable.isFocusable(...)) return false;
    element.focus({ preventScroll });      // ← 第 4 参，调用方没传 → undefined
    return true;
}
```

`_restoreModalizerFocus` 挑的是**整个应用**里的首个/末个可聚焦元素。本应用的网格卡片
是 `role="option" tabIndex={0}`，一屏几百个都可聚焦——挑中的那个大概率远在视口之外，
于是主网格被一把拖过去。这就是"瞬间跳一段"的全部来源。

### 4.4 触发条件是**两段式**的（前两次修复漏掉的部分）

从 `_onFocus` 的分支条件可以反推：能走进 `else`（调度拉回）**必须**同时满足

- `modalizer?.userId !== this.activeId`，且
- 不是程序化聚焦。

也就是说 **`activeId` 已经失准**——它不再等于当前弹窗 modalizer 的 `userId`。

而 `activeId` 失准的前提是：**焦点曾经滞留在 `<body>`**。注意 `_onFocus` 开头
`if (!ctx || !focusedElement) return;` ——焦点掉到 body 的那一刻 tabster 什么都不做、
也不会自我修正，`activeId` 就这么留在错误的值上。等下一次真实点击发生，才在
`else` 分支里爆发。

> 这解释了一个非常反直觉的现象：**"跳"的那一刻和"出问题"的那一刻是分开的**。
> 焦点丢失可能发生在几秒前（比如点「开始识别」时），滚动却在你点「完成」之后才发生，
> 所以一直被误当成"关闭弹窗的 bug"。

## 5. 一次完整的出错流程（真实日志逐帧）

以"左栏 🗑 移除标签 → 确认 → 点开始识别 → 完成"为例（时间戳为探针记录的真实值）：

```
[13575] focus():  SearchBox                      ← 弹窗打开，Fluent 聚焦首个可聚焦元素
                                                    tabster: setActive(标签弹窗 modalizer)
                                                    activeId = tagId ✓
[14691] focusin:  🗑 按钮                         ← 用户点左栏删除图标
[14792] focus():  "取消"                          ← ConfirmDialog 打开，聚焦其首个元素
                                                    tabster: setActive(确认弹窗 modalizer)
                                                    activeId = confirmId
[15279] focusin:  "移除"                          ← 用户点确认
[15838] focusout: "移除" -> related=null          ← ★ 确认弹窗卸载，焦点掉到 <body>
[15849] body -node: div                             没有任何人接管焦点
                                                    activeId 停在错误状态
[16130] focusin:  "开始识别"                       ← 用户点标签弹窗里的按钮
                                                    _onFocus: modalizer(tagId) !== activeId
                                                    且非程序化 → 走 else 分支
                                                    → setTimeout(拉回, 100ms)
[16335] focus():  某个主窗口按钮 preventScroll=false
        at ModalizerAPI._restoreModalizerFocus    ← ★ 拉回执行
[16338] SCROLL:   scrollTop=7350                  ← ★ 网格被滚走

[19901] focusin:  "完成"                          ← 用户点完成，activeId 仍然错的
[20044] focus():  同一个按钮                       ← ★ 又拉回一次
```

注意 **`[16338]` 的滚动发生在点「完成」之前**——真正"跳"的触发点是点「开始识别」，
而不是关闭动作。用户只在关闭后才注意到，是因为弹窗遮住了网格。

### 焦点滞留 `<body>` 的两个来源

| 来源 | 具体场景 |
|---|---|
| **嵌套模态关闭后无人接管** | 移除标签／批量移除／全局删除三个确认框；设置弹窗里的镜像源面板；更新弹窗的安装确认 |
| **被聚焦元素随交互卸载** | 点「开始识别」后按钮被 `Spinner` 顶替；批量条移除完整条消失；行内重命名提交后 `Input` 换回 label；重开弹窗时残留标签行被重置干掉 |

**这两条都是完全正常的 React/Fluent 写法**，不是编码不规范。问题在于 tabster 假设了
"模态永远持有焦点"，却在假设被打破时用一个会滚动视口的手段去纠正。

## 6. 为什么是标签弹窗先暴露，以及为什么"首开不跳、重开才跳"

`MoveToGroupDialog` / `RenameEmojiDialog` / `EmojiPreviewDialog` / `GroupDialog` 的结构、
`modalType`、关闭按钮写法与标签弹窗完全一致，差别只在**内容的动态性**：它们不嵌套第二
个模态，首个可聚焦元素（Checkbox / Input / Button）在弹窗生命周期内也不会被卸载。标签
弹窗两条全占。

> **但它不是唯一有隐患的弹窗。** 定位收尾时复查全仓库，发现还有两个同样嵌套了第二个
> 模态的：
>
> | 弹窗 | 嵌套的模态 |
> |---|---|
> | `TagPickerDialog` | 3 个 `ConfirmDialog`（移除 / 批量移除 / 全局删除） |
> | `SettingsMenu` | `aboutUpdate.tsx` 的镜像源管理面板 Dialog |
> | `UpdateAvailableDialog` | 安装确认 Dialog（与主弹窗同为 Fragment 兄弟） |
>
> 只是没人会在滚动网格之后去开设置或更新弹窗，所以一直没撞上。**这决定了修复必须做
> 在全局层，而不是给标签弹窗单独打补丁。**

**首开 vs 重开**的差异来自另一个独立缺陷：`TagPickerDialog` 是"常挂载 + `open` 控制"，
组件 state 跨会话残留，而 `DialogSurface` 每次 `open` 都重新挂载。原来 `currentTagIds`
的重置写在 `useEffect([open])` 里——**太晚了**：

```
surface 首帧挂载（带着上一轮残留的标签行）
  → Fluent useFocusFirstElement 聚焦第一行的 Checkbox
  → useEffect 跑，setCurrentTagIds([]) 把该行卸载
  → 焦点掉到 <body>                       ← 落进 §4.4 的前提
```

首次打开时 `currentTagIds` 本来就是空的，左栏没有行，首个可聚焦元素是右栏的
`SearchBox`（不会被卸载）→ 焦点不丢 → 不跳。这就是"改完试一次觉得好了"的由来。

## 7. 修复

> 这一节记录了**两次尝试**：先做的"焦点守卫"方向是错的，真机连续漏掉两条路径；
> 最终的根源修复是补上 tabster 漏传的那个参数。保留失败记录是为了让后来的人不要
> 再往同一个方向补。

### 7.1 走过的弯路：在焦点丢失时把它按回模态（已降级为非承重）

第一个方案是恢复 §4.4 的前提——不让焦点滞留在 `<body>`：监听焦点丢失，把焦点按回
最上层的 `DialogSurface`（`preventScroll: true`）。按回去属于程序化聚焦，tabster 会
借此 `setActive` 回该模态，`activeId` 恢复正确。

思路成立，实现却站不住。真机连续暴露两个洞：

1. **第一版用 React `onBlur`，一次都没触发。** 嵌套确认框在**自己的 portal** 里，
   事件不冒泡进父弹窗的 React 子树；而"被聚焦元素随卸载消失"时 React 已解绑 fiber、
   根本不派发合成事件——这两条恰好就是唯二的触发来源。改成原生 `focusout` 捕获监听
   才开始工作。
2. **第二版仍然漏。** 确认框关闭时 `focusout` **早于** portal 移除，那一刻正在消失的
   surface 仍在 DOM 里、仍是"最上层模态"，守卫会把焦点按回**它自己**；紧接着它被
   卸载、焦点二次掉回 `<body>`，而这一次不再有 `focusout`。补了一条
   `MutationObserver` 通道（body childList，portal 是 body 直接子节点）之后，真机
   日志显示**关键的那一次两条���道依然静默 bail** ——`activeId` 是 tabster 的私有
   状态，从 DOM 侧只能靠侧信号去猜它什么时候失准。

**结论：这个方向要求穷举「焦点可能丢失的每一条路径」，是跟一个看不见的状态机赛��。**
`src/lib/dialogFocusGuard.ts` 保留下来，但**降级为非承重的焦点卫生**（模态打开期间
焦点不该停在 `<body>`，否则落点不合理），文件头写明不要再为了堵漏往里加复杂度。

### 7.2 根源修复：补上 tabster 漏传的 `preventScroll`

看清楚这个签名就够了（`tabster/dist/esm/State/FocusedElement.js`）：

```js
focus(element, noFocusedProgrammaticallyFlag, noAccessibleCheck, preventScroll) {
    if (!this._tabster.focusable.isFocusable(...)) return false;
    element.focus({ preventScroll });      // ← 第 4 参
    return true;
}
```

`preventScroll` 一直在签名里，`_restoreModalizerFocus` 只是没传（`grep -rn
preventScroll node_modules/tabster/dist/esm/*.js` 零命中）。所以不必推断任何状态，
**在浏览器 API 边界把这个默认值补上**即可（`src/lib/preventFocusScroll.ts`，
在 `main.tsx` 里最先执行）：

```ts
export function resolveFocusOptions(options?: FocusOptions): FocusOptions {
  return { ...options, preventScroll: options?.preventScroll ?? true };
}

const originalFocus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
  originalFocus.call(this, resolveFocusOptions(options));
};
```

tabster 传的是 `{ preventScroll: undefined }` → 补成 `true`；显式 `{ preventScroll:
false }` 原样放行，作为"我就是要滚动到它"的逃生口。**没有时序、没有竞态、不依赖任何
私有状态，也不可能漏路径**——它就是那一行真正产生滚动的调用。

**为什么在本应用全局包 `focus()` 是安全的**（逐条核过）：

| 调用方 | 影响 |
|---|---|
| 原生 Tab 键导航 / 鼠标点击 | **不走这个方法**，浏览器内部自己滚动，完全不受影响 |
| tabster 的 Mover / 方向键导航 | 本应用**零引用**（`useArrowNavigationGroup` / `useFocusableGroup` / `useTabster` 全仓库无命中） |
| 应用自己的 4 处 `.focus()` | 目标全是**已经可见**的输入框：侧栏分组搜索、主搜索（Ctrl+F）、标签行内重命名、快捷搜索输入框 |
| Fluent 内部（弹窗首元素、菜单项） | 目标都在 `position: fixed` 的 portal 里，本来就没有可滚动祖先 |
| 快捷搜索列表的"选中项滚进视口" | 走独立的 `scrollIntoView({ block: "nearest" })`，不受影响 |

**新增 `.focus()` 调用时若确实需要滚动到目标，显式传 `{ preventScroll: false }`。**

### 7.3 `currentTagIds` 的重置提到渲染阶段（独立的小 bug）

```tsx
const [prevOpen, setPrevOpen] = useState(open);
if (open !== prevOpen) {
  setPrevOpen(open);
  if (open) setCurrentTagIds([]);      // React 官方「props 变化时调整 state」模式
}
```

同步移除了 `useEffect([open])` 里的 `setCurrentTagIds([])`（那里太晚，见 §6）。
这条独立于 §7.2：它修的是"重开弹窗会闪一下上一个表情的标签"，顺带消掉了焦点丢失的
一个来源。

> 清空只能放在 **open 翻转时**，不能放在关闭时——关闭有退场动画，关闭时清空会让标签
> 列表在动画期间闪成空的（仓库既有的"常挂载弹窗 payload 快照"约定同理由）。

### 7.4 排除掉的方案与原因

| 方案 | 为什么不行 |
|---|---|
| 改「完成」按钮的关闭路径（`DialogTrigger` vs `onOpenChange`） | 两者同一条路径，见 §2 |
| 焦点守卫单独作为修复 | 见 §7.1：要求穷举焦点丢失路径，真机连漏两条 |
| 只给 `TagPickerDialog` 打补丁 | `SettingsMenu` 和 `UpdateAvailableDialog` 有同样的嵌套模态隐患（§6），新写的弹窗还会再犯 |
| `<Dialog inertTrapFocus>` | `_restoreModalizerFocus` 的调度**不受** `isTrapped` 门控（`isTrapped` 在 `Modalizer.js` 里只用于第 152 行的 tab-out 处理），换成 inert 陷阱照样触发 |
| 把 `ConfirmDialog` 挪进父 `DialogSurface` 里变成"真嵌套" | `isNestedDialog` 只影响 body scroll lock 和遮罩样式，**不传给** `useModalAttributes`，tabster 看到的东西一模一样 |
| `patch-package` 直接改 tabster 源码 | 效果与 §7.2 等价，但要引入新的 devDependency + postinstall，且每次升级都要复核补丁是否还适用；§7.2 在自家代码里达到同样效果，成本更低 |
| 关闭弹窗前后保存/恢复网格 `scrollTop` | 治标；且滚动发生在关闭**之前**（见 §5），时间窗对不上 |
| 给网格卡片去掉 `tabIndex` | 破坏键盘可达性，且 tabster 会改挑别的可聚焦元素，问题只是换个位置 |

## 8. 验证

用户在真机按四条路径各复现多次，均不再跳：

1. 左栏 🗑 移除标签 → 确认「移除」→「完成」（**最顽固的那条**，前两版都栽在这里）
2. 同上但确认框点「取消」→ 回弹窗继续操作 →「完成」
3. 「开始识别」→ 等 OCR 跑完 →「完成」
4. 连续重开两三次，每次什么都不改直接「关闭」

判据（探针日志）：`at ModalizerAPI._restoreModalizerFocus` 这行**仍然会出现**——修复
没有阻止 tabster 去挪焦点，只是让那次挪动不再滚动视口；判据是**它后面不再跟
`SCROLL` 行**。

自动化检查：`npx tsc --noEmit` + `npx vitest run`（13 文件 / 116 用例）全绿。

## 9. 复发排查指引

1. **先怀疑焦点，不要先怀疑数据或布局。** 一次性跳位 + 与数据无关 ≈ 某处调了不带
   `preventScroll` 的 `focus()` / `scrollIntoView()`。
2. 重新装一次 §3 那种探针（猴补丁 `focus` 记调用栈）——十分钟能定位，纯推演可能一天
   都收敛不了。**注意"跳"的时刻与"出问题"的时刻是分开的**，别只盯着最后一个动作。
3. **不要往 `dialogFocusGuard.ts` 里加复杂度堵漏。** 它已经是非承重件；防滚动由
   `preventFocusScroll.ts` 在 API 边界兜住。
4. 新写的弹窗**不需要做任何事**。新写的 `.focus()` 调用若需要滚动到目标，显式传
   `{ preventScroll: false }`。
5. 升级 `@fluentui/react-components` / `tabster` 后复查
   `grep -rn "preventScroll" node_modules/tabster/dist/esm/*.js`——上游哪天补了，
   `src/lib/preventFocusScroll.ts` 即可整个删除。
