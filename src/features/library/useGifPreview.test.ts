import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGifPreview, isGifExtension } from "./useGifPreview";

// 隔离 Tauri 层：mock emojiAssetUrl，让断言聚焦 URL 生成时机与失败兜底。
vi.mock("../../lib/tauri", () => ({
  emojiAssetUrl: vi.fn((path: string) => `asset://mock/${path}`),
}));

import { emojiAssetUrl } from "../../lib/tauri";

const assetUrlMock = vi.mocked(emojiAssetUrl);

function makeItem(extension: string, path = "/managed/a.gif") {
  return { path, extension };
}

describe("isGifExtension", () => {
  it("大小写不敏感识别 gif", () => {
    expect(isGifExtension("gif")).toBe(true);
    expect(isGifExtension("GIF")).toBe(true);
    expect(isGifExtension(" GiF ")).toBe(true);
    expect(isGifExtension("png")).toBe(false);
    expect(isGifExtension("")).toBe(false);
  });
});

describe("useGifPreview", () => {
  beforeEach(() => {
    assetUrlMock.mockClear();
  });

  it("非 GIF 或未激活时返回 null（回落静态缩略图）", () => {
    const gif = renderHook(() => useGifPreview(makeItem("gif"), false));
    expect(gif.result.current.gifSrc).toBeNull();

    const png = renderHook(() => useGifPreview(makeItem("png"), true));
    expect(png.result.current.gifSrc).toBeNull();
    expect(assetUrlMock).not.toHaveBeenCalled();
  });

  it("激活的 GIF 返回 asset URL", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useGifPreview(makeItem("gif"), active),
      { initialProps: { active: false } },
    );

    expect(result.current.gifSrc).toBeNull();

    rerender({ active: true });
    expect(result.current.gifSrc).toBe("asset://mock//managed/a.gif");
    expect(assetUrlMock).toHaveBeenCalledWith("/managed/a.gif");
  });

  it("加载失败后回落静态且本实例内不再重试", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useGifPreview(makeItem("gif"), active),
      { initialProps: { active: true } },
    );
    expect(result.current.gifSrc).not.toBeNull();

    act(() => result.current.handleGifError());
    expect(result.current.gifSrc).toBeNull();

    // 重新激活也不重试。
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.gifSrc).toBeNull();
  });

  it("path 变化时重置失败标记", () => {
    const { result, rerender } = renderHook(
      ({ item }) => useGifPreview(item, true),
      { initialProps: { item: makeItem("gif", "/managed/a.gif") } },
    );

    act(() => result.current.handleGifError());
    expect(result.current.gifSrc).toBeNull();

    // path 变化重置失败标记（rerender 自带 act，effect 同步 flush）。
    rerender({ item: makeItem("gif", "/managed/b.gif") });
    expect(result.current.gifSrc).toBe("asset://mock//managed/b.gif");
  });
});
