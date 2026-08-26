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
  tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { getErrorMessage } from "../../lib/tauri";

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
});

interface GroupDialogProps {
  open: boolean;
  mode: "create" | "rename";
  initialName?: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
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
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(initialName);
      setError("");
    }
  }, [open, initialName]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      await onSubmit(trimmed);
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
            {error && <span className={styles.error}>{error}</span>}
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
