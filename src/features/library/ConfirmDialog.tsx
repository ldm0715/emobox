import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";

const useStyles = makeStyles({
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
    whiteSpace: "pre-line",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalS,
  },
  // Fluent v9 Button 无 danger appearance，destructive 确认按钮用红色 token 覆盖
  //（palette 红没有 Hover/Pressed 变体，保持静态红底即可）。
  confirmDestructive: {
    color: tokens.colorPaletteRedForegroundInverted,
    backgroundColor: tokens.colorPaletteRedBackground2,
  },
});

interface ConfirmDialogProps {
  open: boolean;
  /** 标题栏文字。 */
  title: string;
  /** 正文（支持 \n 换行）。 */
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（彻底删除等）：确认按钮渲染为红色。 */
  destructive?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/** 确认弹窗（Fluent Dialog，替代原生 window.confirm —— 原生框不跟随应用主题）。 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确定",
  cancelText = "取消",
  destructive = false,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  const styles = useStyles();
  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => onOpenChange(data.open)}
      modalType="alert"
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent className={styles.content}>
            <span className={styles.message}>{message}</span>
            <div className={styles.actions}>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="subtle">{cancelText}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                className={mergeClasses(destructive && styles.confirmDestructive)}
                onClick={onConfirm}
              >
                {confirmText}
              </Button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
