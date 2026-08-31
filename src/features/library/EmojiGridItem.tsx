import {
  Badge,
  Button,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  shorthands,
} from "@fluentui/react-components";
import {
  CheckboxChecked20Regular,
  CheckboxUnchecked20Regular,
  Image20Regular,
  MoreHorizontal20Regular,
  Star20Filled,
  Star20Regular,
} from "@fluentui/react-icons";
import { type KeyboardEvent, type MouseEvent, useState } from "react";
import type { IndexedImage } from "../../types";
import type { SelectionMode } from "./useMultiSelection";
import { useThumbnail } from "./useThumbnail";
import { isGifExtension, useGifPreview } from "./useGifPreview";

interface EmojiGridItemProps {
  item: IndexedImage;
  selected: boolean;
  favorite: boolean;
  thumbnailSize: number;
  multiSelectMode: boolean;
  tags?: string[];
  onItemSelect: (item: IndexedImage, mode: SelectionMode) => void;
  onToggleFavorite: (items: IndexedImage[]) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLDivElement>, item: IndexedImage) => void;
  onOpenMoreButton: (event: MouseEvent<HTMLButtonElement>, item: IndexedImage) => void;
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
  selectCheckbox: {
    position: "absolute",
    top: tokens.spacingVerticalXS,
    left: tokens.spacingHorizontalXS,
    zIndex: 3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    borderRadius: tokens.borderRadiusMedium,
    color: "white",
    backgroundColor: "rgba(24, 24, 27, 0.66)",
  },
  selectCheckboxChecked: {
    backgroundColor: tokens.colorBrandBackground,
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
  multiSelectMode,
  tags = [],
  onItemSelect,
  onToggleFavorite,
  onOpenContextMenu,
  onOpenMoreButton,
}: EmojiGridItemProps) {
  const styles = useStyles();
  const { source, failed } = useThumbnail(item.id, thumbnailSize);
  const [hovered, setHovered] = useState(false);
  const { gifSrc, handleGifError } = useGifPreview(item, hovered);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) onItemSelect(item, "toggle");
    else if (event.shiftKey) onItemSelect(item, "range");
    else onItemSelect(item, multiSelectMode ? "toggle" : "replace");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onItemSelect(item, "replace");
    }
  }

  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={selected}
      aria-label={item.name}
      className={mergeClasses(styles.root, selected && styles.selected)}
      onClick={handleClick}
      onDoubleClick={() => onItemSelect(item, "replace")}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => onOpenContextMenu(event, item)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={styles.frame}>
        {source ? (
          <img
            className={styles.image}
            src={gifSrc ?? source}
            alt={item.name}
            loading="lazy"
            onError={gifSrc ? handleGifError : undefined}
          />
        ) : (
          <div className={styles.placeholder}>
            <Image20Regular />
            <span>{failed ? "预览不可用" : "加载中"}</span>
          </div>
        )}
      </div>

      {isGifExtension(item.extension) && !multiSelectMode && <Badge className={styles.gifBadge} size="small" appearance="filled">GIF</Badge>}

      {multiSelectMode && (
        <span
          className={mergeClasses(styles.selectCheckbox, selected && styles.selectCheckboxChecked)}
        >
          {selected ? <CheckboxChecked20Regular /> : <CheckboxUnchecked20Regular />}
        </span>
      )}

      <div className={`${styles.actions} emoji-actions`} onClick={(event) => event.stopPropagation()}>
        <Tooltip content={favorite ? "取消收藏" : "收藏"} relationship="label">
          <Button
            className={styles.actionButton}
            size="small"
            appearance="subtle"
            aria-label={favorite ? "取消收藏" : "收藏"}
            icon={favorite ? <Star20Filled /> : <Star20Regular />}
            onClick={() => onToggleFavorite([item])}
          />
        </Tooltip>
        <Tooltip content="更多操作" relationship="label">
          <Button
            className={styles.actionButton}
            size="small"
            appearance="subtle"
            aria-label="更多操作"
            icon={<MoreHorizontal20Regular />}
            onClick={(event) => onOpenMoreButton(event, item)}
          />
        </Tooltip>
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
