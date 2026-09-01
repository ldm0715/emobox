import {
  Body1,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Divider,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  makeStyles,
  tokens,
  type GriffelStyle,
} from "@fluentui/react-components";
import { Add20Regular } from "@fluentui/react-icons";
import { FadeSnappy } from "@fluentui/react-motion-components-preview";
import { useEffect, useMemo, useState } from "react";
import { getErrorMessage } from "../../lib/tauri";
import { pickerDialogStyles, type PickerDialogStyles } from "./pickerDialogStyles";

// 共享样式见 pickerDialogStyles.ts；此处只留 TagPickerDialog 独有的
// actions（左摘要右按钮）与 summary。
const pickerStyles: PickerDialogStyles & {
  actions: GriffelStyle;
  rightActions: GriffelStyle;
  summary: GriffelStyle;
} = {
  ...pickerDialogStyles,
  actions: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  rightActions: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
  },
  summary: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
};
const useStyles = makeStyles(pickerStyles);

interface TagOption {
  id: number;
  name: string;
  count: number;
}

interface TagPickerDialogProps {
  open: boolean;
  emojiCount: number;
  existingTags: TagOption[];
  initiallySelectedTagIds: number[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: {
    addedTagIds: number[];
    removedTagIds: number[];
    newTagName: string | null;
  }) => Promise<void>;
}

export function TagPickerDialog({
  open,
  emojiCount,
  existingTags,
  initiallySelectedTagIds,
  busy = false,
  onOpenChange,
  onConfirm,
}: TagPickerDialogProps) {
  const styles = useStyles();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // 常挂载弹窗：open 时快照 payload（关闭瞬间 App 置 null，退场动画期间计数不闪 0）。
  const [shownCount, setShownCount] = useState(emojiCount);

  useEffect(() => {
    if (open) {
      setShownCount(emojiCount);
      setSelected(new Set(initiallySelectedTagIds));
      setNewName("");
      setError("");
    }
  }, [open, emojiCount, initiallySelectedTagIds]);

  const trimmedNew = newName.trim();
  const canSubmit = !busy && !pending;

  // 计算 added/removed：相对 initialSelected
  const initial = useMemo(() => new Set(initiallySelectedTagIds), [initiallySelectedTagIds]);
  const addedTagIds = useMemo(
    () => Array.from(selected).filter((id) => !initial.has(id)),
    [selected, initial],
  );
  const removedTagIds = useMemo(
    () => initial.size === 0
      ? []
      : Array.from(initial).filter((id) => !selected.has(id)),
    [initial, selected],
  );
  const hasChanges = addedTagIds.length > 0 || removedTagIds.length > 0 || trimmedNew.length > 0;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    if (!canSubmit) return;
    setError("");
    setPending(true);
    try {
      await onConfirm({
        addedTagIds,
        removedTagIds,
        newTagName: trimmedNew.length > 0 ? trimmedNew : null,
      });
      onOpenChange(false);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!pending) onOpenChange(data.open);
      }}
      modalType="modal"
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle
            action={pending ? <Spinner size="small" aria-label="处理中" /> : null}
          >
            管理标签
          </DialogTitle>
          <DialogContent className={styles.content}>
            <Body1 className={styles.subtitle}>
              {shownCount > 1
                ? `为 ${shownCount} 个表情选择标签`
                : "为 1 个表情选择标签"}
            </Body1>

            {existingTags.length > 3 && (
              <div className={styles.selectAllRow}>
                <Button
                  size="small"
                  appearance="subtle"
                  onClick={() => {
                    setSelected((prev) =>
                      prev.size === existingTags.length ? new Set() : new Set(existingTags.map((t) => t.id)),
                    );
                  }}
                  disabled={pending}
                >
                  {selected.size === existingTags.length ? "全不选" : "全选"}
                </Button>
              </div>
            )}

            <div className={styles.listScroll}>
              {existingTags.length === 0 ? (
                <div className={styles.listEmpty}>
                  还没有标签，先在下方创建一个
                </div>
              ) : (
                existingTags.map((tag) => (
                  <label key={tag.id} className={styles.row}>
                    <Checkbox
                      checked={selected.has(tag.id)}
                      onChange={() => toggle(tag.id)}
                      label={tag.name}
                      disabled={pending}
                    />
                    <span className={styles.count}>{tag.count} 张</span>
                  </label>
                ))
              )}
            </div>

            <Divider />

            <div className={styles.inlineCreate}>
              <Input
                value={newName}
                onChange={(_, data) => setNewName(data.value)}
                placeholder="新标签名称（可选）"
                disabled={pending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && hasChanges && canSubmit) void handleConfirm();
                }}
              />
              <Button
                appearance="secondary"
                icon={<Add20Regular />}
                disabled={trimmedNew.length === 0 || pending}
                onClick={() => {
                  if (trimmedNew.length === 0) return;
                  setError("");
                  setPending(true);
                  onConfirm({
                    addedTagIds,
                    removedTagIds,
                    newTagName: trimmedNew,
                  })
                    .then(() => onOpenChange(false))
                    .catch((e) => setError(getErrorMessage(e)))
                    .finally(() => setPending(false));
                }}
              >
                新建并应用
              </Button>
            </div>

            {error && (
              <FadeSnappy visible appear>
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              </FadeSnappy>
            )}

            <div className={styles.actions}>
              <span className={styles.summary}>
                {addedTagIds.length + removedTagIds.length > 0 || trimmedNew.length > 0
                  ? `+${addedTagIds.length + (trimmedNew.length > 0 ? 1 : 0)} / -${removedTagIds.length}`
                  : "未做修改"}
              </span>
              <div className={styles.rightActions}>
                <DialogTrigger disableButtonEnhancement>
                  <Button appearance="subtle" disabled={pending}>取消</Button>
                </DialogTrigger>
                <Button
                  appearance="primary"
                  disabled={!canSubmit || !hasChanges}
                  onClick={() => void handleConfirm()}
                >
                  保存标签
                </Button>
              </div>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
