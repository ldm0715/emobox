import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectImageFromClipboard,
  importManagedPaths,
  type ClipboardCollectOutcome,
} from "../../lib/tauri";
import type { ManagedImportSummary } from "../../types";
import { useLibraryImport } from "./useLibraryImport";

// 隔离 Tauri 层：导入命令一律换成可控的 mock；plugin-dialog 仅被 importFolder
// 顶层引用，这里不测选框路径，mock 掉保证模块可干净加载。
vi.mock("../../lib/tauri", () => ({
  collectImageFromClipboard: vi.fn(),
  importFolder: vi.fn(),
  importManagedPaths: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const collectOutcome: ClipboardCollectOutcome = {
  kind: "unavailable",
  reason: "test",
  message: "test",
};

function makeSummary(successCount = 1): ManagedImportSummary {
  return {
    successCount,
    exactDuplicateCount: 0,
    perceptualDuplicateCount: 0,
    failedCount: 0,
    elapsedMs: 8,
    items: [],
    failures: [],
    perceptualDuplicates: [],
  };
}

// 600ms：加载条最短可见时长（IMPORT_INDICATOR_MIN_VISIBLE_MS），熄灭前的余晖期。
describe("useLibraryImport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it("collectFromClipboard 在命令在途时点亮加载条，结束后保持 600ms 再熄灭", async () => {
    const def = deferred<ClipboardCollectOutcome>();
    vi.mocked(collectImageFromClipboard).mockReturnValue(def.promise);
    const { result } = renderHook(() => useLibraryImport(vi.fn()));

    let invocation: Promise<ClipboardCollectOutcome | null> = Promise.resolve(null);
    await act(async () => {
      invocation = result.current.collectFromClipboard();
    });
    expect(result.current.isImporting).toBe(true);

    await act(async () => {
      def.resolve(collectOutcome);
      await invocation;
    });
    // 结束但未满最短可见时长：短导入不能一闪而过。
    expect(result.current.isImporting).toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.isImporting).toBe(false);
  });

  it("importPaths 同样点亮加载条并延迟熄灭", async () => {
    const def = deferred<ManagedImportSummary>();
    vi.mocked(importManagedPaths).mockReturnValue(def.promise);
    const { result } = renderHook(() => useLibraryImport(vi.fn()));

    let invocation: Promise<ManagedImportSummary | null> = Promise.resolve(null);
    await act(async () => {
      invocation = result.current.importPaths(["C:/a.png", "C:/b.png"]);
    });
    expect(result.current.isImporting).toBe(true);

    await act(async () => {
      def.resolve(makeSummary(2));
      await invocation;
    });
    expect(result.current.isImporting).toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.isImporting).toBe(false);
  });

  it("命令失败时仍经 finally 熄灭加载条，并把错误交给 onError", async () => {
    vi.mocked(collectImageFromClipboard).mockRejectedValue("剪贴板中没有图片");
    const onError = vi.fn();
    const { result } = renderHook(() => useLibraryImport(onError));

    await act(async () => {
      await result.current.collectFromClipboard();
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.isImporting).toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.isImporting).toBe(false);
  });

  it("并发导入按计数托管：最后一个结束才开始计时熄灭", async () => {
    const first = deferred<ClipboardCollectOutcome>();
    const second = deferred<ClipboardCollectOutcome>();
    vi.mocked(collectImageFromClipboard)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useLibraryImport(vi.fn()));

    let firstRun: Promise<ClipboardCollectOutcome | null> = Promise.resolve(null);
    let secondRun: Promise<ClipboardCollectOutcome | null> = Promise.resolve(null);
    await act(async () => {
      firstRun = result.current.collectFromClipboard();
      secondRun = result.current.collectFromClipboard();
    });
    expect(result.current.isImporting).toBe(true);

    await act(async () => {
      first.resolve(collectOutcome);
      await firstRun;
    });
    // 第一个已结束，但第二个仍在途：加载条不能被提前藏掉。
    expect(result.current.isImporting).toBe(true);

    await act(async () => {
      second.resolve(collectOutcome);
      await secondRun;
    });
    expect(result.current.isImporting).toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.isImporting).toBe(false);
  });
});
