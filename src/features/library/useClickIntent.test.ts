import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClickIntent, type ClickIntentEvent } from "./useClickIntent";

function makeEvent(overrides: Partial<ClickIntentEvent> = {}): ClickIntentEvent {
  return { ctrlKey: false, metaKey: false, shiftKey: false, detail: 1, ...overrides };
}

describe("useClickIntent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("普通单击延迟 250ms 后触发 onSingle 恰一次", () => {
    const onSingle = vi.fn();
    const onImmediate = vi.fn();
    const onDouble = vi.fn();
    const { result } = renderHook(() =>
      useClickIntent({ isImmediate: () => false, onImmediate, onSingle, onDouble }),
    );

    act(() => result.current.handleClick(makeEvent()));
    expect(onSingle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(onSingle).toHaveBeenCalledTimes(1);
    expect(onImmediate).not.toHaveBeenCalled();
    expect(onDouble).not.toHaveBeenCalled();
  });

  it("第二击（detail=2）+ 双击取消挂起的单击，只触发 onDouble", () => {
    const onSingle = vi.fn();
    const onDouble = vi.fn();
    const { result } = renderHook(() =>
      useClickIntent({ isImmediate: () => false, onImmediate: () => {}, onSingle, onDouble }),
    );

    act(() => result.current.handleClick(makeEvent()));
    act(() => result.current.handleClick(makeEvent({ detail: 2 })));
    act(() => result.current.handleDoubleClick());
    act(() => vi.advanceTimersByTime(250));
    expect(onSingle).not.toHaveBeenCalled();
    expect(onDouble).toHaveBeenCalledTimes(1);
  });

  it("Ctrl 单击同步触发 onImmediate，不进延迟计时", () => {
    const onSingle = vi.fn();
    const onImmediate = vi.fn();
    const { result } = renderHook(() =>
      useClickIntent({ isImmediate: (e) => e.ctrlKey, onImmediate, onSingle, onDouble: () => {} }),
    );

    act(() => result.current.handleClick(makeEvent({ ctrlKey: true })));
    expect(onImmediate).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(250));
    expect(onSingle).not.toHaveBeenCalled();
  });

  it("isImmediate 为 true（多选模式）时同步走 onImmediate", () => {
    const onSingle = vi.fn();
    const onImmediate = vi.fn();
    const { result } = renderHook(() =>
      useClickIntent({ isImmediate: () => true, onImmediate, onSingle, onDouble: () => {} }),
    );

    act(() => result.current.handleClick(makeEvent()));
    expect(onImmediate).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(250));
    expect(onSingle).not.toHaveBeenCalled();
  });

  it("卸载后挂起的单击不再触发", () => {
    const onSingle = vi.fn();
    const { result, unmount } = renderHook(() =>
      useClickIntent({ isImmediate: () => false, onImmediate: () => {}, onSingle, onDouble: () => {} }),
    );

    act(() => result.current.handleClick(makeEvent()));
    unmount();
    act(() => vi.advanceTimersByTime(250));
    expect(onSingle).not.toHaveBeenCalled();
  });
});
