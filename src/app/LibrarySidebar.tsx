import {
  Badge,
  Button,
  Divider,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  Folder24Regular,
  History24Regular,
  ImageMultiple24Regular,
  Keyboard24Regular,
  Settings24Regular,
  Star24Regular,
} from "@fluentui/react-icons";
import type { ReactElement } from "react";
import { formatShortcutLabel } from "../config/shortcuts";
import type { LibraryGroup, LibraryView } from "../types";

interface LibrarySidebarProps {
  collapsed: boolean;
  currentView: LibraryView;
  allCount: number;
  favoriteCount: number;
  groups: LibraryGroup[];
  quickSearchShortcut: string;
  shortcutRegistered: boolean;
  onViewChange: (view: LibraryView) => void;
  onOpenQuickSearch: () => void;
  onOpenSettings: () => void;
}

interface NavigationItem {
  id: LibraryView;
  label: string;
  icon: ReactElement;
  count?: number;
}

const useStyles = makeStyles({
  root: {
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    overflow: "hidden",
  },
  rootCollapsed: {
    alignItems: "center",
    paddingLeft: "6px",
    paddingRight: "6px",
  },
  sectionTitle: {
    height: "30px",
    display: "flex",
    alignItems: "center",
    paddingLeft: tokens.spacingHorizontalM,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  navigation: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  navItem: {
    position: "relative",
    width: "100%",
    minHeight: "36px",
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    padding: `0 ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground2,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    textAlign: "left",
    ":hover": {
      color: tokens.colorNeutralForeground1,
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  navItemCollapsed: {
    width: "44px",
    gridTemplateColumns: "1fr",
    justifyItems: "center",
    padding: 0,
  },
  navItemSelected: {
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    "::before": {
      position: "absolute",
      left: 0,
      width: "3px",
      height: "18px",
      borderRadius: tokens.borderRadiusCircular,
      backgroundColor: tokens.colorBrandStroke1,
      content: '""',
    },
  },
  label: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  divider: {
    width: "100%",
    marginTop: tokens.spacingVerticalM,
    marginBottom: tokens.spacingVerticalM,
  },
  groupHeader: {
    width: "100%",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: tokens.spacingHorizontalM,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  emptyGroup: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
  },
  spacer: {
    flex: 1,
    minHeight: tokens.spacingVerticalL,
  },
  bottom: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  hintButton: {
    width: "100%",
    minHeight: "58px",
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr)",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground2,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    textAlign: "left",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  hintCollapsed: {
    width: "44px",
    minHeight: "36px",
    gridTemplateColumns: "1fr",
    justifyItems: "center",
    padding: 0,
  },
  hintText: {
    minWidth: 0,
  },
  shortcut: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  shortcutDescription: {
    marginTop: "2px",
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase100,
  },
  settingsButton: {
    width: "100%",
    justifyContent: "flex-start",
  },
  settingsCollapsed: {
    width: "44px",
    minWidth: "44px",
    justifyContent: "center",
  },
});

function CollapsedTooltip({ collapsed, label, children }: { collapsed: boolean; label: string; children: ReactElement }) {
  return collapsed ? <Tooltip content={label} relationship="label">{children}</Tooltip> : children;
}

export function LibrarySidebar({
  collapsed,
  currentView,
  allCount,
  favoriteCount,
  groups,
  quickSearchShortcut,
  shortcutRegistered,
  onViewChange,
  onOpenQuickSearch,
  onOpenSettings,
}: LibrarySidebarProps) {
  const styles = useStyles();
  const shortcutLabel = formatShortcutLabel(quickSearchShortcut);
  const shortcutHint = shortcutRegistered
    ? `${shortcutLabel}：在聊天时快速找图`
    : `${shortcutLabel}：快捷键注册失败，可点击打开浮层`;
  const items: NavigationItem[] = [
    { id: "all", label: "全部表情", icon: <ImageMultiple24Regular />, count: allCount },
    { id: "recent", label: "最近使用", icon: <History24Regular /> },
    { id: "favorites", label: "收藏", icon: <Star24Regular />, count: favoriteCount || undefined },
  ];

  function renderNavigationItem(item: NavigationItem) {
    const selected = currentView === item.id;
    const button = (
      <button
        type="button"
        key={item.id}
        className={mergeClasses(styles.navItem, collapsed && styles.navItemCollapsed, selected && styles.navItemSelected)}
        aria-current={selected ? "page" : undefined}
        aria-label={collapsed ? item.label : undefined}
        onClick={() => onViewChange(item.id)}
      >
        {item.icon}
        {!collapsed && <span className={styles.label}>{item.label}</span>}
        {!collapsed && item.count !== undefined && <Badge size="small" appearance="tint">{item.count}</Badge>}
      </button>
    );
    return <CollapsedTooltip key={item.id} collapsed={collapsed} label={item.label}>{button}</CollapsedTooltip>;
  }

  return (
    <aside className={mergeClasses(styles.root, collapsed && styles.rootCollapsed)} aria-label="资料库导航">
      {!collapsed && <div className={styles.sectionTitle}>资料库</div>}
      <nav className={styles.navigation}>{items.map(renderNavigationItem)}</nav>

      <Divider className={styles.divider} />

      {!collapsed && (
        <div className={styles.groupHeader}>
          <span>我的分组</span>
          <Tooltip content="新增分组即将支持" relationship="label">
            <Button size="small" appearance="subtle" disabled aria-label="新增分组" icon={<Add20Regular />} />
          </Tooltip>
        </div>
      )}

      <div className={styles.navigation}>
        {groups.length > 0 ? groups.map((group) => {
          const selected = currentView === `group:${group.id}`;
          const button = (
            <button
              type="button"
              key={group.id}
              className={mergeClasses(styles.navItem, collapsed && styles.navItemCollapsed, selected && styles.navItemSelected)}
              aria-label={collapsed ? group.name : undefined}
              onClick={() => onViewChange(`group:${group.id}`)}
            >
              <Folder24Regular />
              {!collapsed && <span className={styles.label}>{group.name}</span>}
              {!collapsed && group.count !== undefined && <Badge size="small" appearance="outline">{group.count}</Badge>}
            </button>
          );
          return <CollapsedTooltip key={group.id} collapsed={collapsed} label={group.name}>{button}</CollapsedTooltip>;
        }) : !collapsed ? (
          <div className={styles.emptyGroup}>
            <Folder24Regular />
            <span>还没有分组</span>
          </div>
        ) : null}
      </div>

      <div className={styles.spacer} />
      <Divider className={styles.divider} />

      <div className={styles.bottom}>
        <Tooltip content={shortcutHint} relationship="label">
          <button
            type="button"
            className={mergeClasses(styles.hintButton, collapsed && styles.hintCollapsed)}
            aria-label={shortcutHint}
            onClick={onOpenQuickSearch}
          >
            <Keyboard24Regular />
            {!collapsed && (
              <span className={styles.hintText}>
                <span className={styles.shortcut}>{shortcutLabel}</span>
                <span className={styles.shortcutDescription}>在聊天时快速找图</span>
              </span>
            )}
          </button>
        </Tooltip>

        <Divider className={styles.divider} />

        <Tooltip content="设置" relationship="label">
          <Button
            className={mergeClasses(styles.settingsButton, collapsed && styles.settingsCollapsed)}
            appearance="subtle"
            aria-label="设置"
            icon={<Settings24Regular />}
            onClick={onOpenSettings}
          >
            {!collapsed && "设置"}
          </Button>
        </Tooltip>
      </div>
    </aside>
  );
}
