import {
  Button,
  mergeClasses,
  ProgressBar,
  makeStyles,
  motionTokens,
  tokens,
} from "@fluentui/react-components";
import { Fade, FadeSnappy, Slide } from "@fluentui/react-motion-components-preview";
import { ArrowDownload20Regular, Delete24Regular, Search20Regular, Star24Regular, History24Regular } from "@fluentui/react-icons";
import { useEffect, useMemo, useRef } from "react";
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
  /** 落地代数 key：只在视图/搜索词/排序切换且新数据落地时变化（keep-previous，
   * 旧内容无动画保留到落地瞬间），驱动入场动画与渐进渲染量重置。 */
  resetKey: string;
  /** 第 1 页数据是否已落地：落地前不渲染空状态（防启动首帧闪现错误的空态）。 */
  ready: boolean;
  query: string;
  density: GridDensity;
  sortOption: SortOption;
  selectedIds: Set<number>;
  favoriteIds: Set<number>;
  multiSelectMode: boolean;
  /** 已加载项是否已全部选中（全选按钮的切换态）。 */
  allSelected: boolean;
  onToggleSelectAll: () => void;
  /** 正在向窗口拖文件：只在图片区上方显示放置提示，不盖 header / 状态条。 */
  dragActive: boolean;
  importing: boolean;
  /** 手动刷新拉取进行中：网格容器降不透明度（fade-through 变暗半程），
   * 落地后回亮——原地换新不重挂载，避免整树闪空白。 */
  refreshing: boolean;
  /** 手动刷新落地信号（App 侧递增）：原地刷新不经 resetKey，由它驱动回顶。 */
  refreshLandedTick: number;
  onClearSearch: () => void;
  onImportImages: () => void;
  onImportFolder: () => void;
  onCollectFromClipboard: () => void;
  onDensityChange: (density: GridDensity) => void;
  onSortChange: (option: SortOption) => void;
  /** 刷新图库：当前视图全量重拉（LibraryHeader「刷新」按钮）。 */
  onRefresh: () => void;
  onToggleMultiSelect: () => void;
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
  /** 单张重命名（右键菜单单项操作）。 */
  onRename?: (items: IndexedImage[]) => void;
  /** 批量模板重命名（仅分组视图批量条提供）。 */
  onBatchRename?: (items: IndexedImage[]) => void;
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
  contentWrap: {
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr)",
  },
  content: {
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    padding: tokens.spacingHorizontalXL,
    // 手动刷新的 fade-through（变暗 → 原位换新 → 回亮）：曲线/时长与 AppShell
    // 侧栏折叠过渡一致；reduced-motion 直接跳变。
    transitionProperty: "opacity",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
    "@media (prefers-reduced-motion: reduce)": {
      transitionProperty: "none",
    },
  },
  contentRefreshing: {
    opacity: 0.6,
  },
  // 拖入放置提示：只铺在图片区（content）上方，不盖 header / 状态条。
  // Fluent 做法：品牌浅底 + 1px 实线品牌描边 + 大圆角，不用粗虚线框。
  dropOverlay: {
    position: "absolute",
    // 右边比其余三边多收 20px（避开滚动条区域）。
    inset: "16px 36px 16px 16px",
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    columnGap: tokens.spacingHorizontalS,
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    pointerEvents: "none",
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
    ready,
    query,
    density,
    sortOption,
    selectedIds,
    favoriteIds,
    multiSelectMode,
    allSelected,
    onToggleSelectAll,
    dragActive,
    importing,
    refreshing,
    refreshLandedTick,
    onClearSearch,
    onImportImages,
    onImportFolder,
    onCollectFromClipboard,
    onDensityChange,
    onSortChange,
    onRefresh,
    onToggleMultiSelect,
    onItemSelect,
    onClearSelection,
    onToggleFavorite,
    onCopy,
    onOpenPreview,
    onTagClick,
    onMoveToGroup,
    onRemoveFromGroup,
    onAddTags,
    onRename,
    onBatchRename,
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

  // keep-previous 后旧内容不被卸载、滚动位置不会被浏览器自动收口，
  // 新视图数据落地（resetKey 变化）时显式回顶（与 SettingsMenu panelRef 同模式）。
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [resetKey]);

  // 手动刷新落地：原地刷新不递增 viewGeneration（不经 resetKey 回顶），
  // 由独立的落地信号驱动同一处回顶。
  useEffect(() => {
    if (refreshLandedTick > 0) {
      contentRef.current?.scrollTo(0, 0);
    }
  }, [refreshLandedTick]);

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

    // 回收站收紧（2026-09）：导入对回收站属越权，专属空状态不带任何导入按钮；
    // 放在 allItemCount === 0 之前——整库为空时停在回收站也应看到回收站空状态。
    if (view === "trash") {
      return (
        <div className={styles.centered}>
          <div className={styles.centeredContent}>
            <Delete24Regular className={styles.centeredIcon} />
            <h2 className={styles.centeredTitle}>回收站是空的</h2>
            <p className={styles.centeredDescription}>删除的表情会先移到这里，可随时恢复或彻底删除。</p>
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
        onRefresh={onRefresh}
        refreshDisabled={importing}
        refreshing={refreshing}
      />

      <div className={styles.status}>
        {importing && (
          <>
            <ProgressBar />
            <div className={styles.progressLabel}>正在导入表情…</div>
          </>
        )}
      </div>

      <div className={styles.contentWrap}>
        <div
          className={mergeClasses(styles.content, refreshing && styles.contentRefreshing)}
          ref={contentRef}
        >
          {/* 视图/搜索/排序切换的入场淡入：只做在容器层（key 重挂载触发），绝不做
              per-item——EmojiGridItem 是 memo 数百实例，逐项动画会击穿性能红线。
              内层垫普通 div：presence 组件克隆唯一 child 并直接施加动效，child 必须
              是 DOM 元素（EmojiGrid 返回 Fragment 不能直接当 child）。
              key 是落地代数（keep-previous）：旧内容无动画保留到新数据落地，
              落地瞬间才重挂载淡入，空状态与网格获得一致的入场动画。 */}
          <FadeSnappy key={resetKey} visible appear>
            <div>
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
                onOpenPreview={onOpenPreview}
                onTagClick={onTagClick}
                onMoveToGroup={onMoveToGroup}
                onRemoveFromGroup={onRemoveFromGroup}
                onAddTags={onAddTags}
                onRename={onRename}
                onShowInExplorer={onShowInExplorer}
                onDelete={onDelete}
                onRestore={onRestore}
                onPermanentlyDelete={onPermanentlyDelete}
              />
            ) : ready ? renderEmptyContent() : null}
            </div>
          </FadeSnappy>

          {/* 批量条：底边浮出（12px 上滑 + 淡入，Fluent 命令栏范式）。unmountOnExit
              必须有——presence 默认退场后 child 仍挂载，透明的 sticky 条会占位并挡点击。 */}
          <Slide visible={showBar} outY="12px" unmountOnExit>
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
              {menuMode === "group" && onBatchRename && (
                <Button size="small" onClick={() => onBatchRename(selectedItems)}>
                  批量重命名
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
          </Slide>
        </div>

        {/* 拖放提示：大面积反馈层只做淡入（150ms，即时性优先）；unmountOnExit 同上。 */}
        <Fade visible={dragActive} duration={motionTokens.durationFast} unmountOnExit>
          <div className={styles.dropOverlay}>
            <ArrowDownload20Regular />
            <span>释放以保存到 EmoBox 素材库</span>
          </div>
        </Fade>
      </div>
    </section>
  );
}
