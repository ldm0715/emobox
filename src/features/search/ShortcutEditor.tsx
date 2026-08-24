import {
  Button,
  Input,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Keyboard20Regular, Save20Regular } from "@fluentui/react-icons";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  WINDOWS_SYSTEM_MENU_SHORTCUT,
  formatShortcutLabel,
  normalizeShortcutText,
  shortcutFromKeyboardEvent,
} from "../../config/shortcuts";

interface ShortcutEditorProps {
  shortcut: string;
  registered: boolean;
  registrationError: string;
  onApply: (shortcut: string) => Promise<string | null>;
}

const useStyles = makeStyles({
  root: {
    display: "grid",
    gap: tokens.spacingVerticalS,
  },
  controls: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    gap: tokens.spacingHorizontalS,
  },
  input: {
    minWidth: 0,
  },
  help: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
});

export function ShortcutEditor({
  shortcut,
  registered,
  registrationError,
  onApply,
}: ShortcutEditorProps) {
  const styles = useStyles();
  const [draft, setDraft] = useState(shortcut);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setDraft(shortcut);
  }, [shortcut]);

  const normalizedDraft = useMemo(() => normalizeShortcutText(draft), [draft]);
  const conflictsWithWindowsMenu = normalizedDraft.toLocaleLowerCase()
    === WINDOWS_SYSTEM_MENU_SHORTCUT.toLocaleLowerCase();
  const displayedError = localError || registrationError;

  function handleRecordKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setRecording(false);
      return;
    }

    const recorded = shortcutFromKeyboardEvent(event);
    if (!recorded) return;

    event.preventDefault();
    event.stopPropagation();
    setDraft(recorded);
    setLocalError("");
    setRecording(false);
  }

  async function applyShortcut() {
    if (!normalizedDraft) {
      setLocalError("请输入或录制一个快捷键组合。");
      return;
    }

    setSaving(true);
    setLocalError("");
    const error = await onApply(normalizedDraft);
    setSaving(false);
    if (error) setLocalError(error);
  }

  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <Input
          className={styles.input}
          aria-label="快速搜索全局快捷键"
          value={draft}
          placeholder="例如 Ctrl+Alt+Space"
          onChange={(_, data) => {
            setDraft(data.value);
            setLocalError("");
          }}
        />
        <Button
          icon={<Keyboard20Regular />}
          appearance={recording ? "primary" : "secondary"}
          onClick={() => setRecording(true)}
          onKeyDown={handleRecordKeyDown}
          onBlur={() => setRecording(false)}
        >
          {recording ? "请按组合键" : "录制"}
        </Button>
        <Button
          icon={<Save20Regular />}
          appearance="primary"
          disabled={saving || normalizedDraft === shortcut}
          onClick={() => void applyShortcut()}
        >
          {saving ? "注册中" : "应用"}
        </Button>
      </div>

      <div className={styles.help}>
        快捷键必须包含 Ctrl、Alt、Shift 或 Win。也可以直接编辑文本后应用。
      </div>

      {conflictsWithWindowsMenu && (
        <MessageBar intent="warning">
          <MessageBarBody>
            Alt + Space 是 Windows 系统窗口菜单快捷键，可能无法注册；建议使用 Ctrl + Alt + Space。
          </MessageBarBody>
        </MessageBar>
      )}

      {displayedError ? (
        <MessageBar intent="error">
          <MessageBarBody>{displayedError}</MessageBarBody>
        </MessageBar>
      ) : registered ? (
        <MessageBar intent="success">
          <MessageBarBody>已注册：{formatShortcutLabel(shortcut)}</MessageBarBody>
        </MessageBar>
      ) : (
        <MessageBar intent="warning">
          <MessageBarBody>全局快捷键尚未注册。</MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}
