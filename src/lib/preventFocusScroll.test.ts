import { describe, expect, it } from "vitest";
import { resolveFocusOptions } from "./preventFocusScroll";

describe("resolveFocusOptions", () => {
  it("没传 options 时补上 preventScroll: true", () => {
    expect(resolveFocusOptions()).toEqual({ preventScroll: true });
  });

  it("传了 options 但没表态 preventScroll 时补 true（tabster 就是这种形态：focus({ preventScroll: undefined })）", () => {
    expect(resolveFocusOptions({})).toEqual({ preventScroll: true });
    expect(resolveFocusOptions({ preventScroll: undefined })).toEqual({ preventScroll: true });
  });

  it("显式 preventScroll: false 原样放行——这是「就是要滚动到它」的逃生口", () => {
    expect(resolveFocusOptions({ preventScroll: false })).toEqual({ preventScroll: false });
  });

  it("显式 preventScroll: true 保持不变", () => {
    expect(resolveFocusOptions({ preventScroll: true })).toEqual({ preventScroll: true });
  });

  it("保留 options 上的其它字段（如 focusVisible）", () => {
    const options = { focusVisible: true } as FocusOptions;
    expect(resolveFocusOptions(options)).toEqual({ focusVisible: true, preventScroll: true });
  });
});
