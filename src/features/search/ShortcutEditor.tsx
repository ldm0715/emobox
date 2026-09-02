import {
  Button,
  Input,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { FadeSnappy } from "@fluentui/react-motion-components-preview";
import { CheckmarkCircle20Regular, Keyboard20Regular, Save20Regular } from "@fluentui/react-icons";
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
  ariaLabel?: string;
  placeholder?: string;
}

const useStyles = makeStyles({
  root: {
    display: "grid",
    // MessageBar 单行模式 nowrap，auto 轨道会被长错误文案的 min-content 撑开、
    // 令其 reflow 多行检测失效并溢出容器；钉死轨道宽度让 reflow 正常切多行。
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: tokens.spacingVerticalM,
  },
  controls: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    gap: tokens.spacingHorizontalS,
  },
  input: {
    minWidth: 0,
  },
  // 成功态不占大块：带成功图标的紧凑状态行（错误/警告仍用 MessageBar）。
  statusLine: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    "& svg": {
      color: tokens.colorPaletteGreenForeground1,
    },
  },
});

export function ShortcutEditor({
  shortcut,
  registered,
  registrationError,
  onApply,
  ariaLabel = "全局快捷键",
  placeholder = "例如 Ctrl+Alt+Space",
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
          aria-label={ariaLabel}
          value={draft}
          placeholder={placeholder}
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

      {conflictsWithWindowsMenu && (
        <FadeSnappy visible appear>
          <MessageBar intent="warning">
            <MessageBarBody>
              Alt + Space 是 Windows 系统窗口菜单快捷键，可能无法注册；建议使用 Ctrl + Alt + Space。
            </MessageBarBody>
          </MessageBar>
        </FadeSnappy>
      )}

      {displayedError ? (
        <FadeSnappy visible appear>
          <MessageBar intent="error">
            <MessageBarBody>{displayedError}</MessageBarBody>
          </MessageBar>
        </FadeSnappy>
      ) : registered ? (
        <FadeSnappy visible appear>
          <div className={styles.statusLine}>
            <CheckmarkCircle20Regular />
            <span>已注册：{formatShortcutLabel(shortcut)}</span>
          </div>
        </FadeSnappy>
      ) : (
        <FadeSnappy visible appear>
          <MessageBar intent="warning">
            <MessageBarBody>全局快捷键尚未注册。</MessageBarBody>
          </MessageBar>
        </FadeSnappy>
      )}
    </div>
  );
}
