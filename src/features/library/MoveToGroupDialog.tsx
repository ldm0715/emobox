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
import { Add20Regular, Checkmark20Filled } from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import { getErrorMessage } from "../../lib/tauri";
import { pickerDialogStyles, type PickerDialogStyles } from "./pickerDialogStyles";

// 共享样式见 pickerDialogStyles.ts；此处只留 MoveToGroupDialog 独有的 actions 布局。
const pickerStyles: PickerDialogStyles & { actions: GriffelStyle } = {
  ...pickerDialogStyles,
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
};
const useStyles = makeStyles(pickerStyles);

interface GroupOption {
  id: number;
  name: string;
  count: number;
}

interface MoveToGroupDialogProps {
  open: boolean;
  emojiCount: number;
  existingGroups: GroupOption[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: {
    existingGroupIds: number[];
    newGroupName: string | null;
  }) => Promise<void>;
}

export function MoveToGroupDialog({
  open,
  emojiCount,
  existingGroups,
  busy = false,
  onOpenChange,
  onConfirm,
}: MoveToGroupDialogProps) {
  const styles = useStyles();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setNewName("");
      setError("");
    }
  }, [open]);

  const trimmedNew = newName.trim();
  const canSubmit = (selected.size > 0 || trimmedNew.length > 0) && !busy && !pending;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (prev.size === existingGroups.length) return new Set();
      return new Set(existingGroups.map((g) => g.id));
    });
  }

  const allSelected = useMemo(
    () => existingGroups.length > 0 && selected.size === existingGroups.length,
    [existingGroups.length, selected.size],
  );

  async function handleConfirm() {
    if (!canSubmit) return;
    setError("");
    setPending(true);
    try {
      await onConfirm({
        existingGroupIds: Array.from(selected),
        newGroupName: trimmedNew.length > 0 ? trimmedNew : null,
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
            action={
              pending ? <Spinner size="small" aria-label="处理中" /> : null
            }
          >
            加入分组
          </DialogTitle>
          <DialogContent className={styles.content}>
            <Body1 className={styles.subtitle}>
              {emojiCount > 1
                ? `为 ${emojiCount} 个表情选择目标分组`
                : "为 1 个表情选择目标分组"}
            </Body1>

            {existingGroups.length > 3 && (
              <div className={styles.selectAllRow}>
                <Button
                  size="small"
                  appearance="subtle"
                  onClick={toggleAll}
                  disabled={pending}
                >
                  {allSelected ? "全不选" : "全选"}
                </Button>
              </div>
            )}

            <div className={styles.listScroll}>
              {existingGroups.length === 0 ? (
                <div className={styles.listEmpty}>
                  还没有分组，先在下方创建一个
                </div>
              ) : (
                existingGroups.map((group) => (
                  <label key={group.id} className={styles.row}>
                    <Checkbox
                      checked={selected.has(group.id)}
                      onChange={() => toggle(group.id)}
                      label={group.name}
                      disabled={pending}
                    />
                    <span className={styles.count}>{group.count} 张</span>
                  </label>
                ))
              )}
            </div>

            <Divider />

            <div className={styles.inlineCreate}>
              <Input
                value={newName}
                onChange={(_, data) => setNewName(data.value)}
                placeholder="新分组名称（可选）"
                disabled={pending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) void handleConfirm();
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
                    existingGroupIds: Array.from(selected),
                    newGroupName: trimmedNew,
                  })
                    .then(() => onOpenChange(false))
                    .catch((e) => setError(getErrorMessage(e)))
                    .finally(() => setPending(false));
                }}
              >
                新建并加入
              </Button>
            </div>

            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}

            <div className={styles.actions}>
              <span className={styles.count}>
                <Checkmark20Filled
                  style={{ verticalAlign: "middle", marginRight: 4 }}
                />
                {selected.size > 0 || trimmedNew.length > 0
                  ? `将加入 ${selected.size} 个已有分组${
                      trimmedNew.length > 0 ? " + 1 个新分组" : ""
                    }`
                  : "请选择至少一个分组"}
              </span>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="subtle" disabled={pending}>取消</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={!canSubmit}
                onClick={() => void handleConfirm()}
              >
                加入分组
              </Button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
