/**
 * 模态焦点守卫（Phase 35）——每个窗口安装一次，覆盖全应用所有 Fluent Dialog。
 *
 * **非承重、best-effort。** 「弹窗操作后主窗口内容滚走」的根源修复是
 * `preventFocusScroll.ts`（让 tabster 那次 focus() 滚不动）；本文件只负责焦点
 * 卫生：模态打开期间焦点不该滞留在 `<body>`，否则 tabster 会把焦点甩到应用里
 * 某个不相干的元素上（现在不再伴随滚动，但落点依然不合理）。真机验证过它会在
 * 某些时序下静默失效——**不要再把任何"防滚动"的指望压在它身上**，也不要为了
 * 堵漏往里加复杂度；焦点落点错乱是可接受的降级。
 *
 * 背景：tabster（Fluent 的模态焦点陷阱实现方）：
 *
 *   ① tabster 的 ModalizerAPI 假设「模态打开期间焦点始终在模态内」。焦点一旦
 *      滞留到 <body>，它的 _onFocus 开头 `if (!ctx || !focusedElement) return`
 *      会直接返回、不做任何自我修正，内部的 activeId 就停在错误的值上。
 *   ② 此后**任意一次**普通点击都会走进 _onFocus 的 else 分支（因为
 *      `modalizer.userId !== activeId` 且非程序化聚焦），延时 100ms 调度
 *      _restoreModalizerFocus。
 *   ③ 它用 `focusable.findFirst/findLast({ container: tabster root })` 在**整个
 *      应用**里挑一个可聚焦元素并 `focus(el)` —— 而 tabster 全仓库不传
 *      `preventScroll`（`grep -rn preventScroll node_modules/tabster/dist/esm`
 *      零命中），浏览器于是把该元素滚进视口，顺带滚动它所有可滚动祖先。
 *      主网格的卡片是 `role="option" tabIndex={0}`，一屏几百个都可聚焦，
 *      挑中的那个大概率远在视口之外 —— 于是网格被一把拖走。
 *
 * 注意「跳」的时刻与「出问题」的时刻是**分开的**：焦点可能几秒前就丢了，滚动
 * 要等下一次点击才发生，所以极易被误判成「关闭弹窗的 bug」。
 *
 * 焦点滞留 <body> 的两个来源（都是完全正常的写法，不是编码问题）：
 *   - 嵌套模态关闭后无人接管焦点（TagPickerDialog 的 ConfirmDialog、
 *     SettingsMenu 的镜像源面板、UpdateAvailableDialog 的安装确认）；
 *   - 被聚焦元素随交互卸载（按钮跑起来被 Spinner 顶替、批量条消失、
 *     列表行被重置干掉…）。
 *
 * 修法（恢复①的不变量，而不是逐个弹窗打补丁）：焦点落到 <body> 且此刻仍有打开
 * 的模态时，把焦点按回**最上层**的那个 DialogSurface。按回去属于程序化聚焦，
 * tabster 会借此 setActive 回该模态，activeId 恢复正确，②③ 再也不会被调度。
 * `preventScroll: true` 保证这一步自身不产生任何滚动。
 *
 * 必须用**原生 focusout 捕获监听**，不能用 React 的 onBlur：嵌套弹窗在各自的
 * portal 里、事件不冒泡进父弹窗的 React 子树；而「被聚焦元素随卸载消失」时
 * React 已解绑 fiber、根本不派发合成事件 —— 这两条恰好就是唯二的触发来源。
 *
 * 退役条件：上游哪天给 tabster 的焦点拉回补上 `preventScroll`，本文件即可删除。
 * 升级 @fluentui/react-components / tabster 后值得复查一次上面那个 grep。
 * 完整定位过程见 docs/phase35-tag-dialog-focus-scroll.md。
 */

/** Fluent 的 DialogSurface：modalType 非 non-modal 时才 aria-modal，也才需要陷阱。 */
const MODAL_SURFACE_SELECTOR =
  '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';

let installed = false;

/**
 * 找当前最上层的已打开模态 surface。portal 按打开顺序追加到 body，所以文档序
 * 最后的那个就是最上层（嵌套弹窗晚于父弹窗挂载）。`unmountOnClose={false}` 的
 * 已关闭弹窗留在 DOM 里但带 aria-hidden，要跳过。
 *
 * 导出仅供单测（dialogFocusGuard.test.ts）——生产调用方只有本文件的监听器。
 */
export function topmostOpenModalSurface(doc: Document): HTMLElement | null {
  const surfaces = doc.querySelectorAll<HTMLElement>(MODAL_SURFACE_SELECTOR);
  for (let i = surfaces.length - 1; i >= 0; i -= 1) {
    const surface = surfaces[i];
    if (surface.isConnected && surface.getAttribute("aria-hidden") !== "true") {
      return surface;
    }
  }
  return null;
}

export function installDialogFocusGuard(doc: Document = document): void {
  if (installed) return;
  installed = true;

  function check(): void {
    // 整个窗口失焦（切到别的应用）→ 不抢焦点。
    if (!doc.hasFocus()) return;
    const active = doc.activeElement;
    // 焦点已经落到别的元素上 → 一切正常，不干预。
    if (active && active !== doc.body) return;
    // 没有打开的模态 → 焦点停在 body 是正常状态（tabster 也不会拉回）。
    topmostOpenModalSurface(doc)?.focus({ preventScroll: true });
  }

  // 通道 ①：焦点显式丢失。微任务里再读 activeElement——焦点转移在 focusout
  // 派发之后才落定。
  doc.addEventListener("focusout", () => queueMicrotask(check), true);

  // 通道 ②：**被聚焦元素随 DOM 移除而消失**。这条不能省：
  //   - 元素被 remove 时浏览器不保证再派发 focusout，光靠 ① 会漏；
  //   - 嵌套确认框关闭时 focusout 早于 portal 移除，那一刻正在消失的 surface
  //     仍在 DOM 里、仍是"最上层模态"，① 会把焦点按回它自己，紧接着它被卸载、
  //     焦点二次掉回 <body>，而这一次不再有 focusout —— 守卫永远等不到第二次
  //     机会，tabster 的 activeId 就停在已销毁的确认框上（真机复现的
  //     「删除标签仍然跳」根因）。
  // portal 容器是 body 的直接子节点，所以 childList 不带 subtree 就够，
  // 不会被网格几百张卡片的增删拖累。
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.removedNodes.length > 0) {
        queueMicrotask(check);
        return;
      }
    }
  }).observe(doc.body, { childList: true });
}
