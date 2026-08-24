export const DEFAULT_QUICK_SEARCH_SHORTCUT = "Ctrl+Alt+Space";
export const WINDOWS_SYSTEM_MENU_SHORTCUT = "Alt+Space";

interface ShortcutKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  code: string;
  key: string;
}

const ignoredKeys = new Set(["Alt", "Control", "Meta", "Shift"]);

export function formatShortcutLabel(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" + ");
}

export function normalizeShortcutText(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("+");
}

export function shortcutFromKeyboardEvent(event: ShortcutKeyboardEvent): string | null {
  if (ignoredKeys.has(event.key)) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Win");
  if (modifiers.length === 0) return null;

  const key = shortcutKeyFromEvent(event);
  return key ? [...modifiers, key].join("+") : null;
}

function shortcutKeyFromEvent(event: ShortcutKeyboardEvent): string | null {
  if (event.code === "Space") return "Space";
  if (event.code.startsWith("Key")) return event.code.slice(3).toUpperCase();
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key.toUpperCase();

  const namedKeys: Record<string, string> = {
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    ArrowUp: "ArrowUp",
    Backspace: "Backspace",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Home: "Home",
    Insert: "Insert",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Tab: "Tab",
  };

  return namedKeys[event.key] ?? null;
}
