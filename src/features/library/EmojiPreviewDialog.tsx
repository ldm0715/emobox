import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  Copy20Regular,
  DataUsage20Regular,
  Dismiss20Regular,
  FolderOpen20Regular,
  Image20Regular,
  Star20Filled,
  Star20Regular,
  Tag20Regular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { emojiAssetUrl } from "../../lib/tauri";
import type { IndexedImage } from "../../types";

interface EmojiPreviewDialogProps {
  open: boolean;
  item: IndexedImage | null;
  favorite: boolean;
  /** 所属分组名（App 由 indexedById.groupIds + groups 解析）。 */
  groupNames: string[];
  /** 标签名（App 由 indexedById.tagIds + tagById 解析）。 */
  tagNames: string[];
  /** 只读模式（回收站）：隐藏 收藏/复制 操作，只保留查看与关闭。 */
  readOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  onCopy: (item: IndexedImage) => void;
  onToggleFavorite: (item: IndexedImage) => void;
}

const useStyles = makeStyles({
  // DialogSurface 默认是 inset:0 + margin:auto 的固定定位块，宽度会撑到 max-width
  // 而非贴合内容；width: fit-content 才能让弹窗收缩到实际内容大小。
  surface: {
    width: "fit-content",
    maxWidth: "min(94vw, 960px)",
    maxHeight: "92vh",
  },
  body: {
    display: "flex",
    flexDirection: "row",
    alignItems: "stretch",
    columnGap: tokens.spacingHorizontalXL,
  },
  // 左：图片区，高度撑满弹窗，图按比例缩放（不产生留白框）。
  imageArea: {
    display: "grid",
    placeItems: "center",
    minWidth: 0,
  },
  image: {
    display: "block",
    width: "auto",
    height: "auto",
    maxWidth: "min(56vw, 640px)",
    maxHeight: "68vh",
  },
  placeholder: {
    display: "grid",
    placeItems: "center",
    minWidth: "280px",
    minHeight: "200px",
    color: tokens.colorNeutralForeground3,
  },
  // 右：信息面板，固定窄列。
  info: {
    display: "flex",
    flexDirection: "column",
    width: "232px",
    minWidth: "232px",
    paddingBottom: tokens.spacingVerticalS,
  },
  title: {
    padding: 0,
    paddingRight: tokens.spacingHorizontalXS,
  },
  titleText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
  },
  row: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  rowIcon: {
    display: "flex",
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
  },
  chip: {
    // 覆盖 Badge 的 inline-flex 为 block，文本截断才生效（同 EmojiGridItem.tagBadge）。
    display: "block",
    minWidth: 0,
    maxWidth: "180px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    marginTop: "auto",
    paddingTop: tokens.spacingVerticalS,
  },
});

export function EmojiPreviewDialog({
  open,
  item,
  favorite,
  groupNames,
  tagNames,
  readOnly = false,
  onOpenChange,
  onCopy,
  onToggleFavorite,
}: EmojiPreviewDialogProps) {
  const styles = useStyles();
  const [failed, setFailed] = useState(false);

  // 换项/重开时重置失败标记（与 useGifPreview 同思路）。
  useEffect(() => {
    if (open) setFailed(false);
  }, [open, item?.path]);

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)} modalType="modal">
      <DialogSurface className={styles.surface}>
        <DialogBody className={styles.body}>
          <div className={styles.imageArea}>
            {failed ? (
              <div className={styles.placeholder}>预览不可用</div>
            ) : (
              // asset URL 对 GIF 即动图，img 直接播放。
              <img
                className={styles.image}
                src={emojiAssetUrl(item.path)}
                alt={item.name}
                onError={() => setFailed(true)}
              />
            )}
          </div>

          <div className={styles.info}>
            <DialogTitle className={styles.title}>
              <span className={styles.titleText} title={item.name}>{item.name}</span>
            </DialogTitle>

            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowIcon}><Image20Regular /></span>
                <span>{item.width} × {item.height} · {item.extension.toUpperCase()}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon}><DataUsage20Regular /></span>
                <span>{Math.max(1, Math.round(item.sizeBytes / 1024))} KB</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon}><FolderOpen20Regular /></span>
                {groupNames.length > 0 ? (
                  <div className={styles.chips}>
                    {groupNames.map((name) => (
                      <Badge key={name} size="small" appearance="outline" className={styles.chip} title={name}>{name}</Badge>
                    ))}
                  </div>
                ) : (
                  <span className={styles.empty}>未分组</span>
                )}
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon}><Tag20Regular /></span>
                {tagNames.length > 0 ? (
                  <div className={styles.chips}>
                    {tagNames.map((name) => (
                      <Badge key={name} size="small" appearance="outline" className={styles.chip} title={name}>{name}</Badge>
                    ))}
                  </div>
                ) : (
                  <span className={styles.empty}>暂无标签</span>
                )}
              </div>
            </div>

            <DialogActions className={styles.actions}>
              {!readOnly && (
                <>
                  <Button
                    icon={favorite ? <Star20Filled /> : <Star20Regular />}
                    onClick={() => onToggleFavorite(item)}
                  >
                    {favorite ? "取消收藏" : "收藏"}
                  </Button>
                  <Button icon={<Copy20Regular />} onClick={() => onCopy(item)}>
                    复制
                  </Button>
                </>
              )}
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="subtle" icon={<Dismiss20Regular />}>
                  关闭
                </Button>
              </DialogTrigger>
            </DialogActions>
          </div>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
