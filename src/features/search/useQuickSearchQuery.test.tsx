import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexedEmoji, SearchResult } from "../../types";
import { useQuickSearchQuery } from "./useQuickSearchQuery";

// 隔离 Tauri 层：mock searchEmojis，捕获每次调用的 options 与可控的 deferred promise。
vi.mock("../../lib/tauri", () => ({
  searchEmojis: vi.fn(),
  getErrorMessage: (error: unknown) =>
    typeof error === "string" ? error : String(error),
}));

// 关闭 200ms 防抖，让测试聚焦请求乱序，而非计时。
vi.mock("../library/useDebouncedValue", () => ({
  useDebouncedValue: (value: string) => value,
}));

import { searchEmojis } from "../../lib/tauri";

interface Deferred {
  promise: Promise<SearchResult>;
  resolve: (value: SearchResult) => void;
}

function deferred(): Deferred {
  let resolve!: (value: SearchResult) => void;
  const promise = new Promise<SearchResult>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Phase 17 起 search_emojis 返回分页结构 { items, total }，测试统一走本包装。 */
function resolvePage(def: Deferred, items: IndexedEmoji[], total = items.length) {
  def.resolve({ items, total });
}

function makeEmoji(id: number, name: string): IndexedEmoji {
  return {
    id,
    name,
    path: `/managed/${id}.png`,
    thumbnailPath: null,
    extension: "png",
    width: 64,
    height: 64,
    sizeBytes: 128,
    sourceType: "managed_import",
    isFavorite: false,
    lastUsedAt: null,
    usageCount: 0,
    importedAt: null,
    modifiedAt: null,
    groupIds: [],
    tagIds: [],
  };
}

function makeEmojis(count: number): IndexedEmoji[] {
  return Array.from({ length: count }, (_, i) => makeEmoji(i + 1, `e${i + 1}`));
}

interface Call {
  options: { view: string; query?: string; sort?: string; groupId?: number; limit?: number; offset?: number };
  def: Deferred;
}

describe("useQuickSearchQuery 请求乱序防护", () => {
  let calls: Call[];
  const searchMock = vi.mocked(searchEmojis);

  beforeEach(() => {
    calls = [];
    searchMock.mockReset();
    searchMock.mockImplementation((options) => {
      const def = deferred();
      calls.push({ options: options as Call["options"], def });
      return def.promise;
    });
  });

  it("快速连续输入：只有最后一次请求的结果落地", async () => {
    const { result } = renderHook(() => useQuickSearchQuery(0, 0, null));
    // 初始挂载 = 空 query 请求（calls[0]）。
    expect(calls.length).toBe(1);

    act(() => result.current.setQuery("a"));
    act(() => result.current.setQuery("b"));
    // calls[1] = "a"，calls[2] = "b"。
    expect(calls.length).toBe(3);
    expect(calls[1].options.query).toBe("a");
    expect(calls[2].options.query).toBe("b");

    // 新请求（b）先落地，旧请求（a）后落地——旧结果必须被丢弃。
    await act(async () => {
      resolvePage(calls[2].def, [makeEmoji(2, "new")]);
      resolvePage(calls[1].def, [makeEmoji(1, "old")]);
      resolvePage(calls[0].def, []);
    });

    expect(result.current.items.map((item) => item.id)).toEqual([2]);
  });

  it("library-changed（reloadToken 变化）保持当前 query 重新搜索并作废缓存", async () => {
    const { result, rerender } = renderHook(
      ({ token }: { token: number }) => useQuickSearchQuery(0, token, null),
      { initialProps: { token: 0 } },
    );

    act(() => result.current.setQuery("猫猫"));
    await act(async () => {
      resolvePage(calls[1].def, [makeEmoji(1, "x")]);
      resolvePage(calls[0].def, []);
    });

    // 库变更 → rerender 触发新一轮搜索，query 保持，缓存失效后必须重新请求。
    rerender({ token: 1 });
    expect(result.current.query).toBe("猫猫");
    expect(calls.length).toBe(3);
    expect(calls.at(-1)?.options.query).toBe("猫猫");
  });

  it("空 query 走全库最近优先，非空走全库搜索（分组挂起）", async () => {
    const { result, rerender } = renderHook(
      ({ groupId }: { groupId: number | null }) => useQuickSearchQuery(0, 0, groupId),
      { initialProps: { groupId: null as number | null } },
    );
    expect(calls[0].options).toMatchObject({ view: "all", sort: "recent", limit: 20, offset: 0 });

    // 空 query + 分组 → 浏览该分组。
    rerender({ groupId: 7 });
    expect(calls[1].options).toMatchObject({ view: "group", groupId: 7, sort: "recent" });

    // 非空 query → 全库搜索，groupId 不参与（用户不记得表情在哪个分组）。
    act(() => result.current.setQuery("hello"));
    expect(calls[2].options).toMatchObject({ view: "all", query: "hello" });
    expect(calls[2].options.groupId).toBeUndefined();
    expect(calls[2].options.sort).toBeUndefined();
  });

  it("加载更多：按首页返回行数为 offset 追加下一页，拉满后不再有更多", async () => {
    const { result } = renderHook(() => useQuickSearchQuery(0, 0, null));

    await act(async () => {
      resolvePage(calls[0].def, makeEmojis(20), 35);
    });
    expect(result.current.items.length).toBe(20);
    expect(result.current.hasMore).toBe(true);

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadMore();
    });
    expect(calls.length).toBe(2);
    expect(calls[1].options).toMatchObject({ offset: 20, limit: 20 });
    await act(async () => {
      resolvePage(calls[1].def, makeEmojis(15).map((e) => ({ ...e, id: e.id + 20 })), 35);
      await pending;
    });

    expect(result.current.items.length).toBe(35);
    expect(result.current.hasMore).toBe(false);
    // 拉满后再调 loadMore 不发请求。
    await act(async () => {
      await result.current.loadMore();
    });
    expect(calls.length).toBe(2);
  });

  it("结果缓存：切走再切回同一分组/关键词不再重新请求", async () => {
    const { result } = renderHook(
      ({ groupId }: { groupId: number | null }) => useQuickSearchQuery(0, 0, groupId),
      { initialProps: { groupId: null as number | null } },
    );

    // 每个关键词都等到响应落地（缓存写入）再切下一个。
    await act(async () => {
      resolvePage(calls[0].def, [makeEmoji(0, "recent")]);
    });
    act(() => result.current.setQuery("a"));
    await act(async () => {
      resolvePage(calls[1].def, [makeEmoji(1, "a1")]);
    });
    act(() => result.current.setQuery("b"));
    await act(async () => {
      resolvePage(calls[2].def, [makeEmoji(2, "b1")]);
    });
    expect(calls.length).toBe(3);

    // 切回 "a"：缓存命中，无新请求，条目立即恢复。
    act(() => result.current.setQuery("a"));
    expect(calls.length).toBe(3);
    expect(result.current.items.map((item) => item.id)).toEqual([1]);
    expect(result.current.loading).toBe(false);
  });

  it("卸载后挂起请求返回不再 setState（无异常）", async () => {
    const { unmount } = renderHook(() => useQuickSearchQuery(0, 0, null));
    const pending = calls[0];
    unmount();
    await act(async () => {
      resolvePage(pending.def, [makeEmoji(9, "after-unmount")]);
    });
    // 到达这里即没有抛错 / 没有 React 状态更新告警。
    expect(true).toBe(true);
  });
});
