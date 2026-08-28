import { useCallback, useEffect, useState } from "react";
import type { IndexedImage } from "../../types";

export type SelectionMode = "replace" | "toggle" | "range";

/**
 * 网格多选状态：按 id 集合维护，anchorId 支持 Shift 范围选择。
 *
 * prune 按「id 集合」而非「数组 identity」：换视图/搜索收窄时选区自动跟随
 * 可见集收缩或清空；排序变化（同 id 集重排）不丢选区，只校验 anchor 是否仍存在。
 */
export function useMultiSelection(items: IndexedImage[]) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);

  useEffect(() => {
    const valid = new Set(items.map((item) => item.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    setAnchorId((prev) => (prev !== null && valid.has(prev) ? prev : null));
  }, [items]);

  const selectOnly = useCallback((id: number) => {
    setSelectedIds(new Set([id]));
    setAnchorId(id);
  }, []);

  const toggle = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchorId(id);
  }, []);

  const rangeSelect = useCallback(
    (id: number) => {
      setSelectedIds(() => {
        if (anchorId === null) return new Set([id]);
        const start = items.findIndex((item) => item.id === anchorId);
        const end = items.findIndex((item) => item.id === id);
        if (start === -1 || end === -1) return new Set([id]);
        const [lo, hi] = start < end ? [start, end] : [end, start];
        const next = new Set<number>();
        for (let k = lo; k <= hi; k++) next.add(items[k].id);
        return next;
      });
      setAnchorId(id);
    },
    [anchorId, items],
  );

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((item) => item.id)));
    setAnchorId(null);
  }, [items]);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    setAnchorId(null);
  }, []);

  const deselect = useCallback((ids: number[]) => {
    const drop = new Set(ids);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of drop) next.delete(id);
      return next;
    });
    setAnchorId((prev) => (prev !== null && drop.has(prev) ? null : prev));
  }, []);

  return { selectedIds, anchorId, selectOnly, toggle, rangeSelect, selectAll, clear, deselect };
}
