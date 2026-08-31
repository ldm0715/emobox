import {
  Button,
  ProgressBar,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Search20Regular, Star24Regular, History24Regular } from "@fluentui/react-icons";
import { useMemo } from "react";
import type {
  GridDensity,
  IndexedImage,
  LibraryView,
  SortOption,
} from "../../types";
import { EmojiGrid } from "./EmojiGrid";
import type { EmojiItemMenuMode } from "./EmojiItemMenu";
import { EmptyLibraryState } from "./EmptyLibraryState";
import { LibraryHeader } from "./LibraryHeader";
import { LibraryMessage } from "./LibraryMessage";
import type { SelectionMode } from "./useMultiSelection";

interface EmojiLibraryViewProps {
  view: LibraryView;
  title: string;
  allItemCount: number;
  items: IndexedImage[];
  /** 当前视图总数（后端 total，Phase 17 分页）。header「共 N 张」显示它。 */
  total: number;
  /** 还有未加载的页（触发网格哨兵 loadMore）。 */
  hasMore: boolean;
  onLoadMore: () => void;
  /** 视图/搜索词/排序的复合 key：变化时网格重置渐进渲染量（追加页不清零）。 */
  resetKey: string;
  query: string;
  density: GridDensity;
  sortOption: SortOption;
  selectedIds: Set<number>;
  favoriteIds: Set<number>;
  multiSelectMode: boolean;
  /** 已加载项是否已全部选中（全选按钮的切换态）。 */
  allSelected: boolean;
  onToggleSelectAll: () => void;
  importing: boolean;
  error: string;
  onClearError: () => void;
  onClearSearch: () => void;
  onImportImages: () => void;
  onImportFolder: () => void;
  onCollectFromClipboard: () => void;
  onDensityChange: (density: GridDensity) => void;
  onSortChange: (option: SortOption) => void;
  onToggleMultiSelect: () => void;
  onItemSelect: (item: IndexedImage, mode: SelectionMode) => void;
  onClearSelection: () => void;
  onToggleFavorite: (items: IndexedImage[]) => void;
  onCopy: (items: IndexedImage[]) => void;
  onMoveToGroup: (items: IndexedImage[]) => void;
  onRemoveFromGroup?: (items: IndexedImage[]) => void;
  onAddTags?: (items: IndexedImage[]) => void;
  onShowInExplorer: (items: IndexedImage[]) => void;
  onDelete: (items: IndexedImage[]) => void;
  onRestore?: (items: IndexedImage[]) => void;
  onPermanentlyDelete?: (items: IndexedImage[]) => void;
  tagsByPath?: Record<string, string[]>;
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
  selectionBar: {
    position: "sticky",
    bottom: 0,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    margin: `0 -${tokens.spacingHorizontalXL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
  },
  selectionBarCount: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
  },
  selectionBarActions: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
  },
});

export function EmojiLibraryView(props: EmojiLibraryViewProps) {
  const styles = useStyles();
  const {
    view,
    title,
    allItemCount,
    items,
    total,
    hasMore,
    onLoadMore,
    resetKey,
    query,
    density,
    sortOption,
    selectedIds,
    favoriteIds,
    multiSelectMode,
    allSelected,
    onToggleSelectAll,
    importing,
    error,
    onClearError,
    onClearSearch,
    onImportImages,
    onImportFolder,
    onCollectFromClipboard,
    onDensityChange,
    onSortChange,
    onToggleMultiSelect,
    onItemSelect,
    onClearSelection,
    onToggleFavorite,
    onCopy,
    onMoveToGroup,
    onRemoveFromGroup,
    onAddTags,
    onShowInExplorer,
    onDelete,
    onRestore,
    onPermanentlyDelete,
    tagsByPath,
  } = props;
  const menuMode: EmojiItemMenuMode =
    view === "trash" ? "trash" : view.startsWith("group:") ? "group" : "default";

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );
  // 多选模式下只要有选中就浮出批量条（含"退出多选"）；非多选模式仅 2+ 项时浮出。
  const showBar = selectedIds.size >= (multiSelectMode ? 1 : 2);
  const allFav = selectedItems.length > 0 && selectedItems.every((item) => favoriteIds.has(item.id));

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
      return (
        <EmptyLibraryState
          importing={importing}
          onImportImages={onImportImages}
          onImportFolder={onImportFolder}
          onCollectFromClipboard={onCollectFromClipboard}
        />
      );
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

    return (
      <EmptyLibraryState
        importing={importing}
        onImportImages={onImportImages}
        onImportFolder={onImportFolder}
        onCollectFromClipboard={onCollectFromClipboard}
      />
    );
  }

  return (
    <section className={styles.root}>
      <LibraryHeader
        title={title}
        count={total}
        sortOption={sortOption}
        density={density}
        multiSelectMode={multiSelectMode}
        allSelected={allSelected}
        onToggleSelectAll={onToggleSelectAll}
        onToggleMultiSelect={onToggleMultiSelect}
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
            selectedIds={selectedIds}
            favoriteIds={favoriteIds}
            multiSelectMode={multiSelectMode}
            menuMode={menuMode}
            tagsByPath={tagsByPath}
            hasMore={hasMore}
            onLoadMore={onLoadMore}
            resetKey={resetKey}
            onItemSelect={onItemSelect}
            onClearSelection={onClearSelection}
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
        ) : renderEmptyContent()}

        {showBar && (
          <div className={styles.selectionBar}>
            <span className={styles.selectionBarCount}>已选 {selectedIds.size} 项</span>
            <div className={styles.selectionBarActions}>
              {menuMode !== "trash" && (
                <Button size="small" onClick={() => onToggleFavorite(selectedItems)}>
                  {allFav ? "取消收藏" : "收藏"}
                </Button>
              )}
              {menuMode !== "trash" && (
                <Button size="small" onClick={() => onMoveToGroup(selectedItems)}>
                  加入分组
                </Button>
              )}
              {menuMode === "group" && onRemoveFromGroup && (
                <Button size="small" onClick={() => onRemoveFromGroup(selectedItems)}>
                  从当前分组移除
                </Button>
              )}
              {menuMode !== "trash" && onAddTags && (
                <Button size="small" onClick={() => onAddTags(selectedItems)}>
                  管理标签
                </Button>
              )}
              {menuMode === "trash" && onRestore && (
                <Button size="small" onClick={() => onRestore(selectedItems)}>
                  恢复
                </Button>
              )}
              {menuMode === "trash" && onPermanentlyDelete && (
                <Button size="small" onClick={() => onPermanentlyDelete(selectedItems)}>
                  彻底删除
                </Button>
              )}
              {menuMode !== "trash" && (
                <Button size="small" onClick={() => onDelete(selectedItems)}>
                  移入回收站
                </Button>
              )}
              {multiSelectMode && (
                <Button size="small" appearance="secondary" onClick={onToggleMultiSelect}>
                  退出多选
                </Button>
              )}
              <Button size="small" appearance="subtle" onClick={onClearSelection}>
                清除选择
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
