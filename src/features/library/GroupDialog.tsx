import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Input,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Folder24Regular } from "@fluentui/react-icons";
import { FadeSnappy } from "@fluentui/react-motion-components-preview";
import { useEffect, useState } from "react";
import { getErrorMessage } from "../../lib/tauri";
import { POPULAR_GROUP_ICONS, findGroupIconEntry } from "./groupIcons";

const useStyles = makeStyles({
  surface: {
    width: "min(420px, calc(100vw - 48px))",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalS,
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  iconLabel: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  iconRow: {
    // 固定 9 列网格：默认项 + 18 个常用图标 = 恰好两整行，不随窗口宽度错行。
    display: "grid",
    gridTemplateColumns: "repeat(9, 1fr)",
    columnGap: tokens.spacingHorizontalXS,
    rowGap: tokens.spacingHorizontalXS,
  },
  iconOption: {
    width: "100%",
    height: "36px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    color: tokens.colorNeutralForeground2,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  iconOptionSelected: {
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
  },
});

interface GroupDialogProps {
  open: boolean;
  mode: "create" | "rename";
  initialName?: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, icon: string | null) => Promise<void>;
}

export function GroupDialog({
  open,
  mode,
  initialName = "",
  busy = false,
  onOpenChange,
  onSubmit,
}: GroupDialogProps) {
  const styles = useStyles();
  const [name, setName] = useState(initialName);
  // 新建时的分组图标；null = 默认文件夹。重命名模式不展示图标行。
  const [icon, setIcon] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(initialName);
      setIcon(null);
      setError("");
    }
  }, [open, initialName]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      await onSubmit(trimmed, icon);
      onOpenChange(false);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => onOpenChange(data.open)}
      modalType="modal"
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{mode === "create" ? "新建分组" : "重命名分组"}</DialogTitle>
          <DialogContent className={styles.content}>
            <Input
              value={name}
              onChange={(_, data) => setName(data.value)}
              placeholder="分组名称"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
            />
            {mode === "create" && (
              <div>
                <span className={styles.iconLabel}>图标（可选，创建后可随时更改）</span>
                <div className={styles.iconRow}>
                  <button
                    type="button"
                    aria-label="默认文件夹图标"
                    aria-pressed={icon === null}
                    title="默认"
                    disabled={busy}
                    className={mergeClasses(
                      styles.iconOption,
                      icon === null && styles.iconOptionSelected,
                    )}
                    onClick={() => setIcon(null)}
                  >
                    <Folder24Regular />
                  </button>
                  {POPULAR_GROUP_ICONS.map((iconName) => {
                    const entry = findGroupIconEntry(iconName);
                    if (!entry) return null;
                    const IconComponent = entry.component;
                    const selected = icon === iconName;
                    return (
                      <button
                        type="button"
                        key={iconName}
                        aria-label={entry.label}
                        aria-pressed={selected}
                        title={entry.label}
                        disabled={busy}
                        className={mergeClasses(
                          styles.iconOption,
                          selected && styles.iconOptionSelected,
                        )}
                        onClick={() => setIcon(iconName)}
                      >
                        <IconComponent />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {error && (
              <FadeSnappy visible appear>
                <span className={styles.error}>{error}</span>
              </FadeSnappy>
            )}
            <div className={styles.actions}>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="subtle" disabled={busy}>取消</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
              >
                {mode === "create" ? "创建" : "保存"}
              </Button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
