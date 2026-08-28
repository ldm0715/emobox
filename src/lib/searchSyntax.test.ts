import { describe, expect, it } from "vitest";
import type { NamedRow } from "./searchSyntax";
import { filterItemsByQuery, parseExactQuery } from "./searchSyntax";

interface TestItem {
  id: number;
  name: string;
  groupIds: number[];
  tagIds: number[];
}

const groups: NamedRow[] = [
  { id: 1, name: "猫猫" },
  { id: 2, name: "狗狗" },
];

const tags: NamedRow[] = [
  { id: 10, name: "开心.png" },
  { id: 11, name: "难过.png" },
];

const items: TestItem[] = [
  { id: 1, name: "开心.png", groupIds: [1], tagIds: [10] },
  { id: 2, name: "难过.png", groupIds: [1], tagIds: [11] },
  { id: 3, name: "汪汪.png", groupIds: [2], tagIds: [10] },
];

describe("parseExactQuery", () => {
  it("`*` 与全角 `＊` 都能解析", () => {
    expect(parseExactQuery("猫猫*开心")).toEqual({ group: "猫猫", tag: "开心" });
    expect(parseExactQuery("猫猫＊开心")).toEqual({ group: "猫猫", tag: "开心" });
  });

  it("`:` 保留为别名", () => {
    expect(parseExactQuery("猫猫:开心")).toEqual({ group: "猫猫", tag: "开心" });
    expect(parseExactQuery("猫猫：开心")).toEqual({ group: "猫猫", tag: "开心" });
  });

  it("只有组名 / 只有标签 / 无分隔符", () => {
    expect(parseExactQuery("猫猫*")).toEqual({ group: "猫猫", tag: null });
    expect(parseExactQuery("*开心")).toEqual({ group: null, tag: "开心" });
    expect(parseExactQuery("开心")).toBeNull();
  });

  it("两侧都空 → null", () => {
    expect(parseExactQuery("*")).toBeNull();
  });
});

describe("filterItemsByQuery", () => {
  it("精确：组精确 + 标签精确", () => {
    const result = filterItemsByQuery(items, "猫猫*开心.png", groups, tags);
    expect(result.map((it) => it.id)).toEqual([1]);
  });

  it("宽松回退：标签只输 stem（存的是带扩展名）", () => {
    const result = filterItemsByQuery(items, "猫猫*开心", groups, tags);
    expect(result.map((it) => it.id)).toEqual([1]);
  });

  it("仅组名 / 仅标签", () => {
    expect(filterItemsByQuery(items, "猫猫*", groups, tags).map((it) => it.id)).toEqual([1, 2]);
    expect(filterItemsByQuery(items, "*开心.png", groups, tags).map((it) => it.id)).toEqual([1, 3]);
  });

  it("无分隔符 → 普通整串子串", () => {
    expect(filterItemsByQuery(items, "汪汪", groups, tags).map((it) => it.id)).toEqual([3]);
    expect(filterItemsByQuery(items, "", groups, tags).length).toBe(3);
  });

  it("组不存在 → 精确落空 → 普通子串兜底", () => {
    const result = filterItemsByQuery(items, "不存在*开心", groups, tags);
    expect(result).toEqual([]);
  });

  it("模糊组名：未归组包按文件名+标签命中", () => {
    const fuzzItems: TestItem[] = [
      { id: 1, name: "[2233绘梦酱_吹哨子].png", groupIds: [], tagIds: [100] },
      { id: 2, name: "别包.png", groupIds: [], tagIds: [100] },
    ];
    const fuzzTags: NamedRow[] = [{ id: 100, name: "来吗" }];
    const result = filterItemsByQuery(fuzzItems, "2233*来吗", [], fuzzTags);
    expect(result.map((it) => it.id)).toEqual([1]);
  });

  it("模糊组名：仅组名部分命中文件名", () => {
    const fuzzItems: TestItem[] = [
      { id: 1, name: "[2233绘梦酱_A].png", groupIds: [], tagIds: [] },
      { id: 2, name: "[2233绘梦酱_B].png", groupIds: [], tagIds: [] },
      { id: 3, name: "其他.png", groupIds: [], tagIds: [] },
    ];
    const result = filterItemsByQuery(fuzzItems, "2233*", [], []);
    expect(result.map((it) => it.id)).toEqual([1, 2]);
  });
});
