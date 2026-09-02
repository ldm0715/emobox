import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";

const useStyles = makeStyles({
  // 与 ConfirmDialog 同范式：420px 窄面、alert 模态、消息行 FG2 base300。
  surface: {
    width: "min(420px, calc(100vw - 48px))",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  message: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase400,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalS,
  },
});

export type CloseChoice = "tray" | "exit";

interface CloseActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 用户点了任一选择按钮。remember = 勾选了「记住」，由调用方写回设置项。 */
  onDecide: (choice: CloseChoice, remember: boolean) => void;
}

/** 关闭主窗口时的询问弹窗（Phase 25）。Esc / 点击遮罩 = 取消，不做任何动作。 */
export function CloseActionDialog({ open, onOpenChange, onDecide }: CloseActionDialogProps) {
  const styles = useStyles();
  const [remember, setRemember] = useState(false);

  // 常挂载 + open 控制：每次打开重置勾选，避免读到上一次的状态。
  useEffect(() => {
    if (open) setRemember(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)} modalType="alert">
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>关闭 EmoBox</DialogTitle>
          <DialogContent className={styles.content}>
            <span className={styles.message}>要最小化到系统托盘还是直接退出？</span>
            <Checkbox
              checked={remember}
              onChange={(_, data) => setRemember(data.checked === true)}
              label="记住我的选择，下次不再询问"
            />
            <div className={styles.actions}>
              {/* primary = 直接退出：贴合「默认关闭即退出」的产品语义；托盘是次要选项。 */}
              <Button appearance="primary" onClick={() => onDecide("exit", remember)}>
                直接退出
              </Button>
              <Button appearance="secondary" onClick={() => onDecide("tray", remember)}>
                最小化到托盘
              </Button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
