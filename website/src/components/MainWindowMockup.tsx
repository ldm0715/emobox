import {
  Badge,
  Button,
  Divider,
  Dropdown,
  FluentProvider,
  Menu,
  MenuButton,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  SearchBox,
  ToggleButton,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  Apps20Regular,
  ArrowClockwise20Regular,
  CheckboxChecked20Regular,
  CheckboxUnchecked20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  ClipboardImage20Regular,
  Copy20Regular,
  Delete24Regular,
  Dismiss16Regular,
  EmojiMeme24Regular,
  EmojiSad24Regular,
  Folder24Regular,
  FolderAdd20Regular,
  Grid20Filled,
  Grid20Regular,
  GridDots20Regular,
  History24Regular,
  ImageAdd20Regular,
  ImageMultiple24Regular,
  Keyboard24Regular,
  Maximize16Regular,
  MoreHorizontal20Regular,
  PanelLeftContract24Regular,
  PanelLeftExpand24Regular,
  Pin16Regular,
  Search20Regular,
  Settings24Regular,
  Star20Filled,
  Star20Regular,
  Star24Regular,
  SubtractRegular,
  Tag20Regular,
  Delete20Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
  Desktop20Regular,
} from "@fluentui/react-icons";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SettingsMockup } from "./SettingsMockup";
import { useSiteThemeContext } from "../themeContext";
import { darkTheme, lightTheme } from "../theme";
import type { ThemePreference } from "../useSiteTheme";
import logoUrl from "../assets/logo.png";
import { COW_STICKERS, FISH_STICKERS, matchStickerQuery, type StickerRef } from "../mockStickers";
import { StickerImage } from "./StickerImage";

/* ------------------------------------------------------------------ */
/* 数据层（演示用本地 state，不持久化、不写剪贴板）                       */
/* ------------------------------------------------------------------ */

type MockGroupId = "cow" | "fish";

type MockItem = {
  id: number;
  img: string;
  name: string;
  gif?: boolean;
  tags: string[];
  groups: MockGroupId[];
  favorite?: boolean;
  deleted?: boolean;
  addedSeq: number;
};

type MockView = "all" | "recent" | "favorites" | "group:cow" | "group:fish" | "ungrouped" | "trash";
type MockSort = "added-time" | "modified-time" | "name-asc" | "name-desc" | "format";
type MockDensity = "compact" | "comfortable" | "large";

function stickerItem(id: number, sticker: StickerRef, groups: MockGroupId[]): MockItem {
  return { id, img: sticker.src, name: sticker.name, gif: sticker.gif, tags: [], groups, addedSeq: id };
}

// 用真实贴纸生成演示素材：抽象草地牛 一组、蓝色大肥鱼 一组。
const INITIAL_ITEMS: MockItem[] = [
  ...COW_STICKERS.map((sticker, index) => stickerItem(index + 1, sticker, ["cow"])),
  ...FISH_STICKERS.map((sticker, index) => stickerItem(COW_STICKERS.length + index + 1, sticker, ["fish"])),
];

// 「导入」按钮的模拟素材池（取两组里未在首屏展示顺序靠后的几张；用尽即提示）。
const IMPORT_POOL: Omit<MockItem, "id" | "addedSeq">[] = [
  ...COW_STICKERS.slice(0, 5).map((sticker) => ({
    img: sticker.src,
    name: sticker.name,
    gif: sticker.gif,
    tags: [] as string[],
    groups: [] as MockGroupId[],
  })),
  ...FISH_STICKERS.slice(0, 4).map((sticker) => ({
    img: sticker.src,
    name: sticker.name,
    gif: sticker.gif,
    tags: [] as string[],
    groups: [] as MockGroupId[],
  })),
];

const GROUP_META: { id: MockGroupId; label: string }[] = [
  { id: "cow", label: "抽象草地牛" },
  { id: "fish", label: "蓝色大肥鱼" },
];

// 分组名与「多词 AND + 组/名/标签」搜索逻辑统一放在 ../mockStickers（matchStickerQuery）。

const SORT_OPTIONS: { value: MockSort; label: string }[] = [
  { value: "added-time", label: "按添加时间" },
  { value: "modified-time", label: "按修改时间" },
  { value: "name-asc", label: "名称 A–Z" },
  { value: "name-desc", label: "名称 Z–A" },
  { value: "format", label: "文件格式" },
];

const DENSITY_TILE: Record<MockDensity, string> = {
  compact: "104px",
  comfortable: "128px",
  large: "152px",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/* ------------------------------------------------------------------ */
/* 样式（对照应用源码 1:1）                                             */
/* ------------------------------------------------------------------ */

const useStyles = makeStyles({
  scrollOuter: {
    // 演示窗口按可用宽度等比缩放（transform），布局盒固定 1100×720 不变形；
    // clip 裁掉缩放前的布局溢出且不产生滚动条。
    overflowX: "clip",
  },
  stage: {
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
  },
  // 局部主题的嵌套 FluentProvider：不参与布局，仅在其子树内覆盖主题 token。
  mockProvider: {
    display: "contents",
  },
  // 演示窗口固定为应用默认尺寸 1100×720（内部布局永不缩放变形），
  // 显示时经 transform 等比缩放适配视口宽度。
  window: {
    width: "1100px",
    height: "720px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow16,
    overflow: "hidden",
    textAlign: "left",
    transformOrigin: "top center",
  },
  titleBar: {
    height: "32px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingLeft: "12px",
    paddingRight: "4px",
  },
  titleBarLogo: {
    width: "14px",
    height: "14px",
    display: "block",
  },
  titleBarText: {
    flex: 1,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  windowControl: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "40px",
    height: "28px",
    border: "none",
    background: "transparent",
    borderRadius: tokens.borderRadiusSmall,
    cursor: "pointer",
    color: tokens.colorNeutralForeground3,
    ":hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground2,
    },
    "& svg": {
      width: "14px",
      height: "14px",
    },
  },

  // 工具栏：首列随侧栏折叠 232px ↔ 104px（应用 AppToolbar 同款过渡）
  toolbar: {
    height: "54px",
    display: "grid",
    gridTemplateColumns: "232px minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalM,
    paddingLeft: tokens.spacingHorizontalXS,
    paddingRight: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    transitionProperty: "grid-template-columns",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
  },
  toolbarCollapsed: {
    gridTemplateColumns: "104px minmax(0, 1fr) auto",
  },
  toolbarBrand: {
    display: "flex",
    alignItems: "center",
  },
  toolbarToggle: {
    marginLeft: tokens.spacingHorizontalXS,
  },
  searchWrap: {
    minWidth: 0,
    width: "100%",
    maxWidth: "540px",
    justifySelf: "center",
  },
  search: {
    width: "100%",
    ...shorthands.borderColor(tokens.colorNeutralStroke1),
  },
  toolbarActions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },

  // 主体
  body: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "232px minmax(0, 1fr)",
    backgroundColor: tokens.colorNeutralBackground1,
    transitionProperty: "grid-template-columns",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
  },
  bodyCollapsed: {
    gridTemplateColumns: "56px minmax(0, 1fr)",
  },

  // 侧栏（LibrarySidebar）
  sidebar: {
    display: "flex",
    flexDirection: "column",
    padding: `${tokens.spacingVerticalSNudge} ${tokens.spacingHorizontalS}`,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0,
    overflow: "hidden",
  },
  sidebarCollapsed: {
    paddingLeft: "6px",
    paddingRight: "6px",
  },
  navGroup: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  navItem: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr) auto auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    width: "100%",
    minHeight: "28px",
    padding: `0 ${tokens.spacingHorizontalM}`,
    border: "none",
    background: "transparent",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    ":hover": {
      color: tokens.colorNeutralForeground1,
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
  },
  navItemCollapsed: {
    width: "44px",
    gridTemplateColumns: "1fr",
    justifyItems: "center",
    padding: "0",
  },
  navItemSelected: {
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    "& > svg": {
      color: tokens.colorBrandForeground1,
    },
    "&::before": {
      content: '""',
      position: "absolute",
      left: "0",
      top: "50%",
      transform: "translateY(-50%)",
      width: "3px",
      height: "18px",
      borderRadius: tokens.borderRadiusCircular,
      backgroundColor: tokens.colorBrandStroke1,
    },
  },
  navLabel: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  navLabelText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pinIcon: {
    flexShrink: 0,
  },
  divider: {
    flexGrow: 0,
    flexShrink: 0,
    marginTop: tokens.spacingVerticalS,
    marginBottom: tokens.spacingVerticalS,
  },
  groupHeader: {
    width: "100%",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: tokens.spacingHorizontalXS,
    paddingRight: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  groupHeaderToggle: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalXS}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: tokens.borderRadiusSmall,
    cursor: "pointer",
    ":hover": {
      color: tokens.colorNeutralForeground2,
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  groupHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  groupList: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    alignContent: "start",
  },
  bottom: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
  },
  hintButton: {
    width: "100%",
    minHeight: "32px",
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr)",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `0 ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground2,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    ":hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
  },
  hintButtonCollapsed: {
    width: "44px",
    gridTemplateColumns: "1fr",
    justifyItems: "center",
    padding: "0",
  },
  shortcut: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },

  // 内容区
  main: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    minHeight: 0,
  },
  contentScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
  },
  mainHeader: {
    minWidth: 0,
    minHeight: "72px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  mainTitle: {
    margin: "0",
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    lineHeight: tokens.lineHeightBase500,
  },
  mainSubtitle: {
    marginTop: "2px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  mainActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalXS,
  },
  dropdownMin: {
    minWidth: "126px",
  },
  densityGroup: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "2px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },

  // 网格（tile 尺寸随密度切换）
  grid: {
    display: "grid",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL}`,
    alignContent: "start",
  },
  empty: {
    minHeight: "240px",
    display: "grid",
    placeItems: "center",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    textAlign: "center",
  },
  emptyInner: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalS,
  },

  // 卡片（EmojiGridItem）
  tile: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    cursor: "default",
    padding: "0",
    fontFamily: "inherit",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
    ":hover .tile-actions": {
      opacity: 1,
    },
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "2px",
    },
  },
  tileSelected: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    boxShadow: `0 0 0 1px ${tokens.colorBrandStroke1}`,
  },
  tileFrame: {
    position: "relative",
    aspectRatio: "1 / 1",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    padding: "6px",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  tileImg: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  tileGifBadge: {
    position: "absolute",
    top: tokens.spacingVerticalXS,
    left: tokens.spacingHorizontalXS,
    zIndex: 2,
  },
  tileCheckbox: {
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
    pointerEvents: "none",
  },
  tileCheckboxChecked: {
    backgroundColor: tokens.colorBrandBackground,
  },
  tileActions: {
    position: "absolute",
    top: tokens.spacingVerticalXS,
    right: tokens.spacingHorizontalXS,
    zIndex: 4,
    display: "flex",
    gap: "2px",
    opacity: 0,
  },
  tileActionButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    borderRadius: tokens.borderRadiusMedium,
    border: "none",
    cursor: "pointer",
    color: "white",
    backgroundColor: "rgba(24, 24, 27, 0.66)",
    ":hover": {
      backgroundColor: "rgba(24, 24, 27, 0.82)",
    },
    "& svg": {
      width: "16px",
      height: "16px",
    },
  },
  captionRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    minWidth: 0,
    padding: `0 ${tokens.spacingHorizontalS} ${tokens.spacingVerticalXXS}`,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  captionSelected: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  captionText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tagRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    minWidth: 0,
    padding: `0 ${tokens.spacingHorizontalS} ${tokens.spacingVerticalXS}`,
  },

  // 批量条（应用 .content 底部浮出样式）
  bulkBar: {
    position: "sticky",
    bottom: "0",
    zIndex: 5,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow8,
  },
  bulkCount: {
    marginRight: "auto",
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },

  // 窗口内 toast（模拟应用右上角通知；Fluent Toaster 是页面级 portal，这里自绘）
  toastLayer: {
    position: "absolute",
    top: "44px",
    right: "16px",
    zIndex: 30,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "8px",
    pointerEvents: "none",
  },
  toast: {
    maxWidth: "360px",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
    animationName: {
      from: { opacity: "0", transform: "translateY(-8px)" },
      to: { opacity: "1", transform: "translateY(0)" },
    },
    animationDuration: tokens.durationFast,
    animationTimingFunction: tokens.curveEasyEase,
  },

  // 设置弹层：覆盖在演示窗口内部（应用内是模态弹窗，不弹到页面层）
  settingsLayer: {
    position: "absolute",
    inset: "0",
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
});

/* ------------------------------------------------------------------ */
/* 小组件                                                              */
/* ------------------------------------------------------------------ */

function SidebarItem(props: {
  icon: ReactNode;
  label: string;
  count?: string;
  outlineBadge?: boolean;
  selected?: boolean;
  pinned?: boolean;
  collapsed?: boolean;
  onSelect: () => void;
}) {
  const styles = useStyles();
  return (
    <button
      type="button"
      title={props.collapsed ? props.label : undefined}
      aria-current={props.selected ? "page" : undefined}
      className={mergeClasses(
        styles.navItem,
        props.collapsed && styles.navItemCollapsed,
        props.selected && styles.navItemSelected,
      )}
      onClick={props.onSelect}
    >
      {props.icon}
      {!props.collapsed && (
        <span className={styles.navLabel}>
          {props.pinned ? <Pin16Regular className={styles.pinIcon} aria-hidden /> : null}
          <span className={styles.navLabelText}>{props.label}</span>
        </span>
      )}
      {!props.collapsed && props.count ? (
        <Badge size="small" appearance={props.outlineBadge ? "outline" : "tint"}>
          {props.count}
        </Badge>
      ) : null}
    </button>
  );
}

function EmptyState(props: { icon: ReactNode; text: string }) {
  const styles = useStyles();
  return (
    <div className={styles.empty}>
      <div className={styles.emptyInner}>
        {props.icon}
        <span>{props.text}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 主窗口原型（可交互演示）                                             */
/* ------------------------------------------------------------------ */

export function MainWindowMockup() {
  const styles = useStyles();
  const { resolved } = useSiteThemeContext();

  // 演示窗口按可用宽度等比缩放显示（布局盒固定 1100×720，内部不 reflow）。
  const scrollOuterRef = useRef<HTMLDivElement>(null);
  const [displayScale, setDisplayScale] = useState(1);

  useEffect(() => {
    const el = scrollOuterRef.current;
    if (!el) return;
    const update = () => setDisplayScale(Math.min(1, el.clientWidth / 1100));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 演示窗口的局部主题：与应用语义一致（浅/深/跟随系统），只作用于窗口内部，
  // 不影响网站页面（外层 FluentProvider 不变）。
  const [mockTheme, setMockTheme] = useState<ThemePreference>("system");
  const mockResolved = mockTheme === "system" ? resolved : mockTheme;

  // 窗口内 toast：模拟应用右上角通知，2.6s 自动消失
  const [toasts, setToasts] = useState<{ id: number; title: string }[]>([]);
  const nextToastIdRef = useMemo(() => ({ current: 1 }), []);

  function notify(title: string) {
    const id = nextToastIdRef.current++;
    setToasts((prev) => [...prev.slice(-2), { id, title }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 2600);
  }

  const [items, setItems] = useState<MockItem[]>(INITIAL_ITEMS);
  const [view, setView] = useState<MockView>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MockSort>("added-time");
  const [density, setDensity] = useState<MockDensity>("comfortable");
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [groupsCollapsed, setGroupsCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentIds, setRecentIds] = useState<number[]>([5, 2, 8]);
  const [importCursor, setImportCursor] = useState(0);
  const nextIdRef = useMemo(() => ({ current: 1000 }), []);


  /* ---------------- 派生：当前视图条目 ---------------- */

  const visibleItems = useMemo(() => {
    let list: MockItem[];
    switch (view) {
      case "recent":
        list = recentIds
          .map((id) => items.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is MockItem => Boolean(candidate) && !candidate!.deleted);
        break;
      case "favorites":
        list = items.filter((candidate) => candidate.favorite && !candidate.deleted);
        break;
      case "group:cow":
        list = items.filter((candidate) => candidate.groups.includes("cow") && !candidate.deleted);
        break;
      case "group:fish":
        list = items.filter((candidate) => candidate.groups.includes("fish") && !candidate.deleted);
        break;
      case "ungrouped":
        list = items.filter((candidate) => candidate.groups.length === 0 && !candidate.deleted);
        break;
      case "trash":
        list = items.filter((candidate) => candidate.deleted);
        break;
      default:
        list = items.filter((candidate) => !candidate.deleted);
    }

    const trimmed = query.trim().toLowerCase();
    if (trimmed) {
      list = list.filter((candidate) => matchStickerQuery(trimmed, candidate));
    }

    const sorted = [...list];
    switch (sort) {
      case "name-asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "format":
        sorted.sort(
          (a, b) => extensionOf(a.name).localeCompare(extensionOf(b.name)) || a.name.localeCompare(b.name),
        );
        break;
      case "modified-time":
        sorted.sort((a, b) => b.addedSeq - a.addedSeq);
        break;
      default:
        sorted.sort((a, b) => b.addedSeq - a.addedSeq);
    }
    return sorted;
  }, [items, view, query, sort, recentIds]);

  const counts = useMemo(
    () => ({
      all: items.filter((candidate) => !candidate.deleted).length,
      favorites: items.filter((candidate) => candidate.favorite && !candidate.deleted).length,
      trash: items.filter((candidate) => candidate.deleted).length,
      cow: items.filter((candidate) => candidate.groups.includes("cow") && !candidate.deleted).length,
      fish: items.filter((candidate) => candidate.groups.includes("fish") && !candidate.deleted).length,
      ungrouped: items.filter((candidate) => candidate.groups.length === 0 && !candidate.deleted).length,
    }),
    [items],
  );

  const viewMeta = useMemo((): { title: string; count?: number } => {
    switch (view) {
      case "recent": {
        const recentCount = recentIds.filter((id) => {
          const found = items.find((candidate) => candidate.id === id);
          return Boolean(found) && !found!.deleted;
        }).length;
        return { title: "最近使用", count: recentCount };
      }
      case "favorites":
        return { title: "收藏", count: counts.favorites };
      case "group:cow":
        return { title: "抽象草地牛", count: counts.cow };
      case "group:fish":
        return { title: "蓝色大肥鱼", count: counts.fish };
      case "ungrouped":
        return { title: "未分组", count: counts.ungrouped };
      case "trash":
        return { title: "回收站", count: counts.trash };
      default:
        return { title: "全部表情", count: counts.all };
    }
  }, [view, counts, recentIds]);

  /* ---------------- 行为 ---------------- */

  function switchView(next: MockView) {
    setView(next);
    setSelectedIds(new Set());
    setMultiSelect(false);
  }

  function toggleSelect(id: number, mode: "toggle" | "replace") {
    setSelectedIds((prev) => {
      const next = new Set(mode === "replace" ? [] : prev);
      if (prev.has(id) && mode === "toggle") next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copyItem(target: MockItem) {
    setRecentIds((prev) => [target.id, ...prev.filter((id) => id !== target.id)].slice(0, 50));
    notify(`已复制 “${target.name}” 到剪贴板（演示）`);
  }

  function handleTileClick(target: MockItem, event: { ctrlKey?: boolean }) {
    if (multiSelect || event.ctrlKey) {
      toggleSelect(target.id, "toggle");
    } else if (view === "trash") {
      toggleSelect(target.id, "replace");
    } else {
      copyItem(target);
    }
  }

  function handleTileKeyDown(event: KeyboardEvent<HTMLElement>, target: MockItem) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleSelect(target.id, "replace");
  }

  function toggleFavorite(targets: MockItem[]) {
    const removing = targets.every((target) => target.favorite);
    setItems((prev) =>
      prev.map((candidate) =>
        targets.some((target) => target.id === candidate.id)
          ? { ...candidate, favorite: !candidate.favorite }
          : candidate,
      ),
    );
    if (view === "favorites" && removing) {
      setSelectedIds(new Set());
    }
    notify(removing ? `已取消收藏（${targets.length} 项）` : `已收藏（${targets.length} 项）`);
  }

  function moveToTrash(targets: MockItem[]) {
    setItems((prev) =>
      prev.map((candidate) =>
        targets.some((target) => target.id === candidate.id) ? { ...candidate, deleted: true } : candidate,
      ),
    );
    setSelectedIds(new Set());
    notify(`已移入回收站（${targets.length} 项）`);
  }

  function restoreFromTrash(targets: MockItem[]) {
    setItems((prev) =>
      prev.map((candidate) =>
        targets.some((target) => target.id === candidate.id) ? { ...candidate, deleted: false } : candidate,
      ),
    );
    setSelectedIds(new Set());
    notify(`已恢复（${targets.length} 项）`);
  }

  function deleteForever(targets: MockItem[]) {
    const ids = new Set(targets.map((target) => target.id));
    setItems((prev) => prev.filter((candidate) => !ids.has(candidate.id)));
    setSelectedIds(new Set());
    notify(`已彻底删除（${targets.length} 项）`);
  }

  function addToGroup(target: MockItem, group: MockGroupId) {
    setItems((prev) =>
      prev.map((candidate) =>
        candidate.id === target.id && !candidate.groups.includes(group)
          ? { ...candidate, groups: [...candidate.groups, group] }
          : candidate,
      ),
    );
    const label = GROUP_META.find((meta) => meta.id === group)?.label ?? group;
    notify(`已加入分组「${label}」`);
  }

  function removeFromGroup(target: MockItem, group: MockGroupId) {
    setItems((prev) =>
      prev.map((candidate) =>
        candidate.id === target.id
          ? { ...candidate, groups: candidate.groups.filter((id) => id !== group) }
          : candidate,
      ),
    );
    const label = GROUP_META.find((meta) => meta.id === group)?.label ?? group;
    notify(`已从分组「${label}」移除`);
  }

  function simulateImport() {
    const remaining = IMPORT_POOL.slice(importCursor);
    if (remaining.length === 0) {
      notify("演示素材池已用完，回回收站腾点地方吧");
      return;
    }
    const take = remaining.slice(0, 2 + Math.floor(Math.random() * 2));
    const targetGroup: MockGroupId | null =
      view === "group:cow" ? "cow" : view === "group:fish" ? "fish" : null;
    const created = take.map((proto, index) => ({
      ...proto,
      groups: targetGroup ? [targetGroup] : [],
      id: nextIdRef.current + index,
      addedSeq: nextIdRef.current + index,
    }));
    nextIdRef.current += take.length;
    setImportCursor((prev) => prev + take.length);
    setItems((prev) => [...prev, ...created]);
    notify(
      targetGroup
        ? `已导入 ${take.length} 张表情并加入当前分组（演示）`
        : `已导入 ${take.length} 张表情（演示）`,
    );
  }

  function selectAllLoaded() {
    const everythingSelected = visibleItems.length > 0 && visibleItems.every((target) => selectedIds.has(target.id));
    setSelectedIds(
      everythingSelected ? new Set() : new Set(visibleItems.map((target) => target.id)),
    );
  }

  /* ---------------- 渲染 ---------------- */

  const selectedItems = visibleItems.filter((target) => selectedIds.has(target.id));
  const showBulkBar = multiSelect && selectedItems.length >= 1;
  const allSelected = visibleItems.length > 0 && visibleItems.every((target) => selectedIds.has(target.id));

  return (
    <div className={styles.scrollOuter} ref={scrollOuterRef}>
      <div className={styles.stage} style={{ height: `calc(720px * ${displayScale} + 32px)` }}>
      <div
        className={styles.window}
        style={{ transform: `scale(${displayScale})`, colorScheme: mockResolved }}
        aria-label="EmoBox 主窗口界面演示（可交互，1100×720 固定布局）"
      >
        <FluentProvider
          theme={mockResolved === "dark" ? darkTheme : lightTheme}
          className={styles.mockProvider}
        >
        {/* Windows 标题栏（示意） */}
        <div className={styles.titleBar}>
          <img className={styles.titleBarLogo} src={logoUrl} alt="" aria-hidden />
          <span className={styles.titleBarText}>EmoBox</span>
          <button
            type="button"
            className={styles.windowControl}
            aria-label="最小化（示意）"
            onClick={() => notify("窗口控制仅为界面演示")}
          >
            <SubtractRegular />
          </button>
          <button
            type="button"
            className={styles.windowControl}
            aria-label="最大化（示意）"
            onClick={() => notify("窗口控制仅为界面演示")}
          >
            <Maximize16Regular />
          </button>
          <button
            type="button"
            className={styles.windowControl}
            aria-label="关闭（示意）"
            onClick={() => notify("演示站点没有可关闭的窗口 :)")}
          >
            <Dismiss16Regular />
          </button>
        </div>

        {/* 工具栏 */}
        <div className={mergeClasses(styles.toolbar, sidebarCollapsed && styles.toolbarCollapsed)}>
          <div className={styles.toolbarBrand}>
            <Button
              className={styles.toolbarToggle}
              appearance="subtle"
              aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
              icon={sidebarCollapsed ? <PanelLeftExpand24Regular /> : <PanelLeftContract24Regular />}
              onClick={() => setSidebarCollapsed((prev) => !prev)}
            />
          </div>
          <div className={styles.searchWrap}>
            <SearchBox
              className={styles.search}
              aria-label="搜索表情、标签或文件名"
              contentBefore={<Search20Regular />}
              placeholder="搜索表情、标签或分组（组*标签）"
              value={query}
              onChange={(_, data) => setQuery(data.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
            />
          </div>
          <div className={styles.toolbarActions}>
            <Menu positioning="below-end">
              <MenuTrigger disableButtonEnhancement>
                <MenuButton appearance="primary" icon={<FolderAdd20Regular />}>
                  导入
                </MenuButton>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<ImageAdd20Regular />} onClick={simulateImport}>
                    导入图片
                  </MenuItem>
                  <MenuItem icon={<FolderAdd20Regular />} onClick={simulateImport}>
                    导入文件夹（自动建分组）
                  </MenuItem>
                  <MenuItem icon={<ClipboardImage20Regular />} onClick={simulateImport}>
                    从剪贴板收藏
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            <Menu
              positioning="below-end"
              checkedValues={{ theme: [mockTheme] }}
              onCheckedValueChange={(_, data) => setMockTheme(data.checkedItems[0] as ThemePreference)}
            >
              <MenuTrigger disableButtonEnhancement>
                <Button
                  appearance="subtle"
                  aria-label="切换演示窗口主题"
                  title="切换演示窗口主题（不影响网站）"
                  icon={
                    mockTheme === "dark" || (mockTheme === "system" && mockResolved === "dark") ? (
                      <WeatherMoon20Regular />
                    ) : (
                      <WeatherSunny20Regular />
                    )
                  }
                />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItemRadio name="theme" value="light" icon={<WeatherSunny20Regular />}>
                    浅色
                  </MenuItemRadio>
                  <MenuItemRadio name="theme" value="dark" icon={<WeatherMoon20Regular />}>
                    深色
                  </MenuItemRadio>
                  <MenuItemRadio name="theme" value="system" icon={<Desktop20Regular />}>
                    跟随系统
                  </MenuItemRadio>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        </div>

        {/* 主体 */}
        <div className={mergeClasses(styles.body, sidebarCollapsed && styles.bodyCollapsed)}>
          <div className={mergeClasses(styles.sidebar, sidebarCollapsed && styles.sidebarCollapsed)}>
            <div className={styles.navGroup}>
              <SidebarItem
                icon={<ImageMultiple24Regular />}
                label="全部表情"
                count={String(counts.all)}
                selected={view === "all"}
                collapsed={sidebarCollapsed}
                onSelect={() => switchView("all")}
              />
              <SidebarItem
                icon={<History24Regular />}
                label="最近使用"
                selected={view === "recent"}
                collapsed={sidebarCollapsed}
                onSelect={() => switchView("recent")}
              />
              <SidebarItem
                icon={<Star24Regular />}
                label="收藏"
                count={counts.favorites > 0 ? String(counts.favorites) : undefined}
                selected={view === "favorites"}
                collapsed={sidebarCollapsed}
                onSelect={() => switchView("favorites")}
              />
            </div>
            <Divider className={styles.divider} />
            {!sidebarCollapsed && (
              <div className={styles.groupHeader}>
                <button
                  type="button"
                  className={styles.groupHeaderToggle}
                  aria-expanded={!groupsCollapsed}
                  onClick={() => setGroupsCollapsed((prev) => !prev)}
                >
                  {groupsCollapsed ? <ChevronRight20Regular /> : <ChevronDown20Regular />}
                  我的分组
                </button>
                <div className={styles.groupHeaderActions}>
                  <Button
                    size="small"
                    appearance="subtle"
                    aria-label="搜索分组"
                    icon={<Search20Regular />}
                    onClick={() => notify("分组搜索需在真实应用中使用（演示不包含）")}
                  />
                  <Button
                    size="small"
                    appearance="subtle"
                    aria-label="新建分组"
                    icon={<Add20Regular />}
                    onClick={() => notify("新建分组需在真实应用中使用（演示不包含）")}
                  />
                </div>
              </div>
            )}
            {/* 分组区容器常驻（它也是把底部导航顶到侧栏底部的弹性区），收起只隐藏分组条目 */}
            <div className={styles.groupList}>
              {!groupsCollapsed &&
                GROUP_META.map((meta) => (
                  <SidebarItem
                    key={meta.id}
                    icon={meta.id === "cow" ? <EmojiMeme24Regular /> : <Folder24Regular />}
                    label={meta.label}
                    count={String(meta.id === "cow" ? counts.cow : counts.fish)}
                    outlineBadge
                    pinned={meta.id === "cow"}
                    selected={view === `group:${meta.id}`}
                    collapsed={sidebarCollapsed}
                    onSelect={() => switchView(`group:${meta.id}`)}
                  />
                ))}
            </div>
            <Divider className={styles.divider} />
            <div className={styles.navGroup}>
              <SidebarItem
                icon={<Folder24Regular />}
                label="未分组"
                selected={view === "ungrouped"}
                collapsed={sidebarCollapsed}
                onSelect={() => switchView("ungrouped")}
              />
              <SidebarItem
                icon={<Delete24Regular />}
                label="回收站"
                count={counts.trash > 0 ? String(counts.trash) : undefined}
                selected={view === "trash"}
                collapsed={sidebarCollapsed}
                onSelect={() => switchView("trash")}
              />
            </div>
            <Divider className={styles.divider} />
            <div className={styles.bottom}>
              <button
                type="button"
                className={mergeClasses(styles.hintButton, sidebarCollapsed && styles.hintButtonCollapsed)}
                title={sidebarCollapsed ? "Ctrl+Alt+Space" : undefined}
                onClick={() => notify("Ctrl+Alt+Space 在应用内唤起快捷搜索（演示站点）")}
              >
                <Keyboard24Regular />
                {!sidebarCollapsed && <span className={styles.shortcut}>Ctrl+Alt+Space</span>}
              </button>
              <Divider className={styles.divider} />
              <button
                type="button"
                className={mergeClasses(styles.hintButton, sidebarCollapsed && styles.hintButtonCollapsed)}
                title={sidebarCollapsed ? "设置" : undefined}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings24Regular />
                {!sidebarCollapsed && <span className={styles.shortcut}>设置</span>}
              </button>
            </div>
          </div>

          <div className={styles.main}>
            <div className={styles.mainHeader}>
              <div>
                <h2 className={styles.mainTitle}>{viewMeta.title}</h2>
                <div className={styles.mainSubtitle}>共 {viewMeta.count ?? 0} 张表情</div>
              </div>
              <div className={styles.mainActions}>
                <Button
                  size="small"
                  appearance="subtle"
                  aria-label="刷新图库"
                  icon={<ArrowClockwise20Regular />}
                  onClick={() => notify("图库已是最新（演示）")}
                />
                <ToggleButton
                  size="small"
                  checked={multiSelect}
                  icon={multiSelect ? <CheckboxChecked20Regular /> : <CheckboxUnchecked20Regular />}
                  onClick={() => {
                    setMultiSelect((prev) => !prev);
                    setSelectedIds(new Set());
                  }}
                >
                  多选
                </ToggleButton>
                {multiSelect && (
                  <Button size="small" onClick={selectAllLoaded}>
                    {allSelected ? "取消全选" : "全选"}
                  </Button>
                )}
                <Dropdown
                  className={styles.dropdownMin}
                  size="small"
                  aria-label="排序方式"
                  value={SORT_OPTIONS.find((option) => option.value === sort)?.label}
                  selectedOptions={[sort]}
                  onOptionSelect={(_, data) => data.optionValue && setSort(data.optionValue as MockSort)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <Option key={option.value} value={option.value}>
                      {option.label}
                    </Option>
                  ))}
                </Dropdown>
                <div className={styles.densityGroup} aria-label="网格密度">
                  <Button
                    size="small"
                    appearance={density === "compact" ? "subtle" : "transparent"}
                    aria-pressed={density === "compact"}
                    icon={<GridDots20Regular />}
                    onClick={() => setDensity("compact")}
                  />
                  <Button
                    size="small"
                    appearance={density === "comfortable" ? "subtle" : "transparent"}
                    aria-pressed={density === "comfortable"}
                    icon={density === "comfortable" ? <Grid20Filled /> : <Grid20Regular />}
                    onClick={() => setDensity("comfortable")}
                  />
                  <Button
                    size="small"
                    appearance={density === "large" ? "subtle" : "transparent"}
                    aria-pressed={density === "large"}
                    icon={<Apps20Regular />}
                    onClick={() => setDensity("large")}
                  />
                </div>
              </div>
            </div>

            <div className={styles.contentScroll}>
              {visibleItems.length === 0 ? (
                query.trim() ? (
                  <EmptyState icon={<Search20Regular />} text={`没有找到 “${query.trim()}” 相关的表情`} />
                ) : view === "trash" ? (
                  <EmptyState icon={<Delete24Regular />} text="回收站是空的" />
                ) : view === "favorites" ? (
                  <EmptyState icon={<Star24Regular />} text="还没有收藏" />
                ) : view === "recent" ? (
                  <EmptyState icon={<History24Regular />} text="暂无最近使用" />
                ) : view === "ungrouped" ? (
                  <EmptyState icon={<Folder24Regular />} text="所有表情都已分组" />
                ) : (
                  <EmptyState icon={<EmojiSad24Regular />} text="这里还没有表情，点工具栏「导入」试试" />
                )
              ) : (
                <div
                  className={styles.grid}
                  style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${DENSITY_TILE[density]}, 1fr))` }}
                >
                {visibleItems.map((tile) => {
                  const selected = selectedIds.has(tile.id);
                  return (
                    <div
                      key={tile.id}
                      role="option"
                      aria-selected={selected}
                      tabIndex={0}
                      className={mergeClasses(styles.tile, selected && styles.tileSelected)}
                      onClick={(event) => handleTileClick(tile, event)}
                      onKeyDown={(event) => handleTileKeyDown(event, tile)}
                    >
                      <div className={styles.tileFrame}>
                        {tile.gif ? (
                          <span className={styles.tileGifBadge}>
                            <Badge size="small" appearance="filled">
                              GIF
                            </Badge>
                          </span>
                        ) : null}
                        {multiSelect && (
                          <span
                            className={mergeClasses(styles.tileCheckbox, selected && styles.tileCheckboxChecked)}
                          >
                            {selected ? <CheckboxChecked20Regular /> : <CheckboxUnchecked20Regular />}
                          </span>
                        )}
                        <span className={`${styles.tileActions} tile-actions`} onClick={(event) => event.stopPropagation()}>
                          {view !== "trash" && (
                            <button
                              type="button"
                              className={styles.tileActionButton}
                              aria-label={tile.favorite ? "取消收藏" : "收藏"}
                              title={tile.favorite ? "取消收藏" : "收藏"}
                              onClick={() => toggleFavorite([tile])}
                            >
                              {tile.favorite ? <Star20Filled /> : <Star20Regular />}
                            </button>
                          )}
                          {view !== "trash" && (
                            <button
                              type="button"
                              className={styles.tileActionButton}
                              aria-label="复制"
                              title="复制"
                              onClick={() => copyItem(tile)}
                            >
                              <Copy20Regular />
                            </button>
                          )}
                          <Menu positioning="below-end">
                            <MenuTrigger disableButtonEnhancement>
                              <button
                                type="button"
                                className={styles.tileActionButton}
                                aria-label="更多操作"
                                title="更多操作"
                              >
                                <MoreHorizontal20Regular />
                              </button>
                            </MenuTrigger>
                            <MenuPopover>
                              {view === "trash" ? (
                                <MenuList>
                                  <MenuItem icon={<History24Regular />} onClick={() => restoreFromTrash([tile])}>
                                    恢复
                                  </MenuItem>
                                  <MenuItem icon={<Delete24Regular />} onClick={() => deleteForever([tile])}>
                                    彻底删除
                                  </MenuItem>
                                </MenuList>
                              ) : (
                                <MenuList>
                                  {GROUP_META.map((meta) =>
                                    tile.groups.includes(meta.id) ? (
                                      <MenuItem
                                        key={meta.id}
                                        icon={<Folder24Regular />}
                                        onClick={() => removeFromGroup(tile, meta.id)}
                                      >
                                        从「{meta.label}」移除
                                      </MenuItem>
                                    ) : (
                                      <MenuItem
                                        key={meta.id}
                                        icon={<FolderAdd20Regular />}
                                        onClick={() => addToGroup(tile, meta.id)}
                                      >
                                        加入「{meta.label}」
                                      </MenuItem>
                                    ),
                                  )}
                                  <MenuItem
                                    icon={<Tag20Regular />}
                                    onClick={() => notify("标签管理需在真实应用中使用（演示不包含）")}
                                  >
                                    管理标签
                                  </MenuItem>
                                  <MenuItem icon={<Delete20Regular />} onClick={() => moveToTrash([tile])}>
                                    移入回收站
                                  </MenuItem>
                                </MenuList>
                              )}
                            </MenuPopover>
                          </Menu>
                        </span>
                        <StickerImage className={styles.tileImg} src={tile.img} gif={tile.gif} />
                      </div>
                      <div className={mergeClasses(styles.captionRow, selected && styles.captionSelected)}>
                        <span className={styles.captionText} title={tile.name}>
                          {tile.name}
                        </span>
                      </div>
                      {tile.tags.length > 0 && (
                        <div className={styles.tagRow}>
                          {tile.tags.slice(0, 2).map((tag) => (
                            <Badge key={tag} size="small" appearance="tint">
                              {tag}
                            </Badge>
                          ))}
                          {tile.tags.length > 2 && (
                            <Badge size="small" appearance="tint">
                              +{tile.tags.length - 2}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {showBulkBar && (
              <div className={styles.bulkBar}>
                <span className={styles.bulkCount}>已选 {selectedItems.length} 项</span>
                {view !== "trash" && (
                  <Button size="small" icon={<Star20Regular />} onClick={() => toggleFavorite(selectedItems)}>
                    {selectedItems.every((target) => target.favorite) ? "取消收藏" : "收藏"}
                  </Button>
                )}
                {view !== "trash" && (
                  <Button size="small" icon={<Delete20Regular />} onClick={() => moveToTrash(selectedItems)}>
                    移入回收站
                  </Button>
                )}
                {view === "trash" && (
                  <Button size="small" icon={<History24Regular />} onClick={() => restoreFromTrash(selectedItems)}>
                    恢复
                  </Button>
                )}
                {view === "trash" && (
                  <Button size="small" icon={<Delete24Regular />} onClick={() => deleteForever(selectedItems)}>
                    彻底删除
                  </Button>
                )}
                <Button
                  size="small"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setMultiSelect(false);
                  }}
                >
                  退出多选
                </Button>
                <Button size="small" onClick={() => setSelectedIds(new Set())}>
                  清除选择
                </Button>
              </div>
            )}
            </div>
          </div>
        </div>

        {/* 设置弹层：覆盖整个演示窗口（应用内是窗口级模态） */}
        {settingsOpen && (
          <div className={styles.settingsLayer}>
            <SettingsMockup
              open
              theme={mockTheme}
              onThemeChange={setMockTheme}
              onClose={() => setSettingsOpen(false)}
              onNotify={notify}
            />
          </div>
        )}

        {/* 窗口内 toast */}
        <div className={styles.toastLayer} aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={styles.toast}>
              {toast.title}
            </div>
          ))}
        </div>
        </FluentProvider>
      </div>
      </div>
    </div>
  );
}
