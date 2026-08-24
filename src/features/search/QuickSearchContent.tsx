import {
  SearchBox,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  type SearchBoxChangeEvent,
} from "@fluentui/react-components";
import { Image20Regular, Search20Regular } from "@fluentui/react-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IndexedImage } from "../../types";
import { useThumbnail } from "../library/useThumbnail";
import { useSearchKeyboard } from "./useSearchKeyboard";

interface QuickSearchContentProps {
  items: IndexedImage[];
  loading?: boolean;
  error?: string;
  activationId: number;
  onSelect: (item: IndexedImage) => void;
  onClose: () => void;
}

const MAX_RESULTS = 30;
const COLUMN_COUNT = 5;

const useStyles = makeStyles({
  root: {
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    gap: tokens.spacingVerticalM,
  },
  search: {
    width: "100%",
  },
  results: {
    minHeight: "260px",
    maxHeight: "316px",
    overflowY: "auto",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(${COLUMN_COUNT}, minmax(0, 1fr))`,
    gap: tokens.spacingHorizontalS,
  },
  item: {
    minWidth: 0,
    padding: tokens.spacingHorizontalXS,
    overflow: "hidden",
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.border(tokens.strokeWidthThin, "solid", "transparent"),
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
    ":focus-visible": {
      outline: "none",
    },
  },
  selected: {
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    boxShadow: `0 0 0 ${tokens.strokeWidthThin} ${tokens.colorBrandStroke1}`,
  },
  frame: {
    aspectRatio: "1 / 1",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    marginBottom: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
  },
  image: {
    width: "100%",
    height: "100%",
    padding: tokens.spacingHorizontalXS,
    objectFit: "contain",
  },
  placeholder: {
    color: tokens.colorNeutralForeground4,
  },
  fileName: {
    display: "block",
    overflow: "hidden",
    padding: `0 ${tokens.spacingHorizontalXS}`,
    fontSize: tokens.fontSizeBase100,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    minHeight: "250px",
    display: "grid",
    placeItems: "center",
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase100,
  },
  key: {
    padding: `1px ${tokens.spacingHorizontalXS}`,
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    fontFamily: tokens.fontFamilyMonospace,
  },
});

function QuickSearchItem({
  item,
  selected,
  onActivate,
  onPoint,
  itemRef,
}: {
  item: IndexedImage;
  selected: boolean;
  onActivate: () => void;
  onPoint: () => void;
  itemRef: (element: HTMLButtonElement | null) => void;
}) {
  const styles = useStyles();
  const { source } = useThumbnail(item.path, 128);

  return (
    <button
      ref={itemRef}
      type="button"
      role="option"
      tabIndex={-1}
      className={mergeClasses(styles.item, selected && styles.selected)}
      aria-selected={selected}
      title={item.name}
      onMouseEnter={onPoint}
      onClick={onActivate}
    >
      <span className={styles.frame}>
        {source ? (
          <img className={styles.image} src={source} alt={item.name} />
        ) : (
          <Image20Regular className={styles.placeholder} />
        )}
      </span>
      <span className={styles.fileName}>{item.name}</span>
    </button>
  );
}

export function QuickSearchContent({
  items,
  loading = false,
  error,
  activationId,
  onSelect,
  onClose,
}: QuickSearchContentProps) {
  const styles = useStyles();
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items
      .filter((item) => !normalized || item.name.toLocaleLowerCase().includes(normalized))
      .slice(0, MAX_RESULTS);
  }, [items, query]);

  const confirmItem = useCallback((item: IndexedImage | undefined) => {
    if (!item) return;
    onSelect(item);
    onClose();
  }, [onClose, onSelect]);

  const { selectedIndex, setSelectedIndex, handleKeyDown } = useSearchKeyboard({
    itemCount: results.length,
    columnCount: COLUMN_COUNT,
    onConfirm: (index) => confirmItem(results[index]),
    onClose,
  });

  useEffect(() => {
    setQuery("");
    setSelectedIndex(0);
    itemRefs.current = [];
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
  }, [activationId, setSelectedIndex]);

  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div ref={rootRef} className={styles.root} onKeyDown={handleKeyDown}>
      <SearchBox
        className={styles.search}
        size="large"
        autoFocus
        aria-label="快速搜索表情"
        contentBefore={<Search20Regular />}
        placeholder="按文件名搜索表情"
        value={query}
        onChange={(_: SearchBoxChangeEvent, data: { value: string }) => {
          setQuery(data.value);
          setSelectedIndex(0);
        }}
      />

      <div className={styles.results}>
        {results.length > 0 ? (
          <div className={styles.grid} role="listbox" aria-label="快速搜索结果">
            {results.map((item, index) => (
              <QuickSearchItem
                key={item.path}
                item={item}
                selected={index === selectedIndex}
                itemRef={(element) => {
                  itemRefs.current[index] = element;
                }}
                onPoint={() => setSelectedIndex(index)}
                onActivate={() => confirmItem(item)}
              />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            {loading ? (
              <span>正在读取表情索引…</span>
            ) : error ? (
              <span>{error}</span>
            ) : query ? (
              <span>没有找到“{query}”相关的文件</span>
            ) : (
              <span>还没有可搜索的表情，请先在主窗口导入文件夹</span>
            )}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <span><span className={styles.key}>方向键</span> 移动</span>
        <span><span className={styles.key}>Enter</span> 选择</span>
        <span><span className={styles.key}>Esc</span> 隐藏</span>
      </div>
    </div>
  );
}
