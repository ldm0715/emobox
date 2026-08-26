import {
  Badge,
  Button,
  Menu,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
 shorthands,
} from "@fluentui/react-components";
import {
  Image20Regular,
  MoreHorizontal20Regular,
  Star20Filled,
  Star20Regular,
} from "@fluentui/react-icons";
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { IndexedImage } from "../../types";
import type { EmojiItemMenuMode } from "./EmojiItemMenu";
import { EmojiItemMenu } from "./EmojiItemMenu";
import { useThumbnail } from "./useThumbnail";

interface EmojiGridItemProps {
  item: IndexedImage;
  selected: boolean;
  favorite: boolean;
  thumbnailSize: number;
  menuMode?: EmojiItemMenuMode;
  tags?: string[];
  onSelect: (item: IndexedImage) => void;
  onToggleFavorite: (item: IndexedImage) => void;
  onCopy: (item: IndexedImage) => void;
  onMoveToGroup: (item: IndexedImage) => void;
  onRemoveFromGroup?: (item: IndexedImage) => void;
  onAddTags?: (item: IndexedImage) => void;
  onShowInExplorer: (item: IndexedImage) => void;
  onDelete: (item: IndexedImage) => void;
  onRestore?: (item: IndexedImage) => void;
  onPermanentlyDelete?: (item: IndexedImage) => void;
}

const useStyles = makeStyles({
  root: {
    position: "relative",
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground3, ...shorthands.border(tokens.strokeWidthThin, "solid", "transparent"),
    borderRadius: tokens.borderRadiusLarge,
    cursor: "default",
    transitionProperty: "background-color, border-color, box-shadow",
    transitionDuration: tokens.durationFaster,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
    ":hover .emoji-overlay": {
      opacity: 1,
    },
    ":hover .emoji-actions": {
      opacity: 1,
    },
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "2px",
    },
  },
  selected: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    boxShadow: `0 0 0 ${tokens.strokeWidthThin} ${tokens.colorBrandStroke1}`,
  },
  frame: {
    aspectRatio: "1 / 1",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    padding: tokens.spacingHorizontalS,
  },
  image: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase100,
  },
  gifBadge: {
    position: "absolute",
    top: tokens.spacingVerticalXS,
    left: tokens.spacingHorizontalXS,
    zIndex: 2,
  },
  actions: {
    position: "absolute",
    top: tokens.spacingVerticalXS,
    right: tokens.spacingHorizontalXS,
    zIndex: 3,
    display: "flex",
    gap: "2px",
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: tokens.durationFaster,
  },
  actionButton: {
    color: "white",
    backgroundColor: "rgba(24, 24, 27, 0.66)",
    ":hover": {
      color: "white",
      backgroundColor: "rgba(24, 24, 27, 0.82)",
    },
  },
  overlay: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    color: "white",
    backgroundColor: "rgba(24, 24, 27, 0.72)",
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: tokens.durationFaster,
    pointerEvents: "none",
  },
  overlayVisible: {
    opacity: 1,
  },
  fileName: {
    overflow: "hidden",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tagBar: {
    position: "absolute",
    right: tokens.spacingHorizontalXS,
    bottom: tokens.spacingVerticalXS,
    left: tokens.spacingHorizontalXS,
    zIndex: 2,
    display: "flex",
    flexWrap: "wrap",
    gap: "2px",
    pointerEvents: "none",
  },
  tagPill: {
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "white",
    backgroundColor: "rgba(24, 24, 27, 0.66)",
    fontSize: tokens.fontSizeBase100,
    padding: `0 ${tokens.spacingHorizontalXS}`,
  },
  tagMore: {
    color: "white",
    backgroundColor: "rgba(24, 24, 27, 0.66)",
    fontSize: tokens.fontSizeBase100,
    padding: `0 ${tokens.spacingHorizontalXS}`,
  },
});

export function EmojiGridItem({
  item,
  selected,
  favorite,
  thumbnailSize,
  menuMode = "default",
  tags = [],
  onSelect,
  onToggleFavorite,
  onCopy,
  onMoveToGroup,
  onRemoveFromGroup,
  onAddTags,
  onShowInExplorer,
  onDelete,
  onRestore,
  onPermanentlyDelete,
}: EmojiGridItemProps) {
  const styles = useStyles();
  const { source, failed } = useThumbnail(item.path, thumbnailSize);
  const [menuOpen, setMenuOpen] = useState(false);

  function stop(event: MouseEvent) {
    event.stopPropagation();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(item);
    }
  }

  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={selected}
      aria-label={item.name}
      className={mergeClasses(styles.root, selected && styles.selected)}
      onClick={() => onSelect(item)}
      onDoubleClick={() => onSelect(item)}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className={styles.frame}>
        {source ? (
          <img className={styles.image} src={source} alt={item.name} loading="lazy" />
        ) : (
          <div className={styles.placeholder}>
            <Image20Regular />
            <span>{failed ? "预览不可用" : "加载中"}</span>
          </div>
        )}
      </div>

      {item.extension === "gif" && <Badge className={styles.gifBadge} size="small" appearance="filled">GIF</Badge>}

      <div className={`${styles.actions} emoji-actions`} onClick={stop}>
        <Tooltip content={favorite ? "取消收藏" : "收藏"} relationship="label">
          <Button
            className={styles.actionButton}
            size="small"
            appearance="subtle"
            aria-label={favorite ? "取消收藏" : "收藏"}
            icon={favorite ? <Star20Filled /> : <Star20Regular />}
            onClick={() => onToggleFavorite(item)}
          />
        </Tooltip>
        <Menu open={menuOpen} onOpenChange={(_, data) => setMenuOpen(data.open)} positioning="below-end">
          <Tooltip content="更多操作" relationship="label">
            <MenuTrigger disableButtonEnhancement>
              <Button
                className={styles.actionButton}
                size="small"
                appearance="subtle"
                aria-label="更多操作"
                icon={<MoreHorizontal20Regular />}
              />
            </MenuTrigger>
          </Tooltip>
          <EmojiItemMenu
            mode={menuMode}
            favorite={favorite}
            onToggleFavorite={() => onToggleFavorite(item)}
            onCopy={() => onCopy(item)}
            onMoveToGroup={() => onMoveToGroup(item)}
            onRemoveFromGroup={onRemoveFromGroup ? () => onRemoveFromGroup(item) : undefined}
            onAddTags={onAddTags ? () => onAddTags(item) : () => {}}
            onShowInExplorer={() => onShowInExplorer(item)}
            onDelete={() => onDelete(item)}
            onRestore={onRestore ? () => onRestore(item) : undefined}
            onPermanentlyDelete={onPermanentlyDelete ? () => onPermanentlyDelete(item) : undefined}
          />
        </Menu>
      </div>

      <div className={mergeClasses(styles.overlay, "emoji-overlay", selected && styles.overlayVisible)}>
        <div className={styles.fileName} title={item.name}>{item.name}</div>
      </div>

      {tags.length > 0 && (
        <div className={styles.tagBar}>
          {tags.slice(0, 2).map((name) => (
            <span key={name} className={styles.tagPill} title={name}>
              {name}
            </span>
          ))}
          {tags.length > 2 && (
            <span className={styles.tagMore}>+{tags.length - 2}</span>
          )}
        </div>
      )}
    </div>
  );
}
