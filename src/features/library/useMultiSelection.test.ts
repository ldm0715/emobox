import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { IndexedImage } from "../../types";
import { useMultiSelection } from "./useMultiSelection";

function makeImage(id: number): IndexedImage {
  return {
    id,
    name: `${id}.png`,
    path: `/managed/${id}.png`,
    extension: "png",
    width: 64,
    height: 64,
    sizeBytes: 128,
  };
}

const items = [makeImage(1), makeImage(2), makeImage(3), makeImage(4), makeImage(5)];

describe("useMultiSelection", () => {
  it("selectOnly 替换选区并设 anchor", () => {
    const { result } = renderHook(() => useMultiSelection(items));
    act(() => result.current.selectOnly(2));
    expect([...result.current.selectedIds]).toEqual([2]);
    expect(result.current.anchorId).toBe(2);
    act(() => result.current.selectOnly(4));
    expect([...result.current.selectedIds]).toEqual([4]);
    expect(result.current.anchorId).toBe(4);
  });

  it("toggle 增删并更新 anchor", () => {
    const { result } = renderHook(() => useMultiSelection(items));
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(3));
    expect([...result.current.selectedIds].sort()).toEqual([1, 3]);
    expect(result.current.anchorId).toBe(3);
    act(() => result.current.toggle(1));
    expect([...result.current.selectedIds]).toEqual([3]);
  });

  it("rangeSelect 从 anchor 到目标闭区间替换", () => {
    const { result } = renderHook(() => useMultiSelection(items));
    act(() => result.current.selectOnly(2));
    act(() => result.current.rangeSelect(4));
    expect([...result.current.selectedIds].sort()).toEqual([2, 3, 4]);
    expect(result.current.anchorId).toBe(4);
  });

  it("rangeSelect 支持反向区间", () => {
    const { result } = renderHook(() => useMultiSelection(items));
    act(() => result.current.selectOnly(4));
    act(() => result.current.rangeSelect(2));
    expect([...result.current.selectedIds].sort()).toEqual([2, 3, 4]);
  });

  it("anchor 为 null 时 range 退化为单选", () => {
    const { result } = renderHook(() => useMultiSelection(items));
    act(() => result.current.clear());
    act(() => result.current.rangeSelect(3));
    expect([...result.current.selectedIds]).toEqual([3]);
  });

  it("selectAll 全选、clear 清空", () => {
    const { result } = renderHook(() => useMultiSelection(items));
    act(() => result.current.selectAll());
    expect(result.current.selectedIds.size).toBe(5);
    act(() => result.current.clear());
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.anchorId).toBeNull();
  });

  it("deselect 剔除指定 id，anchor 若被剔除则清空", () => {
    const { result } = renderHook(() => useMultiSelection(items));
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(2));
    act(() => result.current.deselect([1]));
    expect([...result.current.selectedIds]).toEqual([2]);
    expect(result.current.anchorId).toBe(2);
    act(() => result.current.deselect([2]));
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.anchorId).toBeNull();
  });

  it("items 换成完全不同 id 集（切视图）时选区清空", () => {
    const other = [makeImage(7), makeImage(8)];
    const { result, rerender } = renderHook(
      ({ list }: { list: IndexedImage[] }) => useMultiSelection(list),
      { initialProps: { list: items } },
    );
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(3));
    rerender({ list: other });
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("items 排序重排（同 id 集）保留选区", () => {
    const reordered = [makeImage(5), makeImage(4), makeImage(3), makeImage(2), makeImage(1)];
    const { result, rerender } = renderHook(
      ({ list }: { list: IndexedImage[] }) => useMultiSelection(list),
      { initialProps: { list: items } },
    );
    act(() => result.current.toggle(2));
    act(() => result.current.toggle(4));
    rerender({ list: reordered });
    expect([...result.current.selectedIds].sort()).toEqual([2, 4]);
  });

  it("items 收窄（部分 id 消失）选区跟随收缩", () => {
    const narrowed = [makeImage(2), makeImage(3)];
    const { result, rerender } = renderHook(
      ({ list }: { list: IndexedImage[] }) => useMultiSelection(list),
      { initialProps: { list: items } },
    );
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(2));
    act(() => result.current.toggle(4));
    rerender({ list: narrowed });
    expect([...result.current.selectedIds]).toEqual([2]);
  });
});
