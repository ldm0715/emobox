import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage, searchEmojis } from "../../lib/tauri";
import type { IndexedImage } from "../../types";
import { useDebouncedValue } from "../library/useDebouncedValue";

/**
 * 浮层搜索编排：
 * - 空 query → 全库最近优先（`sort: "recent"`，未用过的新图也可见，限 30）；
 * - 非空 query → 全库跨字段搜索（限 60），支持 `组*标签` 精确语法（`:` 为别名）。
 *
 * **requestSeq 守卫**：`query` / `activationId` / `reloadToken` 触发的旧请求
 * 返回后一律丢弃，只有当前请求能更新 `items/loading/error`；cleanup 在卸载或
 * 依赖变化时递增序号，作废挂起请求（含窗口卸载场景），防止过期 setState。
 */
export function useQuickSearchQuery(activationId: number, reloadToken: number) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const [items, setItems] = useState<IndexedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");

    const trimmed = debouncedQuery.trim();
    const options = trimmed
      ? { view: "all" as const, query: trimmed, limit: 60, offset: 0 }
      : { view: "all" as const, sort: "recent" as const, limit: 30, offset: 0 };

    searchEmojis(options)
      .then((result) => {
        if (cancelled || seq !== requestSeq.current) return;
        setItems(
          result.items.map((e) => ({
            id: e.id,
            name: e.name,
            path: e.path,
            extension: e.extension,
            width: e.width,
            height: e.height,
            sizeBytes: e.sizeBytes,
          })),
        );
      })
      .catch((reason) => {
        if (cancelled || seq !== requestSeq.current) return;
        setError(getErrorMessage(reason));
      })
      .finally(() => {
        if (cancelled || seq !== requestSeq.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      requestSeq.current++;
    };
  }, [debouncedQuery, activationId, reloadToken]);

  const resetQuery = useCallback(() => setQuery(""), []);

  return { query, setQuery, resetQuery, items, loading, error };
}
