import { afterEach, describe, expect, it } from "vitest";
import {
  isUpdateSnoozedToday,
  snoozeUpdateForToday,
} from "./updateSnooze";

const STORAGE_KEY = "emobox.updateSnooze";

describe("updateSnooze", () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("未搁置时返回 false", () => {
    expect(isUpdateSnoozedToday()).toBe(false);
  });

  it("搁置后当日返回 true（存储值是本地日期键）", () => {
    snoozeUpdateForToday();
    expect(isUpdateSnoozedToday()).toBe(true);
    // 存储的就是今天的 YYYY-MM-DD（带补零），不是时间戳。
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    expect(localStorage.getItem(STORAGE_KEY)).toBe(key);
  });

  it("旧日期（昨天）不算已搁置——跨午夜自动恢复提醒", () => {
    localStorage.setItem(STORAGE_KEY, "2000-01-01");
    expect(isUpdateSnoozedToday()).toBe(false);
  });

  it("非法存储值不算已搁置", () => {
    localStorage.setItem(STORAGE_KEY, "garbage");
    expect(isUpdateSnoozedToday()).toBe(false);
  });
});
