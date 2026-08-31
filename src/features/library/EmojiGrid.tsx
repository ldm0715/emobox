import { Menu, makeStyles, tokens } from "@fluentui/react-components";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { GridDensity, IndexedImage } from "../../types";
import { EmojiGridItem } from "./EmojiGridItem";
import { EmojiItemMenu, type EmojiItemMenuMode } from "./EmojiItemMenu";
import type { SelectionMode } from "./useMultiSelection";

/** Fluent Menu 的 positioning.target 结构（PositioningVirtualElement 的本地等价）。 */
interface VirtualTarget {
  getBoundingClientRect: () => {
    x: number;
    y: number;
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
  };
}

function virtualTargetFromEvent(event: MouseEvent): VirtualTarget {
  const { clientX, clientY } = event;
  return {
    getBoundingClientRect: () => ({
      x: clientX,
      y: clientY,
      top: clientY,
      left: clientX,
      bottom: clientY + 1,
      right: clientX + 1,
      width: 1,
      height: 1,
    }),
  };
}

function virtualTargetFromRect(rect: DOMRect): VirtualTarget {
  return { getBoundingClientRect: () => rect };
}

interface EmojiGridProps {
  items: IndexedImage[];
  density: GridDensity;
  selectedIds: Set<number>;
  favoriteIds: Set<number>;
  multiSelectMode: boolean;
  menuMode?: EmojiItemMenuMode;
  tagsByPath?: Record<string, string[]>;
  /** 还有未加载数据页（Phase 17）：哨兵触发 onLoadMore 拉下一页。 */
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** 视图/搜索词/排序复合 key：变化才重置渐进渲染量（追加页不回跳）。 */
  resetKey: string;
  onItemSelect: (item: IndexedImage, mode: SelectionMode) => void;
  onClearSelection: () => void;
  onToggleFavorite: (items: IndexedImage[]) => void;
  onCopy: (items: IndexedImage[]) => void;
  /** 双击卡片打开大图预览。 */
  onOpenPreview: (item: IndexedImage) => void;
  /** 点击卡片上的 Tag 按该标签筛选。 */
  onTagClick: (tag: string) => void;
  onMoveToGroup: (items: IndexedImage[]) => void;
  onRemoveFromGroup?: (items: IndexedImage[]) => void;
  onAddTags?: (items: IndexedImage[]) => void;
  onShowInExplorer: (items: IndexedImage[]) => void;
  onDelete: (items: IndexedImage[]) => void;
  onRestore?: (items: IndexedImage[]) => void;
  onPermanentlyDelete?: (items: IndexedImage[]) => void;
}

const BATCH_SIZE = 72;

/** 无标签项的稳定空数组：避免每次渲染新建 [] 打破 EmojiGridItem 的 memo。 */
const EMPTY_TAGS: string[] = [];

const densityConfig: Record<GridDensity, { tile: number; thumbnail: number }> = {
  compact: { tile: 104, thumbnail: 144 },
  comfortable: { tile: 128, thumbnail: 192 },
  large: { tile: 152, thumbnail: 240 },
};

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(var(--emoji-tile-size), 1fr))",
    alignItems: "start",
    gap: tokens.spacingHorizontalM,
  },
  sentinel: {
    height: "1px",
  },
});

export function EmojiGrid({
  items,
  density,
  selectedIds,
  favoriteIds,
  multiSelectMode,
  menuMode = "default",
  tagsByPath,
  hasMore = false,
  onLoadMore,
  resetKey,
  onItemSelect,
  onClearSelection,
  onToggleFavorite,
  onCopy,
  onOpenPreview,
  onTagClick,
  onMoveToGroup,
  onRemoveFromGroup,
  onAddTags,
  onShowInExplorer,
  onDelete,
  onRestore,
  onPermanentlyDelete,
}: EmojiGridProps) {
  const styles = useStyles();
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const config = densityConfig[density];
  // onLoadMore 来自 App 的 useCallback（依赖 currentEmojis 等，身份常变），
  // 经 ref 转发避免 observer effect 频繁重建。
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  // 共享右键/更多菜单：打开时把当前 target 项与光标锚点一起记下。
  const [menuOpen, setMenuOpen] = useState(false);
  const [targetItems, setTargetItems] = useState<IndexedImage[]>([]);
  const [contextTarget, setContextTarget] = useState<VirtualTarget | undefined>();

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  // Phase 17：只在视图/搜索词/排序切换（resetKey 变化）时重置渲染量——
  // 追加数据页时 items 引用也变，但不能把渲染量打回 72 造成滚动跳变。
  const prevResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey;
      setVisibleCount(BATCH_SIZE);
    }
  }, [resetKey]);

  // 本地删除让 items 收缩时收口渲染量（slice 本身安全，这里保持状态干净）。
  useEffect(() => {
    setVisibleCount((current) => Math.min(current, Math.max(items.length, BATCH_SIZE)));
  }, [items.length]);

  const canRevealMore = visibleCount < items.length;
  // 已渲染完全部已加载项、且后端还有下一页 → 哨兵改拉数据。
  const needsNextPage = hasMore && !canRevealMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || (!canRevealMore && !needsNextPage)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (canRevealMore) {
          setVisibleCount((current) => Math.min(current + BATCH_SIZE, items.length));
        } else if (needsNextPage) {
          onLoadMoreRef.current?.();
        }
      },
      { rootMargin: "360px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, canRevealMore, needsNextPage]);

  // 菜单打开期间选区若被外部改掉（Delete 键 / 批量条清除），关掉菜单避免 stale target。
  useEffect(() => {
    if (menuOpen && targetItems.some((item) => !selectedIds.has(item.id))) {
      setMenuOpen(false);
    }
  }, [menuOpen, targetItems, selectedIds]);

  function openMenuFor(item: IndexedImage, target: VirtualTarget) {
    // 右键/点击「更多」时：目标项在现存多选内 → 菜单作用于整个多选；否则先单选该项。
    const multi = selectedIds.has(item.id) && selectedIds.size > 1;
    if (!multi) onItemSelect(item, "replace");
    setTargetItems(multi ? selectedItems : [item]);
    setContextTarget(target);
    setMenuOpen(true);
  }

  // openMenuFor 随选区变化，经 latest-ref 转发保持 handler 身份稳定（memo 前提）。
  const openMenuForRef = useRef(openMenuFor);
  openMenuForRef.current = openMenuFor;

  const handleContextItem = useCallback((event: MouseEvent<HTMLDivElement>, item: IndexedImage) => {
    event.preventDefault();
    openMenuForRef.current(item, virtualTargetFromEvent(event));
  }, []);

  const handleMoreButton = useCallback((event: MouseEvent<HTMLButtonElement>, item: IndexedImage) => {
    openMenuForRef.current(item, virtualTargetFromRect(event.currentTarget.getBoundingClientRect()));
  }, []);

  const menuFavorite = targetItems.length > 0 && targetItems.every((item) => favoriteIds.has(item.id));

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const gridStyle = { "--emoji-tile-size": `${config.tile}px` } as CSSProperties;

  return (
    <>
      <div
        className={styles.grid}
        style={gridStyle}
        role="listbox"
        aria-label="表情列表"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClearSelection();
        }}
      >
        {visibleItems.map((item) => (
          <EmojiGridItem
            key={item.path}
            item={item}
            selected={selectedIds.has(item.id)}
            favorite={favoriteIds.has(item.id)}
            thumbnailSize={config.thumbnail}
            density={density}
            multiSelectMode={multiSelectMode}
            menuMode={menuMode}
            tags={tagsByPath?.[item.path] ?? EMPTY_TAGS}
            onItemSelect={onItemSelect}
            onToggleFavorite={onToggleFavorite}
            onCopy={onCopy}
            onOpenPreview={onOpenPreview}
            onTagClick={onTagClick}
            onOpenContextMenu={handleContextItem}
            onOpenMoreButton={handleMoreButton}
          />
        ))}
      </div>

      <Menu
        open={menuOpen}
        onOpenChange={(_, data) => setMenuOpen(data.open)}
        positioning={{ target: contextTarget }}
      >
        <EmojiItemMenu
          mode={menuMode}
          multi={targetItems.length > 1}
          favorite={menuFavorite}
          onToggleFavorite={() => onToggleFavorite(targetItems)}
          onCopy={() => onCopy(targetItems)}
          onMoveToGroup={() => onMoveToGroup(targetItems)}
          onRemoveFromGroup={onRemoveFromGroup ? () => onRemoveFromGroup(targetItems) : undefined}
          onAddTags={onAddTags ? () => onAddTags(targetItems) : () => {}}
          onShowInExplorer={() => onShowInExplorer(targetItems)}
          onDelete={() => onDelete(targetItems)}
          onRestore={onRestore ? () => onRestore(targetItems) : undefined}
          onPermanentlyDelete={onPermanentlyDelete ? () => onPermanentlyDelete(targetItems) : undefined}
        />
      </Menu>

      {(canRevealMore || needsNextPage) && (
        <div className={styles.sentinel} ref={sentinelRef} />
      )}
    </>
  );
}
