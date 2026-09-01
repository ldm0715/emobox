import {
  Button,
  SearchBox,
  makeStyles,
  mergeClasses,
  motionTokens,
  tokens,
  type SearchBoxChangeEvent,
} from "@fluentui/react-components";
import { Slide } from "@fluentui/react-motion-components-preview";
import { Image20Regular, Search20Regular } from "@fluentui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IndexedImage, LibraryGroup } from "../../types";
import { cardBorderResetStyle, cardSelectedRingStyle } from "../library/cardStyles";
import { getGroupIcon } from "../library/groupIcons";
import { useThumbnail } from "../library/useThumbnail";
import { useGifPreview } from "../library/useGifPreview";
import { useSearchKeyboard } from "./useSearchKeyboard";

interface QuickSearchContentProps {
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
  loading?: boolean;
  error?: string;
  copyError?: string;
  copyingPath?: string;
  activationId: number;
  onSelect: (item: IndexedImage) => void;
  onClose: () => void;
}

const COLUMN_COUNT = 5;

const useStyles = makeStyles({
  root: {
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    display: "grid",
    // 搜索框 → 置顶分组行 → 状态行 → 结果（弹性滚动） → footer
    gridTemplateRows: "auto auto auto minmax(0, 1fr) auto",
    gap: tokens.spacingVerticalS,
  },
  search: {
    width: "100%",
    // Fluent SearchBox 根元素自带 max-width: 468px（inline-flex），width:100%
    // 会被它截断成 468px 贴左（CLAUDE.md 已记录的坑）。显式解除才真正撑满
    // 内容区（左右等宽 padding，即水平居中）。
    maxWidth: "none",
    // 放大搜索框：SearchBox 只有 medium/large 两档，浮层里 large 视觉仍偏小，
    // 对内层 input 提字号 + 加内边距（Griffel 嵌套选择器必须带 & 占位符，
    // 裸 "input" 会静默不生效——见 SettingsMenu.pathInput 的既有告警）。
    "& input": {
      fontSize: tokens.fontSizeBase400,
      paddingBlock: "10px",
    },
  },
  groupRow: {
    // 固定行高 + 横向滚动：分组再多也不撑高浮层。
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    height: "36px",
    flexShrink: 0,
    minWidth: 0,
    overflowX: "auto",
    overflowY: "hidden",
  },
  groupChip: {
    flexShrink: 0,
  },
  status: {
    display: "flex",
    alignItems: "center",
    minHeight: "18px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
  },
  results: {
    minHeight: 0,
    overflowY: "auto",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(${COLUMN_COUNT}, minmax(0, 1fr))`,
    gap: tokens.spacingHorizontalS,
  },
  loadMoreWrap: {
    display: "flex",
    justifyContent: "center",
    padding: `${tokens.spacingVerticalM} 0 ${tokens.spacingVerticalXS}`,
  },
  item: {
    minWidth: 0,
    padding: tokens.spacingHorizontalXS,
    overflow: "hidden",
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    ...cardBorderResetStyle,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
    ":focus-visible": {
      outline: "none",
    },
    ":disabled": {
      cursor: "wait",
      opacity: 0.65,
    },
  },
  selected: {
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    ...cardSelectedRingStyle,
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
    minHeight: "180px",
    display: "grid",
    placeItems: "center",
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
  },
  footer: {
    minHeight: "22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase100,
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
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
  disabled,
  onActivate,
  onPoint,
  itemRef,
}: {
  item: IndexedImage;
  selected: boolean;
  disabled: boolean;
  onActivate: () => void;
  onPoint: () => void;
  itemRef: (element: HTMLButtonElement | null) => void;
}) {
  const styles = useStyles();
  const { source, failed } = useThumbnail(item.id, 128);
  // 静态缩略图本身解码失败（本地 state，GIF 回退由 useGifPreview 处理）。
  const [imageFailed, setImageFailed] = useState(false);
  // 选中态 = 鼠标 hover（onMouseEnter→onPoint）+ 键盘高亮，一套状态覆盖两种输入。
  const { gifSrc, handleGifError } = useGifPreview(item, selected);
  const showPlaceholder = !source || failed || imageFailed;

  return (
    <button
      ref={itemRef}
      type="button"
      role="option"
      tabIndex={-1}
      className={mergeClasses(styles.item, selected && styles.selected)}
      aria-selected={selected}
      disabled={disabled}
      title={item.name}
      onMouseEnter={onPoint}
      onClick={onActivate}
    >
      <span className={styles.frame}>
        {source && !showPlaceholder ? (
          <img
            className={styles.image}
            src={gifSrc ?? source}
            alt={item.name}
            loading="lazy"
            decoding="async"
            onError={gifSrc ? handleGifError : () => setImageFailed(true)}
          />
        ) : (
          <Image20Regular className={styles.placeholder} />
        )}
      </span>
      <span className={styles.fileName}>{item.name}</span>
    </button>
  );
}

export function QuickSearchContent({
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
  loading = false,
  error,
  copyError,
  copyingPath,
  activationId,
  onSelect,
  onClose,
}: QuickSearchContentProps) {
  const styles = useStyles();
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const copying = Boolean(copyingPath);

  const confirmItem = useCallback((item: IndexedImage | undefined) => {
    if (!item || copying) return;
    onSelect(item);
  }, [copying, onSelect]);

  const { selectedIndex, setSelectedIndex, handleKeyDown } = useSearchKeyboard({
    itemCount: results.length,
    columnCount: COLUMN_COUNT,
    onConfirm: (index) => confirmItem(results[index]),
    onClose,
  });

  useEffect(() => {
    setSelectedIndex(0);
    itemRefs.current = [];
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
  }, [activationId, selectedGroupId, setSelectedIndex]);

  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const trimmedQuery = query.trim();

  // 状态行：展示当前是 搜索结果 / 分组浏览 / 最近使用。首屏加载与出错时不显示。
  let statusText = "";
  if (!loading && !error && total > 0) {
    if (trimmedQuery) {
      statusText = `搜索 “${trimmedQuery}” · ${total} 张结果`;
    } else {
      const group = pinnedGroups.find((candidate) => candidate.id === selectedGroupId);
      statusText = group
        ? `分组「${group.name}」 · ${total} 张`
        : `最近使用 · ${total} 张`;
    }
  }

  return (
    // 每次唤起（activationId 变化）整体重挂载，触发一次性入场：150ms 上浮 8px +
    // 淡入（复制成功后 500ms 自动关窗，入场必须留足操作窗口，时长硬约束 ≤150ms）。
    // 重挂载顺带重置选中/焦点，与 activationId effect 语义等价；useQuickSearchQuery
    // 活在父层 QuickSearchWindow，不受影响。窗口本体 show/hide 是 Tauri 原生行为。
    // 分组行/状态行在关键词输入时只重渲染、不随 key 变化重挂载（入场动画只在唤起时播）。
    <Slide key={activationId} visible appear duration={motionTokens.durationFast} outY="-8px">
      <div ref={rootRef} className={styles.root} onKeyDown={handleKeyDown} aria-busy={copying}>
      <SearchBox
        className={styles.search}
        size="large"
        autoFocus
        aria-label="快速搜索表情"
        contentBefore={<Search20Regular />}
        placeholder="搜索表情、标签或分组（组*标签）"
        value={query}
        disabled={copying}
        onChange={(_: SearchBoxChangeEvent, data: { value: string }) => {
          onQueryChange(data.value);
          setSelectedIndex(0);
        }}
      />

      {pinnedGroups.length > 0 ? (
        <div className={styles.groupRow} role="tablist" aria-label="置顶分组">
          <Button
            className={styles.groupChip}
            size="small"
            appearance={selectedGroupId === null ? "primary" : "secondary"}
            disabled={copying}
            onClick={() => onSelectGroup(null)}
          >
            全部
          </Button>
          {pinnedGroups.map((group) => {
            const Icon = getGroupIcon(group.icon);
            return (
              <Button
                key={group.id}
                className={styles.groupChip}
                size="small"
                appearance={selectedGroupId === group.id ? "primary" : "secondary"}
                icon={<Icon />}
                disabled={copying}
                title={group.name}
                onClick={() => onSelectGroup(group.id)}
              >
                {group.name}
              </Button>
            );
          })}
        </div>
      ) : null}

      <div className={styles.status}>{statusText || null}</div>

      <div className={styles.results} data-no-window-drag>
        {results.length > 0 ? (
          <>
            <div className={styles.grid} role="listbox" aria-label="快速搜索结果，空搜索时最近使用优先">
              {results.map((item, index) => (
                <QuickSearchItem
                  key={item.id}
                  item={item}
                  selected={index === selectedIndex}
                  disabled={copying}
                  itemRef={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  onPoint={() => setSelectedIndex(index)}
                  onActivate={() => confirmItem(item)}
                />
              ))}
            </div>
            {hasMore ? (
              <div className={styles.loadMoreWrap}>
                <Button
                  size="small"
                  appearance="secondary"
                  // tabIndex -1：Enter 由根容器统一拦截为「复制选中项」，不触发按钮点击。
                  tabIndex={-1}
                  disabled={copying || loadingMore}
                  onClick={onLoadMore}
                >
                  {loadingMore ? "加载中…" : `加载更多（已显示 ${results.length}/${total}）`}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.empty}>
            {loading ? (
              <span>正在搜索...</span>
            ) : error ? (
              <span>{error}</span>
            ) : trimmedQuery ? (
              <span>没有找到匹配 {trimmedQuery} 的表情</span>
            ) : (
              <span>还没有表情，请先在主窗口导入图片或文件夹</span>
            )}
          </div>
        )}
      </div>

      <div className={styles.footer} role={copyError ? "alert" : undefined}>
        {copying ? (
          <span>正在写入 Windows 图片剪贴板...</span>
        ) : copyError ? (
          <span className={styles.error}>{copyError}</span>
        ) : (
          <>
            <span><span className={styles.key}>↑↓</span> 选择</span>
            <span><span className={styles.key}>Enter</span> 复制</span>
            <span><span className={styles.key}>Esc</span> 关闭</span>
          </>
        )}
      </div>
    </div>
    </Slide>
  );
}
