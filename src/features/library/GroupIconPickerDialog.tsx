import {
  Body1,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  MessageBar,
  MessageBarBody,
  SearchBox,
  Spinner,
  makeStyles,
  tokens,
  type SearchBoxChangeEvent,
} from "@fluentui/react-components";
import { Folder20Regular } from "@fluentui/react-icons";
import { FadeSnappy } from "@fluentui/react-motion-components-preview";
import { useEffect, useState } from "react";
import { getErrorMessage } from "../../lib/tauri";
import { searchGroupIcons } from "./groupIcons";

const useStyles = makeStyles({
  surface: {
    width: "min(480px, calc(100vw - 48px))",
    maxHeight: "min(640px, calc(100vh - 48px))",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
  },
  listScroll: {
    // DialogContent 已有 overflowY:auto（Phase 12 坑），这里只约束高度。
    maxHeight: "360px",
    minHeight: "80px",
    overflowY: "auto",
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    padding: tokens.spacingVerticalS,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  listEmpty: {
    padding: `${tokens.spacingVerticalL} 0`,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  categoryLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    paddingLeft: tokens.spacingHorizontalXXS,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))",
    gap: tokens.spacingHorizontalXS,
  },
  iconButton: {
    minWidth: 0,
    height: "44px",
    justifyContent: "center",
    color: tokens.colorNeutralForeground2,
  },
  iconButtonSelected: {
    color: tokens.colorBrandForeground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalS,
  },
});

interface GroupIconPickerDialogProps {
  open: boolean;
  groupName: string;
  currentIcon: string | null;
  onOpenChange: (open: boolean) => void;
  /** 选中图标即触发；null = 恢复默认文件夹。 */
  onSelect: (icon: string | null) => Promise<void>;
}

export function GroupIconPickerDialog({
  open,
  groupName,
  currentIcon,
  onOpenChange,
  onSelect,
}: GroupIconPickerDialogProps) {
  const styles = useStyles();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // 常挂载弹窗：open 时把 payload props 快照进本地 state。关闭瞬间 App 会把
  // iconPickerGroup 置 null（props 闪回退值），快照保证 ~300ms 退场动画期间
  // 标题与选中高亮不闪空。
  const [shown, setShown] = useState({ groupName, currentIcon });

  useEffect(() => {
    if (open) {
      setShown({ groupName, currentIcon });
      setQuery("");
      setError("");
    }
  }, [open, groupName, currentIcon]);

  const categories = searchGroupIcons(query);

  async function select(icon: string | null) {
    if (pending) return;
    setError("");
    setPending(true);
    try {
      await onSelect(icon);
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
          <DialogTitle action={pending ? <Spinner size="small" aria-label="处理中" /> : null}>
            更改分组图标
          </DialogTitle>
          <DialogContent className={styles.content}>
            <Body1 className={styles.subtitle}>为「{shown.groupName}」选择侧栏图标</Body1>

            <SearchBox
              size="small"
              aria-label="搜索图标"
              placeholder="搜索图标（中文或英文）"
              value={query}
              disabled={pending}
              onChange={(_: SearchBoxChangeEvent, data: { value: string }) => setQuery(data.value)}
            />

            <div className={styles.listScroll}>
              {categories.length === 0 ? (
                <div className={styles.listEmpty}>没有匹配的图标</div>
              ) : (
                categories.map((category) => (
                  <div key={category.label}>
                    <div className={styles.categoryLabel}>{category.label}</div>
                    <div className={styles.grid}>
                      {category.icons.map((icon) => {
                        const IconComponent = icon.component;
                        const selected = shown.currentIcon === icon.name;
                        return (
                          <Button
                            key={icon.name}
                            size="small"
                            appearance={selected ? "secondary" : "subtle"}
                            className={
                              selected ? `${styles.iconButton} ${styles.iconButtonSelected}` : styles.iconButton
                            }
                            aria-label={icon.label}
                            title={icon.label}
                            icon={<IconComponent />}
                            disabled={pending}
                            onClick={() => void select(icon.name)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {error && (
              <FadeSnappy visible appear>
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              </FadeSnappy>
            )}

            <div className={styles.actions}>
              <Button
                appearance="subtle"
                icon={<Folder20Regular />}
                disabled={pending || shown.currentIcon === null}
                onClick={() => void select(null)}
              >
                恢复默认
              </Button>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="subtle" disabled={pending}>
                  取消
                </Button>
              </DialogTrigger>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
