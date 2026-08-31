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
  Copy20Regular,
  Image20Regular,
  MoreHorizontal20Regular,
  Star20Filled,
  Star20Regular,
  Tag16Regular,
} from "@fluentui/react-icons";
import { memo, type KeyboardEvent, type MouseEvent, useState } from "react";
import type { GridDensity, IndexedImage } from "../../types";
import { cardBorderResetStyle, cardSelectedRingStyle } from "./cardStyles";
import type { EmojiItemMenuMode } from "./EmojiItemMenu";
import type { SelectionMode } from "./useMultiSelection";
import { useClickIntent } from "./useClickIntent";
import { useThumbnail } from "./useThumbnail";
import { isGifExtension, useGifPreview } from "./useGifPreview";

interface EmojiGridItemProps {
  item: IndexedImage;
  selected: boolean;
  favorite: boolean;
  thumbnailSize: number;
  density: GridDensity;
  multiSelectMode: boolean;
  /** trash 视图隐藏收藏按钮（右键菜单/批量条同样无收藏入口）。 */
  menuMode?: EmojiItemMenuMode;
  tags?: string[];
  onItemSelect: (item: IndexedImage, mode: SelectionMode) => void;
  onToggleFavorite: (items: IndexedImage[]) => void;
  onCopy: (items: IndexedImage[]) => void;
  onOpenPreview: (item: IndexedImage) => void;
  /** 点击 Tag 按该标签筛选（App 侧注入 `*标签` 精确搜索）。 */
  onTagClick: (tag: string) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLDivElement>, item: IndexedImage) => void;
  onOpenMoreButton: (event: MouseEvent<HTMLButtonElement>, item: IndexedImage) => void;
}

const useStyles = makeStyles({
  root: {
    position: "relative",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground3, ...cardBorderResetStyle,
    borderRadius: tokens.borderRadiusLarge,
    cursor: "default",
    transitionProperty: "background-color, border-color, box-shadow",
    transitionDuration: tokens.durationFaster,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
    ":hover .emoji-actions": {
      opacity: 1,
    },
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "2px",
    },
  },
  selected: cardSelectedRingStyle,
  frame: {
    position: "relative",
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
  captionRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    minWidth: 0,
    padding: `0 ${tokens.spacingHorizontalXS} ${tokens.spacingVerticalXS}`,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  captionText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  captionSelected: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  // 紧凑密度：不展开 Tag 行（保持卡片高度稳定），只在文件名右端显示图标+数量。
  tagCount: {
    display: "inline-flex",
    alignItems: "center",
    columnGap: "2px",
    flexShrink: 0,
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase100,
    userSelect: "none",
  },
  // 标准/大图密度：文件名下方的 Tag 行（最多 2 个 + “+N”）。
  tagRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    minWidth: 0,
    padding: `0 ${tokens.spacingHorizontalXS} ${tokens.spacingVerticalXS}`,
  },
  tagBadge: {
    // 覆盖 Badge 的 inline-flex 为 block，文本截断才生效。
    display: "block",
    minWidth: 0,
    maxWidth: "84px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  tagOverflow: {
    cursor: "default",
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
  },
});

export function EmojiGridItemBase({
  item,
  selected,
  favorite,
  thumbnailSize,
  density,
  multiSelectMode,
  menuMode = "default",
  tags = [],
  onItemSelect,
  onToggleFavorite,
  onCopy,
  onOpenPreview,
  onTagClick,
  onOpenContextMenu,
  onOpenMoreButton,
}: EmojiGridItemProps) {
  const styles = useStyles();
  const { source, failed } = useThumbnail(item.id, thumbnailSize);
  const [hovered, setHovered] = useState(false);
  const { gifSrc, handleGifError } = useGifPreview(item, hovered);

  // 单击/双击消歧：Ctrl/Shift/多选模式立即选中；普通单击 250ms 后复制；双击开预览。
  // 回收站（trash）例外：复制不可用，普通单击退化为选中（replace），
  // 方便连点几张后走批量条/右键菜单的 恢复/彻底删除。
  const { handleClick, handleDoubleClick } = useClickIntent({
    isImmediate: (event) => event.ctrlKey || event.metaKey || event.shiftKey || multiSelectMode,
    onImmediate: (event) => {
      if (event.ctrlKey || event.metaKey) onItemSelect(item, "toggle");
      else if (event.shiftKey) onItemSelect(item, "range");
      else onItemSelect(item, "toggle");
    },
    onSingle: () => {
      if (menuMode === "trash") onItemSelect(item, "replace");
      else onCopy([item]);
    },
    onDouble: () => onOpenPreview(item),
  });

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
      onDoubleClick={handleDoubleClick}
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

        {/* 图片区只放固定状态角标与操作按钮（GIF 徽标 / 多选框 / 悬停按钮组）。 */}
        {isGifExtension(item.extension) && !multiSelectMode && <Badge className={styles.gifBadge} size="small" appearance="filled">GIF</Badge>}

        {multiSelectMode && (
          <span
            className={mergeClasses(styles.selectCheckbox, selected && styles.selectCheckboxChecked)}
          >
            {selected ? <CheckboxChecked20Regular /> : <CheckboxUnchecked20Regular />}
          </span>
        )}

        <div
          className={`${styles.actions} emoji-actions`}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {menuMode !== "trash" && (
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
          )}
          {menuMode !== "trash" && (
            <Tooltip content="复制" relationship="label">
              <Button
                className={styles.actionButton}
                size="small"
                appearance="subtle"
                aria-label="复制"
                icon={<Copy20Regular />}
                onClick={() => onCopy([item])}
              />
            </Tooltip>
          )}
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
      </div>

      {/* 文件名行：右端在紧凑密度下内联 Tag 图标+数量（保持卡片高度稳定）。 */}
      <div className={mergeClasses(styles.captionRow, selected && styles.captionSelected)}>
        {/* 原生 title 承担全名展示：Fluent Tooltip 是重型组件（每实例多个 state/事件
            hook），网格数百卡全挂会拖垮重渲染与鼠标扫过时的开合。 */}
        <span className={styles.captionText} title={item.name}>
          {item.name}
        </span>
        {density === "compact" && tags.length > 0 && (
          <span className={styles.tagCount} title={tags.join("、")}>
            <Tag16Regular />
            <span>{tags.length}</span>
          </span>
        )}
      </div>

      {/* 标准/大图密度：Tag 行在文件名下方，最多 2 个 + “+N”，点击按标签筛选。 */}
      {density !== "compact" && tags.length > 0 && (
        <div className={styles.tagRow}>
          {tags.slice(0, 2).map((tag) => (
            <Badge
              key={tag}
              className={styles.tagBadge}
              size="small"
              appearance="outline"
              title={tag}
              onClick={(event) => {
                event.stopPropagation();
                onTagClick(tag);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {tag}
            </Badge>
          ))}
          {tags.length > 2 && (
            <Badge
              className={mergeClasses(styles.tagBadge, styles.tagOverflow)}
              size="small"
              appearance="outline"
              title={tags.slice(2).join("、")}
            >
              +{tags.length - 2}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

// memo：配合 EmojiGrid/App 侧的稳定 props（回调 latest-ref + 投影 identity 缓存），
// 让 toast/选区/收藏等 App 级重渲染只触碰真正变化的卡片。
export const EmojiGridItem = memo(EmojiGridItemBase);
