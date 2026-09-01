/**
 * 整窗拖拽期间的失焦抑制。
 *
 * `startDragging()` 进入 Win32 move loop 时窗口会短暂失焦
 * （WM_KILLFOCUS → WM_SETFOCUS 一对），若不抑制，QuickSearchWindow 的
 * 失焦关闭逻辑会把正在拖拽的浮层直接隐藏掉（真机复现：按住标题栏/背景
 * 一按浮层就消失）。拖拽前置位，焦点恢复（focus=true）或超时兜底复位。
 */
export const overlayDragGuard = {
  active: false,
};
