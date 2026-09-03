/**
 * 让程序化 `focus()` 默认不滚动视口（Phase 35 根源修复，承重）。
 *
 * ## 为什么需要它
 *
 * tabster（Fluent 的模态焦点陷阱实现方）的 `ModalizerAPI._restoreModalizerFocus`
 * 在它认为「焦点跑出了活动模态」时，会用
 * `focusable.findFirst/findLast({ container: tabster root })` 在**整个应用**里挑一个
 * 可聚焦元素，然后：
 *
 * ```js
 * tabster.focusedElement.focus(toFocus);   // Modalizer.js
 * // → FocusedElementState.focus(element, noFlag, noAccessibleCheck, preventScroll)
 * // → element.focus({ preventScroll });   // ← preventScroll 是 undefined
 * ```
 *
 * 签名里明明有 `preventScroll`，调用点却没传（`grep -rn preventScroll
 * node_modules/tabster/dist/esm/*.js` 零命中）。于是浏览器按默认行为把那个元素滚进
 * 视口，并逐级滚动它所有可滚动祖先 —— 主网格的卡片是 `role="option" tabIndex={0}`、
 * 一屏几百个都可聚焦，挑中的那个大概率远在视口之外，网格就被一把拖走
 * （真机实测 scrollTop 1000→2406、99→7350、→5175）。
 *
 * ## 为什么修在这一层
 *
 * 触发前提是「焦点滞留 `<body>` → tabster 内部的 activeId 失准 → 下一次普通点击才
 * 爆发」。activeId 是私有状态，从 DOM 侧只能猜；试过在焦点丢失时把它按回模态
 * （见 `dialogFocusGuard.ts`），但那要求穷举「焦点可能丢失的每一条路径」，真机上
 * 连续漏掉了两条。**与其跟看不见的状态机赛跑，不如让那次调用本身滚不动。**
 *
 * ## 为什么这样做是安全的（针对本应用逐条核过）
 *
 * - **原生键盘 Tab 导航不走这个方法**，浏览器内部自己滚动，完全不受影响；鼠标点击
 *   同理。受影响的只有 JS 里显式调用的 `el.focus()`。
 * - 本应用**没有使用 tabster 的 Mover / 方向键导航**（`useArrowNavigationGroup`、
 *   `useFocusableGroup`、`useTabster` 全仓库零引用），所以 tabster 侧除了模态那套
 *   机制没有别的 focus 调用方。
 * - 应用自己的 4 处 `.focus()` 目标全是**已经可见**的输入框（侧栏分组搜索、主搜索、
 *   标签行内重命名、快捷搜索输入框），都不需要滚动到焦点。
 * - Fluent 内部的 `focus()`（弹窗首元素、菜单项）目标都在 `position: fixed` 的
 *   portal 里，本来就没有可滚动祖先。
 * - 快捷搜索列表的「选中项滚进视口」走的是独立的 `scrollIntoView({block:"nearest"})`，
 *   不受影响。
 *
 * ## 逃生口
 *
 * 确实需要「聚焦并滚动到该元素」时，显式传 `{ preventScroll: false }` —— 包装只在
 * 调用方**没有明确表态**时才补上 `true`（tabster 传的是 `undefined`，会被补成
 * `true`；显式的 `false` 原样放行）。
 *
 * ## 退役条件
 *
 * 上游哪天在 `_restoreModalizerFocus` 里补上 `preventScroll`，本文件即可删除。
 * 升级 @fluentui/react-components / tabster 后跑一次：
 *   `grep -rn "preventScroll" node_modules/tabster/dist/esm/*.js`
 *
 * 完整定位过程见 `docs/phase35-tag-dialog-focus-scroll.md`。
 */

/**
 * 补默认值：调用方没明确表态（未传 options 或 `preventScroll` 为 undefined）时
 * 一律按不滚动处理；显式传 `false` 表示「我就是要滚动到它」，原样放行。
 *
 * 导出供单测（`preventFocusScroll.test.ts`）——生产调用方只有下面的包装。
 */
export function resolveFocusOptions(options?: FocusOptions): FocusOptions {
  return { ...options, preventScroll: options?.preventScroll ?? true };
}

let installed = false;

export function installPreventFocusScroll(): void {
  if (installed) return;
  installed = true;

  const originalFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function focusWithoutScrolling(
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    originalFocus.call(this, resolveFocusOptions(options));
  };
}
