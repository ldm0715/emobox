import { describe, expect, it } from "vitest";

import {
  buildBatchFilenames,
  normalizeExtension,
  stripExtension,
  validateRenameStem,
} from "./batchRename";

describe("batchRename", () => {
  describe("stripExtension", () => {
    it("剥掉最后一个扩展名段", () => {
      expect(stripExtension("鲸鱼.abc123.png")).toBe("鲸鱼.abc123");
      expect(stripExtension("a.png")).toBe("a");
    });

    it("无扩展名原样返回", () => {
      expect(stripExtension("鲸鱼")).toBe("鲸鱼");
      expect(stripExtension("a.b")).toBe("a");
    });

    it("点文件不以点开头段作扩展名", () => {
      expect(stripExtension(".png")).toBe(".png");
      expect(stripExtension(".hidden")).toBe(".hidden");
    });
  });

  describe("normalizeExtension", () => {
    it("去前导点并转小写", () => {
      expect(normalizeExtension(".PNG")).toBe("png");
      expect(normalizeExtension("GIF")).toBe("gif");
      expect(normalizeExtension(" webp ")).toBe("webp");
      expect(normalizeExtension("")).toBe("");
    });
  });

  describe("validateRenameStem", () => {
    it("空名与空白报错", () => {
      expect(validateRenameStem("")).toBe("名称不能为空。");
      expect(validateRenameStem("   ")).toBe("名称不能为空。");
    });

    it("逐个拒绝 Windows 非法字符", () => {
      for (const ch of ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]) {
        expect(validateRenameStem(`a${ch}b`)).toContain(ch);
      }
    });

    it("拒绝控制字符", () => {
      expect(validateRenameStem(`a${String.fromCharCode(1)}b`)).toBe("名称不能包含控制字符。");
    });

    it("中文名与含空格名合法", () => {
      expect(validateRenameStem("鲸鱼")).toBeNull();
      expect(validateRenameStem("开心 表情 01")).toBeNull();
      expect(validateRenameStem("  trim后合法  ")).toBeNull();
    });

    it("超长名报错", () => {
      expect(validateRenameStem("a".repeat(256))).toContain("255");
    });
  });

  describe("buildBatchFilenames", () => {
    it("全部编号、无裸名项，从 1 开始", () => {
      expect(buildBatchFilenames("鲸鱼", ["png", "png", "png"])).toEqual([
        "鲸鱼1.png",
        "鲸鱼2.png",
        "鲸鱼3.png",
      ]);
    });

    it("各项保留自己的扩展名并规范化", () => {
      expect(buildBatchFilenames("cat", ["png", "GIF", ".webp"])).toEqual([
        "cat1.png",
        "cat2.gif",
        "cat3.webp",
      ]);
    });

    it("空扩展名不加点", () => {
      expect(buildBatchFilenames("x", ["", ""])).toEqual(["x1", "x2"]);
    });

    it("模板先 trim", () => {
      expect(buildBatchFilenames("  鲸鱼  ", ["png"])).toEqual(["鲸鱼1.png"]);
    });

    it("空列表返回空数组", () => {
      expect(buildBatchFilenames("鲸鱼", [])).toEqual([]);
    });
  });
});
