import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage, searchEmojis } from "../../lib/tauri";
import type { IndexedEmoji, IndexedImage, SearchOptions } from "../../types";
import { useDebouncedValue } from "../library/useDebouncedValue";

/** 每页拉取条数：默认只加载 20 张，「加载更多」逐页追加。 */
const PAGE_SIZE = 20;

interface CacheEntry {
  items: IndexedImage[];
  total: number;
  /** 下一页 offset（按服务端返回行数前进）；null = 没有更多。 */
  nextOffset: number | null;
}

function cacheKey(groupId: number | null, trimmedQuery: string): string {
  return `${groupId ?? "all"}::${trimmedQuery}`;
}

/** 与主窗口搜索完全一致的全库搜索；分组仅在无关键词的浏览态生效。 */
function buildOptions(
  trimmedQuery: string,
  groupId: number | null,
  offset: number,
): SearchOptions {
  if (trimmedQuery) {
    return { view: "all", query: trimmedQuery, limit: PAGE_SIZE, offset };
  }
  if (groupId !== null) {
    return { view: "group", groupId, sort: "recent", limit: PAGE_SIZE, offset };
  }
  return { view: "all", sort: "recent", limit: PAGE_SIZE, offset };
}

function toIndexedImage(emoji: IndexedEmoji): IndexedImage {
  return {
    id: emoji.id,
    name: emoji.name,
    path: emoji.path,
    extension: emoji.extension,
    width: emoji.width,
    height: emoji.height,
    sizeBytes: emoji.sizeBytes,
  };
}

/**
 * 浮层搜索编排（分页 + 结果缓存）：
 * - 非空 query → 全库搜索（`组*标签` 精确语法，与主窗口同一后端路径），分组筛选挂起；
 * - 空 query + 分组 → 浏览该分组（`view: "group"`，最近优先）；
 * - 空 query + 全部 → 全库最近优先（`sort: "recent"`，未用过的新图也可见）。
 *
 * 每页 20 条，「加载更多」按 offset 追加。结果按 key（分组 + 关键词）缓存在
 * ref Map 里，切换分组/关键词再切回不重拉首页；缓存跨 activationId 存活，
 * 但 library-changed（reloadToken 变化）整体失效。
 *
 * **requestSeq 守卫**：`query` / `groupId` / `activationId` / `reloadToken`
 * 触发的旧请求返回后一律丢弃，`loadMore` 的在途响应同样受 seq 比对保护
 * （key 切换时 effect 递增 seq 作废它）；cleanup 在卸载或依赖变化时递增序号，
 * 防止过期 setState。
 */
export function useQuickSearchQuery(
  activationId: number,
  reloadToken: number,
  groupId: number | null,
) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const [items, setItems] = useState<IndexedImage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);
  const cacheRef = useRef(new Map<string, CacheEntry>());
  const lastReloadToken = useRef(reloadToken);

  useEffect(() => {
    let cancelled = false;
    const seq = ++requestSeq.current;
    setLoadingMore(false);

    // library-changed：所有库数据变更命令都会递增 reloadToken，缓存整体作废。
    if (reloadToken !== lastReloadToken.current) {
      lastReloadToken.current = reloadToken;
      cacheRef.current.clear();
    }

    const trimmed = debouncedQuery.trim();
    const key = cacheKey(groupId, trimmed);
    const cached = cacheRef.current.get(key);
    if (cached) {
      // 缓存命中：直接落地，不发请求（分组/关键词来回切不重拉首页）。
      setItems(cached.items);
      setTotal(cached.total);
      setError("");
      setLoading(false);
      return () => {
        cancelled = true;
        requestSeq.current++;
      };
    }

    setLoading(true);
    setError("");

    searchEmojis(buildOptions(trimmed, groupId, 0))
      .then((result) => {
        if (cancelled || seq !== requestSeq.current) return;
        const projected = result.items.map(toIndexedImage);
        setItems(projected);
        setTotal(result.total);
        cacheRef.current.set(key, {
          items: projected,
          total: result.total,
          // offset 按服务端返回行数前进（Phase 17 教训：本地去重会让
          // items.length 与 offset 错位）；没拉满一页或已到 total 即无更多。
          nextOffset:
            projected.length > 0 && projected.length < result.total
              ? projected.length
              : null,
        });
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
  }, [debouncedQuery, groupId, activationId, reloadToken]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore) return;
    const trimmed = debouncedQuery.trim();
    const key = cacheKey(groupId, trimmed);
    const entry = cacheRef.current.get(key);
    if (!entry || entry.nextOffset === null || entry.items.length >= entry.total) {
      return;
    }

    // 快照当前 seq：key 切换（effect 重跑/清理）会递增 seq，在途响应按此作废。
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const result = await searchEmojis(
        buildOptions(trimmed, groupId, entry.nextOffset),
      );
      if (seq !== requestSeq.current) return;
      const seen = new Set(entry.items.map((item) => item.id));
      const appended = result.items
        .map(toIndexedImage)
        .filter((item) => !seen.has(item.id));
      const merged = [...entry.items, ...appended];
      setItems(merged);
      setTotal(result.total);
      cacheRef.current.set(key, {
        items: merged,
        total: result.total,
        nextOffset:
          appended.length > 0 && merged.length < result.total
            ? entry.nextOffset + result.items.length
            : null,
      });
    } catch (reason) {
      if (seq !== requestSeq.current) return;
      setError(getErrorMessage(reason));
    } finally {
      // 无守卫恢复：即使响应被作废也要解锁，否则按钮永久 disabled。
      setLoadingMore(false);
    }
  }, [loading, loadingMore, debouncedQuery, groupId]);

  const resetQuery = useCallback(() => setQuery(""), []);

  return {
    query,
    setQuery,
    resetQuery,
    items,
    total,
    loading,
    loadingMore,
    error,
    loadMore,
    hasMore: items.length < total,
  };
}
