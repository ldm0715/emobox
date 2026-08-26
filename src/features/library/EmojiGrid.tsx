import { makeStyles, tokens } from "@fluentui/react-components";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { GridDensity, IndexedImage } from "../../types";
import { EmojiGridItem } from "./EmojiGridItem";
import type { EmojiItemMenuMode } from "./EmojiItemMenu";

interface EmojiGridProps {
  items: IndexedImage[];
  density: GridDensity;
  selectedPath: string | null;
  favorites: Set<string>;
  menuMode?: EmojiItemMenuMode;
  tagsByPath?: Record<string, string[]>;
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

const BATCH_SIZE = 72;

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
  selectedPath,
  favorites,
  menuMode = "default",
  tagsByPath,
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
}: EmojiGridProps) {
  const styles = useStyles();
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const config = densityConfig[density];

  useEffect(() => {
    setVisibleCount(BATCH_SIZE);
  }, [items]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= items.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((current) => Math.min(current + BATCH_SIZE, items.length));
        }
      },
      { rootMargin: "360px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, visibleCount]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const gridStyle = { "--emoji-tile-size": `${config.tile}px` } as CSSProperties;

  return (
    <>
      <div className={styles.grid} style={gridStyle} role="listbox" aria-label="表情列表">
        {visibleItems.map((item) => (
          <EmojiGridItem
            key={item.path}
            item={item}
            selected={selectedPath === item.path}
            favorite={favorites.has(item.path)}
            thumbnailSize={config.thumbnail}
            menuMode={menuMode}
            tags={tagsByPath?.[item.path] ?? []}
            onSelect={onSelect}
            onToggleFavorite={onToggleFavorite}
            onCopy={onCopy}
            onMoveToGroup={onMoveToGroup}
            onRemoveFromGroup={onRemoveFromGroup}
            onAddTags={onAddTags}
            onShowInExplorer={onShowInExplorer}
            onDelete={onDelete}
            onRestore={onRestore}
            onPermanentlyDelete={onPermanentlyDelete}
          />
        ))}
      </div>
      {visibleCount < items.length && <div className={styles.sentinel} ref={sentinelRef} />}
    </>
  );
}
