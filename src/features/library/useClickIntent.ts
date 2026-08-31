import { useCallback, useEffect, useRef } from "react";

/** 单击/双击消歧窗口（ms）：普通单击延迟执行，窗口内出现第二击则取消。 */
export const SINGLE_CLICK_DELAY_MS = 250;

export interface ClickIntentEvent {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** 原生 UIEvent.detail：同一元素快速第二击时为 2。 */
  detail: number;
}

export interface UseClickIntentOptions {
  /** 返回 true 的单击立即执行（选中类），不进延迟计时。 */
  isImmediate: (event: ClickIntentEvent) => boolean;
  /** 立即单击（Ctrl/Shift/多选模式）。 */
  onImmediate: (event: ClickIntentEvent) => void;
  /** 延迟单击（普通模式复制）。 */
  onSingle: () => void;
  /** 双击（打开大图预览）。 */
  onDouble: () => void;
}

/**
 * 单击/双击消歧：浏览器双击序列是 click(detail=1) → click(detail=2) → dblclick，
 * 第二击（detail > 1）直接取消第一击挂起的延迟单击，dblclick 再兜底取消一次。
 */
export function useClickIntent({ isImmediate, onImmediate, onSingle, onDouble }: UseClickIntentOptions) {
  const timerRef = useRef<number | null>(null);
  // 回调走 latest-ref：multiSelectMode 切换或 item 换绑不产生 stale closure。
  const optionsRef = useRef({ isImmediate, onImmediate, onSingle, onDouble });
  optionsRef.current = { isImmediate, onImmediate, onSingle, onDouble };

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 卸载（渐进渲染回收 / 切视图）时清掉挂起的单击，避免对已卸载项触发动作。
  useEffect(() => cancelPending, [cancelPending]);

  const handleClick = useCallback(
    (event: ClickIntentEvent) => {
      // 双击的第二击：取消第一击的延迟单击，后续 onDoubleClick 接管。
      if (event.detail > 1) {
        cancelPending();
        return;
      }
      cancelPending();
      if (optionsRef.current.isImmediate(event)) {
        optionsRef.current.onImmediate(event);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        optionsRef.current.onSingle();
      }, SINGLE_CLICK_DELAY_MS);
    },
    [cancelPending],
  );

  const handleDoubleClick = useCallback(() => {
    cancelPending();
    optionsRef.current.onDouble();
  }, [cancelPending]);

  return { handleClick, handleDoubleClick };
}
