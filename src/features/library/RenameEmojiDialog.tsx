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
import { FadeSnappy } from "@fluentui/react-motion-components-preview";
import { useEffect, useState } from "react";
import { getErrorMessage } from "../../lib/tauri";
import { normalizeExtension, stripExtension, validateRenameStem } from "./batchRename";

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
  hint: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
});

interface RenameEmojiDialogProps {
  open: boolean;
  /** single = 单张重命名（输入主名，扩展名自动保留）；
   *  batch = 批量模板编号（模板1、模板2…按当前排序）。 */
  mode: "single" | "batch";
  /** single：当前完整文件名（open 键控快照源，含扩展名）。 */
  emojiName?: string;
  /** single：原扩展名（提示文案用，如 `png`）。 */
  extension?: string;
  /** batch：选中项数量（按钮/提示文案用）。 */
  batchCount?: number;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  /** single = 去掉扩展名的主名；batch = 模板名。都不含扩展名。 */
  onSubmit: (name: string) => Promise<void>;
}

export function RenameEmojiDialog({
  open,
  mode,
  emojiName = "",
  extension = "",
  batchCount = 0,
  busy = false,
  onOpenChange,
  onSubmit,
}: RenameEmojiDialogProps) {
  const styles = useStyles();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  // open 键控快照（GroupDialog 模板）：open 变 true 时写入初始值，
  // 防止退场动画期间 props 闪回退值。
  useEffect(() => {
    if (open) {
      setName(mode === "single" ? stripExtension(emojiName) : "");
      setError("");
    }
  }, [open, mode, emojiName]);

  const trimmed = name.trim();
  const validationError = trimmed.length > 0 ? validateRenameStem(trimmed) : null;
  const canSubmit = trimmed.length > 0 && !validationError && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  const single = mode === "single";
  const normalizedExt = normalizeExtension(extension);
  const template = trimmed || "模板";

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)} modalType="modal">
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{single ? "重命名" : "批量重命名"}</DialogTitle>
          <DialogContent className={styles.content}>
            <Input
              value={name}
              onChange={(_, data) => setName(data.value)}
              placeholder={single ? "名称" : "模板名称"}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
            />
            <span className={styles.hint}>
              {single
                ? normalizedExt
                  ? `扩展名 .${normalizedExt} 将自动保留`
                  : "将按输入名称重命名"
                : `将按当前排序依次命名为 ${template}1、${template}2…（各保留原扩展名）`}
            </span>
            {(error || validationError) && (
              <FadeSnappy visible appear key={error || validationError || undefined}>
                <span className={styles.error}>{error || validationError}</span>
              </FadeSnappy>
            )}
            <div className={styles.actions}>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="subtle" disabled={busy}>
                  取消
                </Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
              >
                {single ? "保存" : batchCount > 0 ? `重命名 ${batchCount} 项` : "重命名"}
              </Button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
