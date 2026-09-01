import {
  Button,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Dismiss20Regular, SearchSquare20Regular } from "@fluentui/react-icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import { formatShortcutLabel } from "../../config/shortcuts";
import type { IndexedImage, LibraryGroup } from "../../types";
import { QuickSearchContent } from "./QuickSearchContent";
import { overlayDragGuard } from "./overlayDragGuard";

/** 按下这些元素时不启动整窗拖拽：交互控件、可滚动的内容区。 */
const DRAG_EXCLUSION_SELECTOR =
  "button, input, textarea, select, a, [role='option'], [role='search'], [data-no-window-drag]";

/**
 * 整窗拖拽：按住浮层任意背景（标题栏 / 状态行 / footer / 留白）即可移动窗口。
 * 替代原 `data-tauri-drag-region` 方案——该属性只认属性所在元素本身，
 * 标题栏里的图标等子元素是拖拽死区，实际命中区域太小。
 * 交互控件与结果网格（含滚动条）不参与拖拽，保证点击/滚动语义不变。
 * startDragging 的 move loop 会让窗口短暂失焦，先置 dragGuard 抑制失焦关闭。
 */
function handleSurfaceMouseDown(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement;
  if (target.closest(DRAG_EXCLUSION_SELECTOR)) return;
  overlayDragGuard.active = true;
  void getCurrentWindow()
    .startDragging()
    .catch(() => {})
    .finally(() => {
      // 兜底复位：正常路径是拖拽结束后窗口重新获焦（focus=true 清标志）。
      // focus 事件万一丢失，超时也把标志清掉，避免失焦关闭被永久抑制。
      window.setTimeout(() => {
        overlayDragGuard.active = false;
      }, 3000);
    });
}

interface QuickSearchPanelProps {
  results: IndexedImage[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  pinnedGroups: LibraryGroup[];
  selectedGroupId: number | null;
  onSelectGroup: (groupId: number | null) => void;
  loading: boolean;
  error?: string;
  copyError?: string;
  copyingPath?: string;
  activationId: number;
  shortcut: string;
  onClose: () => void;
  onSelect: (item: IndexedImage) => void;
}

const useStyles = makeStyles({
  // surface 直接铺满透明窗口：圆角外区域透出底层窗口，无外衬、无投影
  // （tauri.conf.json 已关 shadow，CSS 投影没有衬垫空间可画）。
  // 浮层阶梯 = surface BG1 → 结果卡 BG3。
  surface: {
    width: "100%",
    height: "100%",
    display: "grid",
    gridTemplateRows: "48px minmax(0, 1fr)",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
  },
  titleBar: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalXS,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  icon: {
    color: tokens.colorBrandForeground1,
  },
  title: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  shortcut: {
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
  },
  content: {
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalM}`,
  },
});

export function QuickSearchPanel({
  results,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  query,
  onQueryChange,
  pinnedGroups,
  selectedGroupId,
  onSelectGroup,
  loading,
  error,
  copyError,
  copyingPath,
  activationId,
  shortcut,
  onClose,
  onSelect,
}: QuickSearchPanelProps) {
  const styles = useStyles();

  return (
    <section
      className={styles.surface}
      aria-label="快捷搜索浮层"
      onMouseDown={handleSurfaceMouseDown}
    >
      <header className={styles.titleBar}>
        <SearchSquare20Regular className={styles.icon} />
        <span className={styles.title}>快捷搜索</span>
        <span className={styles.shortcut}>{formatShortcutLabel(shortcut)}</span>
        <Button
          appearance="subtle"
          aria-label="隐藏快捷搜索"
          icon={<Dismiss20Regular />}
          onClick={onClose}
        />
      </header>
      {/* flex column：QuickSearchContent 的 root 以 flexGrow:1 填满剩余高度，
          结果区才能拿到有界高度做 overflowY 滚动。 */}
      <div className={styles.content}>
        <QuickSearchContent
          results={results}
          total={total}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
          query={query}
          onQueryChange={onQueryChange}
          pinnedGroups={pinnedGroups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
          loading={loading}
          error={error}
          copyError={copyError}
          copyingPath={copyingPath}
          activationId={activationId}
          onSelect={onSelect}
          onClose={onClose}
        />
      </div>
    </section>
  );
}
