import { describe, expect, it } from "vitest";

import type { TagOption } from "./tagPickerHelpers";
import {
  buildOcrNotice,
  canStageNewTagName,
  filterTagsByQuery,
  findExactTag,
  intersectTagIds,
  mergeOcrSelection,
  sortPopularTags,
} from "./tagPickerHelpers";

function tag(id: number, name: string, count = 0): TagOption {
  return { id, name, count };
}

describe("tagPickerHelpers", () => {
  describe("sortPopularTags", () => {
    it("按 count 降序，同数按名称升序", () => {
      const sorted = sortPopularTags([
        tag(1, "猫", 3),
        tag(2, "dog", 9),
        tag(3, "bird", 3),
        tag(4, "Ant", 3),
      ]);
      expect(sorted.map((t) => t.id)).toEqual([2, 4, 3, 1]);
    });

    it("不修改入参数组", () => {
      const input = [tag(1, "a", 1), tag(2, "b", 5)];
      sortPopularTags(input);
      expect(input.map((t) => t.id)).toEqual([1, 2]);
    });
  });

  describe("filterTagsByQuery", () => {
    const tags = [tag(1, "猫猫"), tag(2, "Cute Cat"), tag(3, "小狗"), tag(4, "_cat_")];

    it("空查询返回空结果", () => {
      expect(filterTagsByQuery(tags, "")).toEqual({ items: [], hiddenCount: 0 });
      expect(filterTagsByQuery(tags, "   ")).toEqual({ items: [], hiddenCount: 0 });
    });

    it("NOCASE 子串匹配", () => {
      expect(filterTagsByQuery(tags, "cat").items.map((t) => t.id)).toEqual([2, 4]);
      expect(filterTagsByQuery(tags, "CUTE").items.map((t) => t.id)).toEqual([2]);
    });

    it("超过上限时计数截掉的数量", () => {
      const many = Array.from({ length: 55 }, (_, i) => tag(i + 1, `标签${i}`));
      const result = filterTagsByQuery(many, "标签");
      expect(result.items).toHaveLength(50);
      expect(result.hiddenCount).toBe(5);
    });
  });

  describe("findExactTag", () => {
    const tags = [tag(1, "Cat"), tag(2, "猫")];

    it("NOCASE 精确匹配", () => {
      expect(findExactTag(tags, "cat")?.id).toBe(1);
      expect(findExactTag(tags, "  猫 ")?.id).toBe(2);
      expect(findExactTag(tags, "ca")).toBeUndefined();
      expect(findExactTag(tags, "")).toBeUndefined();
    });
  });

  describe("canStageNewTagName", () => {
    const tags = [tag(1, "Cat")];

    it("拒绝空名与已有标签（NOCASE）", () => {
      expect(canStageNewTagName([], tags, "  ")).toBe(false);
      expect(canStageNewTagName([], tags, "cat")).toBe(false);
      expect(canStageNewTagName([], tags, "CAT")).toBe(false);
    });

    it("拒绝与已暂存新名重复（NOCASE）", () => {
      expect(canStageNewTagName(["dog"], tags, "DOG")).toBe(false);
      expect(canStageNewTagName(["dog"], tags, "bird")).toBe(true);
    });
  });

  describe("mergeOcrSelection", () => {
    it("单表情：识别出的新标签并入选中集", () => {
      const merged = mergeOcrSelection(new Set([1]), [1, 2, 3], [1]);
      expect([...merged].sort()).toEqual([1, 2, 3]);
    });

    it("多表情：只并入交集", () => {
      // 两张图分别有 2/4/5 与 3/4/5，交集 = {4,5}。
      const merged = mergeOcrSelection(new Set<number>(), [4, 5], []);
      expect([...merged].sort()).toEqual([4, 5]);
    });

    it("不复活用户已手动反选的标签", () => {
      // initial = {1,2}，用户反选了 1；OCR 交集又包含 1 → 不并回。
      const merged = mergeOcrSelection(new Set([2]), [1, 2], [1, 2]);
      expect([...merged].sort()).toEqual([2]);
    });

    it("保留用户在识别期间勾选的标签", () => {
      // 用户识别前勾了 9；OCR 交集不含 9 → 9 仍在。
      const merged = mergeOcrSelection(new Set([9]), [4], []);
      expect([...merged].sort()).toEqual([4, 9]);
    });
  });

  describe("intersectTagIds", () => {
    it("空输入返回空", () => {
      expect(intersectTagIds([])).toEqual([]);
    });

    it("取所有表情 tagIds 的交集", () => {
      expect(
        intersectTagIds([{ tagIds: [1, 2, 3] }, { tagIds: [2, 3, 5] }, { tagIds: [3, 2] }]),
      ).toEqual([2, 3]);
    });

    it("某个表情没有任何标签时交集为空", () => {
      expect(intersectTagIds([{ tagIds: [1] }, { tagIds: [] }])).toEqual([]);
    });
  });

  describe("buildOcrNotice", () => {
    it("全部成功且提取到标签 → 不提示（chips 即反馈）", () => {
      expect(
        buildOcrNotice({ processed: 2, total: 2, tagged: 2, empty: 0, failed: 0 }, "windows"),
      ).toBeNull();
    });

    it("识别成功但无文字 → info 提示，Windows 引擎附切换 AI Studio 建议", () => {
      const notice = buildOcrNotice(
        { processed: 2, total: 2, tagged: 0, empty: 2, failed: 0 },
        "windows",
      );
      expect(notice?.intent).toBe("info");
      expect(notice?.text).toContain("未从图片中识别出可用的文字");
      expect(notice?.text).toContain("AI Studio");

      const cloud = buildOcrNotice(
        { processed: 1, total: 1, tagged: 0, empty: 1, failed: 0 },
        "aiStudio",
      );
      expect(cloud?.intent).toBe("info");
      expect(cloud?.text).not.toContain("AI Studio");
    });

    it("Tesseract 无文字 → 附检查语言包建议，不提 AI Studio", () => {
      const notice = buildOcrNotice(
        { processed: 2, total: 2, tagged: 0, empty: 2, failed: 0 },
        "tesseract",
      );
      expect(notice?.intent).toBe("info");
      expect(notice?.text).toContain("chi_sim");
      expect(notice?.text).toContain("语言数据");
      expect(notice?.text).not.toContain("AI Studio");
    });

    it("全部失败 → error 提示", () => {
      const notice = buildOcrNotice(
        { processed: 2, total: 2, tagged: 0, empty: 0, failed: 2 },
        "windows",
      );
      expect(notice?.intent).toBe("error");
      expect(notice?.text).toContain("识别失败");
      expect(notice?.text).toContain("2/2");
    });

    it("部分失败 → warning 汇总各计数", () => {
      const notice = buildOcrNotice(
        { processed: 3, total: 3, tagged: 1, empty: 1, failed: 1 },
        "windows",
      );
      expect(notice?.intent).toBe("warning");
      expect(notice?.text).toContain("1 张提取到标签");
      expect(notice?.text).toContain("1 张未识别出文字");
      expect(notice?.text).toContain("1 张失败");
    });

    it("云端中止（processed < total）→ warning 提示中止", () => {
      const notice = buildOcrNotice(
        { processed: 2, total: 5, tagged: 2, empty: 0, failed: 0 },
        "aiStudio",
      );
      expect(notice?.intent).toBe("warning");
      expect(notice?.text).toContain("中止于 2/5");
    });

    it("processed 为 0（如首行即云端中止）→ warning 提示未开始", () => {
      const notice = buildOcrNotice(
        { processed: 0, total: 2, tagged: 0, empty: 0, failed: 0 },
        "windows",
      );
      expect(notice?.intent).toBe("warning");
      expect(notice?.text).toContain("未能开始识别");
    });
  });
});
