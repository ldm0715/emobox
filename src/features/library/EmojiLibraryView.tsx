import {
  Button,
  ProgressBar,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Search20Regular, Star24Regular, History24Regular } from "@fluentui/react-icons";
import type {
  GridDensity,
  IndexedImage,
  LibraryView,
  SortOption,
} from "../../types";
import { EmojiGrid } from "./EmojiGrid";
import { EmptyLibraryState } from "./EmptyLibraryState";
import { LibraryHeader } from "./LibraryHeader";
import { LibraryMessage } from "./LibraryMessage";

interface EmojiLibraryViewProps {
  view: LibraryView;
  title: string;
  allItemCount: number;
  items: IndexedImage[];
  query: string;
  density: GridDensity;
  sortOption: SortOption;
  selectedPath: string | null;
  favorites: Set<string>;
  importing: boolean;
  error: string;
  onClearError: () => void;
  onClearSearch: () => void;
  onImportFolder: () => void;
  onDensityChange: (density: GridDensity) => void;
  onSortChange: (option: SortOption) => void;
  onSelect: (item: IndexedImage) => void;
  onToggleFavorite: (item: IndexedImage) => void;
}

const useStyles = makeStyles({
  root: {
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "auto auto minmax(0, 1fr)",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  status: {
    minHeight: 0,
  },
  progressLabel: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXL}`,
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground1,
    fontSize: tokens.fontSizeBase200,
  },
  content: {
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    padding: tokens.spacingHorizontalXL,
  },
  centered: {
    minHeight: "320px",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  centeredContent: {
    maxWidth: "400px",
  },
  centeredIcon: {
    marginBottom: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground4,
  },
  centeredTitle: {
    margin: 0,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  centeredDescription: {
    marginTop: tokens.spacingVerticalS,
    marginBottom: tokens.spacingVerticalM,
    lineHeight: tokens.lineHeightBase300,
  },
});

export function EmojiLibraryView(props: EmojiLibraryViewProps) {
  const styles = useStyles();
  const {
    view,
    title,
    allItemCount,
    items,
    query,
    density,
    sortOption,
    selectedPath,
    favorites,
    importing,
    error,
    onClearError,
    onClearSearch,
    onImportFolder,
    onDensityChange,
    onSortChange,
    onSelect,
    onToggleFavorite,
  } = props;

  function renderEmptyContent() {
    if (query) {
      return (
        <div className={styles.centered}>
          <div className={styles.centeredContent}>
            <Search20Regular className={styles.centeredIcon} />
            <h2 className={styles.centeredTitle}>没有找到“{query}”相关的表情</h2>
            <p className={styles.centeredDescription}>可以尝试更短的文件名关键词。</p>
            <Button onClick={onClearSearch}>清除搜索</Button>
          </div>
        </div>
      );
    }

    if (allItemCount === 0) {
      return <EmptyLibraryState importing={importing} onImportFolder={onImportFolder} />;
    }

    if (view === "favorites") {
      return (
        <div className={styles.centered}>
          <div className={styles.centeredContent}>
            <Star24Regular className={styles.centeredIcon} />
            <h2 className={styles.centeredTitle}>还没有收藏</h2>
            <p className={styles.centeredDescription}>将鼠标移到表情上，点击星标即可收藏。</p>
          </div>
        </div>
      );
    }

    if (view === "recent") {
      return (
        <div className={styles.centered}>
          <div className={styles.centeredContent}>
            <History24Regular className={styles.centeredIcon} />
            <h2 className={styles.centeredTitle}>暂无最近使用</h2>
            <p className={styles.centeredDescription}>从快捷搜索复制过的图片会显示在这里，并在应用重启后继续保留。</p>
          </div>
        </div>
      );
    }

    return <EmptyLibraryState importing={importing} onImportFolder={onImportFolder} />;
  }

  return (
    <section className={styles.root}>
      <LibraryHeader
        title={title}
        count={items.length}
        sortOption={sortOption}
        density={density}
        onSortChange={onSortChange}
        onDensityChange={onDensityChange}
      />

      <div className={styles.status}>
        {importing && (
          <>
            <ProgressBar />
            <div className={styles.progressLabel}>正在导入表情…</div>
          </>
        )}
        {error && <LibraryMessage message={error} onDismiss={onClearError} />}
      </div>

      <div className={styles.content}>
        {items.length > 0 ? (
          <EmojiGrid
            items={items}
            density={density}
            selectedPath={selectedPath}
            favorites={favorites}
            onSelect={onSelect}
            onToggleFavorite={onToggleFavorite}
          />
        ) : renderEmptyContent()}
      </div>
    </section>
  );
}
