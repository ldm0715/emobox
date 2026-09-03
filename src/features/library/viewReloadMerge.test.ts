import { describe, expect, it } from "vitest";

import type { IndexedEmoji } from "../../types";

import { mergeReloadedItems } from "./viewReloadMerge";

function emoji(id: number, overrides: Partial<IndexedEmoji> = {}): IndexedEmoji {
  return {
    id,
    name: `emoji-${id}.png`,
    path: `assets/emojis/${id}.png`,
    thumbnailPath: `assets/thumbs/${id}.png`,
    extension: "png",
    width: 512,
    height: 512,
    sizeBytes: 1024,
    sourceType: "managed_import",
    isFavorite: false,
    lastUsedAt: null,
    usageCount: 0,
    importedAt: 1,
    modifiedAt: 1,
    groupIds: [],
    tagIds: [],
    ...overrides,
  };
}

describe("mergeReloadedItems", () => {
  it("空 previous 直接返回 incoming", () => {
    const incoming = [emoji(1), emoji(2)];
    expect(mergeReloadedItems([], incoming)).toBe(incoming);
  });

  it("保序：沿用 previous 的顺序，不按 incoming 重排", () => {
    const previous = [emoji(3), emoji(1), emoji(2)];
    const incoming = [emoji(1), emoji(2), emoji(3)];
    const merged = mergeReloadedItems(previous, incoming);
    expect(merged.map((item) => item.id)).toEqual([3, 1, 2]);
  });

  it("身份复用：显示相关字段相等时返回旧对象引用", () => {
    const oldItem = emoji(7, { tagIds: [1, 2] });
    // incoming 是后端全新对象（modifiedAt 已被 touch，但显示字段不变）
    const freshItem = emoji(7, { tagIds: [1, 2], modifiedAt: 999 });
    const merged = mergeReloadedItems([oldItem], [freshItem]);
    expect(merged[0]).toBe(oldItem);
  });

  it("替换：name 变化时取 incoming 对象", () => {
    const oldItem = emoji(7);
    const freshItem = emoji(7, { name: "renamed.png" });
    const merged = mergeReloadedItems([oldItem], [freshItem]);
    expect(merged[0]).toBe(freshItem);
  });

  it("替换：isFavorite 变化时取 incoming 对象", () => {
    const oldItem = emoji(7);
    const freshItem = emoji(7, { isFavorite: true });
    const merged = mergeReloadedItems([oldItem], [freshItem]);
    expect(merged[0]).toBe(freshItem);
  });

  it("替换：tagIds 长度/内容变化时取 incoming 对象", () => {
    const oldItem = emoji(7, { tagIds: [1] });
    const mergedA = mergeReloadedItems([oldItem], [emoji(7, { tagIds: [1, 2] })]);
    expect(mergedA[0].tagIds).toEqual([1, 2]);
    const mergedB = mergeReloadedItems([oldItem], [emoji(7, { tagIds: [2] })]);
    expect(mergedB[0].tagIds).toEqual([2]);
  });

  it("丢弃：previous 有、incoming 无的 id 被移除", () => {
    const previous = [emoji(1), emoji(2), emoji(3)];
    const incoming = [emoji(1), emoji(3)];
    const merged = mergeReloadedItems(previous, incoming);
    expect(merged.map((item) => item.id)).toEqual([1, 3]);
  });

  it("追加：incoming 新 id 追加在尾部（保序段之后）", () => {
    const previous = [emoji(2), emoji(1)];
    const incoming = [emoji(1), emoji(2), emoji(4), emoji(5)];
    const merged = mergeReloadedItems(previous, incoming);
    expect(merged.map((item) => item.id)).toEqual([2, 1, 4, 5]);
  });

  it("混合：保序段保留旧引用、变化项替换、消失项丢弃、新项追加", () => {
    const unchanged = emoji(1, { tagIds: [10] });
    const changed = emoji(2, { tagIds: [10] });
    const removed = emoji(3);
    const previous = [unchanged, changed, removed];
    const incoming = [
      emoji(1, { tagIds: [10] }),
      emoji(2, { tagIds: [10, 11] }),
      emoji(9),
    ];
    const merged = mergeReloadedItems(previous, incoming);
    expect(merged.map((item) => item.id)).toEqual([1, 2, 9]);
    expect(merged[0]).toBe(unchanged);
    expect(merged[1]).not.toBe(changed);
    expect(merged[1].tagIds).toEqual([10, 11]);
  });
});
