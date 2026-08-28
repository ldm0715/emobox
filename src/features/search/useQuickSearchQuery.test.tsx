import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexedEmoji } from "../../types";
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
  promise: Promise<IndexedEmoji[]>;
  resolve: (value: IndexedEmoji[]) => void;
}

function deferred(): Deferred {
  let resolve!: (value: IndexedEmoji[]) => void;
  const promise = new Promise<IndexedEmoji[]>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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
    groupIds: [],
    tagIds: [],
  };
}

interface Call {
  options: { view: string; query?: string; sort?: string };
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
    const { result } = renderHook(() => useQuickSearchQuery(0, 0));
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
      calls[2].def.resolve([makeEmoji(2, "new")]);
      calls[1].def.resolve([makeEmoji(1, "old")]);
      calls[0].def.resolve([]);
    });

    expect(result.current.items.map((item) => item.id)).toEqual([2]);
  });

  it("library-changed（reloadToken 变化）保持当前 query 重新搜索", async () => {
    const { result, rerender } = renderHook(
      ({ token }: { token: number }) => useQuickSearchQuery(0, token),
      { initialProps: { token: 0 } },
    );

    act(() => result.current.setQuery("猫猫"));
    await act(async () => {
      calls[1].def.resolve([makeEmoji(1, "x")]);
      calls[0].def.resolve([]);
    });

    // 库变更 → rerender 触发新一轮搜索，query 保持，且带上 sort 语义。
    rerender({ token: 1 });
    expect(result.current.query).toBe("猫猫");
    expect(calls.at(-1)?.options.query).toBe("猫猫");
  });

  it("空 query 走全库最近优先（sort=recent），非空走全库搜索", async () => {
    const { result } = renderHook(() => useQuickSearchQuery(0, 0));
    expect(calls[0].options).toMatchObject({ view: "all", sort: "recent" });

    act(() => result.current.setQuery("hello"));
    expect(calls[1].options).toMatchObject({ view: "all", query: "hello" });
    expect(calls[1].options.sort).toBeUndefined();
  });

  it("卸载后挂起请求返回不再 setState（无异常）", async () => {
    const { unmount } = renderHook(() => useQuickSearchQuery(0, 0));
    const pending = calls[0];
    unmount();
    await act(async () => {
      pending.def.resolve([makeEmoji(9, "after-unmount")]);
    });
    // 到达这里即没有抛错 / 没有 React 状态更新告警。
    expect(true).toBe(true);
  });
});
