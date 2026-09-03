/**
 * 更新弹窗的「今日不提醒」抑制（2026-09）。
 *
 * 启动静默检查发现新版本时若今天已被用户搁置，不再自动弹窗（手动
 * 「检查更新」不受影响——用户主动查的必须给看）。存储为本机日期键
 * （YYYY-MM-DD）：跨午夜自然失效，无需清理任务。走 localStorage
 * 独立键（`emobox.updateSnooze`，与 emobox.settings 同后端不同键——
 * 这是跨会话的临时抑制态，不是用户设置，不进 PersistedSettings）。
 */

const STORAGE_KEY = "emobox.updateSnooze";

/** 本地日期键（YYYY-MM-DD）。 */
function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 今天是否已被用户搁置（弹过并关掉过）。 */
export function isUpdateSnoozedToday(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === localDateKey();
  } catch {
    // localStorage 不可用：视为未搁置（最多多弹一次，不阻塞提醒）。
    return false;
  }
}

/** 搁置到今天结束：任何关闭弹窗的路径（按钮 / X / Esc）都调用。 */
export function snoozeUpdateForToday(): void {
  try {
    localStorage.setItem(STORAGE_KEY, localDateKey());
  } catch {
    // 写不进去就算了：退化为本次会话不弹（updateAvailable 已置 null）。
  }
}
