import {
  Badge,
  Button,
  Divider,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  SearchBox,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  type SearchBoxChangeEvent,
} from "@fluentui/react-components";
import {
  Add20Regular,
  Delete24Regular,
  Folder24Regular,
  History24Regular,
  ImageMultiple24Regular,
  Keyboard24Regular,
  MoreHorizontal20Regular,
  PinOffRegular,
  PinRegular,
  Rename20Regular,
  Search20Regular,
  Settings24Regular,
  Star24Regular,
} from "@fluentui/react-icons";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { formatShortcutLabel } from "../config/shortcuts";
import type { LibraryGroup, LibraryView } from "../types";

interface LibrarySidebarProps {
  collapsed: boolean;
  currentView: LibraryView;
  allCount: number;
  favoriteCount: number;
  trashCount?: number;
  groups: LibraryGroup[];
  quickSearchShortcut: string;
  shortcutRegistered: boolean;
  onViewChange: (view: LibraryView) => void;
  onOpenQuickSearch: () => void;
  onOpenSettings: () => void;
  onCreateGroup: () => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
  onTogglePinGroup: (id: number, pinned: boolean) => void;
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
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    overflow: "hidden",
    padding: `${tokens.spacingVerticalSNudge} ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  rootCollapsed: {
    paddingLeft: "6px",
    paddingRight: "6px",
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
    minHeight: "28px",
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr) auto auto",
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
    marginTop: tokens.spacingVerticalS,
    marginBottom: tokens.spacingVerticalS,
    // Fluent Divider 默认 flex-grow:1，在 flex column 中会撑高分隔线、挤占分组列表空间
    flexGrow: 0,
    flexShrink: 0,
  },
  groupHeader: {
    width: "100%",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  groupHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  emptyGroup: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
  },
  groupList: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    "::-webkit-scrollbar": {
      width: "6px",
    },
    "::-webkit-scrollbar-track": {
      backgroundColor: "transparent",
    },
    "::-webkit-scrollbar-thumb": {
      backgroundColor: tokens.colorNeutralStroke3,
      borderRadius: "3px",
    },
  },
  groupSearch: {
    width: "100%",
    marginBottom: tokens.spacingVerticalS,
  },
  pinLabel: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  bottom: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
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
    minHeight: "32px",
    gridTemplateColumns: "1fr",
    justifyItems: "center",
    padding: 0,
  },
  shortcut: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
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
  groupMoreButton: {
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: tokens.durationFaster,
  },
  groupMoreVisible: {
    opacity: 1,
  },
  groupRow: {
    ":hover .group-more": {
      opacity: 1,
    },
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
  trashCount = 0,
  groups,
  quickSearchShortcut,
  shortcutRegistered,
  onViewChange,
  onOpenQuickSearch,
  onOpenSettings,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onTogglePinGroup,
}: LibrarySidebarProps) {
  const styles = useStyles();
  const [groupSearch, setGroupSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shortcutLabel = formatShortcutLabel(quickSearchShortcut);
  const shortcutHint = shortcutRegistered
    ? `${shortcutLabel}：在聊天时快速找图`
    : `${shortcutLabel}：快捷键注册失败，可点击打开浮层`;
  const trimmedGroupSearch = groupSearch.trim().toLowerCase();
  const filteredGroups =
    searchOpen && trimmedGroupSearch
      ? groups.filter((group) => group.name.toLowerCase().includes(trimmedGroupSearch))
      : groups;
  const items: NavigationItem[] = [
    { id: "all", label: "全部表情", icon: <ImageMultiple24Regular />, count: allCount },
    { id: "recent", label: "最近使用", icon: <History24Regular /> },
    { id: "favorites", label: "收藏", icon: <Star24Regular />, count: favoriteCount || undefined },
  ];

  useEffect(() => {
    if (collapsed) setSearchOpen(false);
  }, [collapsed]);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

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
      <nav className={styles.navigation}>{items.map(renderNavigationItem)}</nav>

      <Divider className={styles.divider} />

      {!collapsed && (
        <div className={styles.groupHeader}>
          <span>我的分组</span>
          <div className={styles.groupHeaderActions}>
            {groups.length > 0 && (
              <Tooltip content="搜索分组" relationship="label">
                <Button
                  size="small"
                  appearance={searchOpen ? "secondary" : "subtle"}
                  aria-label="搜索分组"
                  aria-pressed={searchOpen}
                  icon={<Search20Regular />}
                  onClick={() => setSearchOpen((open) => !open)}
                />
              </Tooltip>
            )}
            <Tooltip content="新建分组" relationship="label">
              <Button
                size="small"
                appearance="subtle"
                aria-label="新建分组"
                icon={<Add20Regular />}
                onClick={onCreateGroup}
              />
            </Tooltip>
          </div>
        </div>
      )}

      {searchOpen && !collapsed && groups.length > 0 && (
        <div className={styles.groupSearch}>
          <SearchBox
            ref={searchInputRef}
            size="small"
            aria-label="搜索分组"
            placeholder="搜索分组"
            value={groupSearch}
            onChange={(_: SearchBoxChangeEvent, data: { value: string }) => setGroupSearch(data.value)}
          />
        </div>
      )}

      <div className={mergeClasses(styles.navigation, styles.groupList)}>
        {groups.length > 0 ? (
          filteredGroups.length > 0 ? (
            filteredGroups.map((group) => {
              const selected = currentView === `group:${group.id}`;
              const button = (
                <div key={group.id} className={styles.groupRow} style={{ position: "relative" }}>
                  <button
                    type="button"
                    className={mergeClasses(styles.navItem, collapsed && styles.navItemCollapsed, selected && styles.navItemSelected)}
                    aria-label={collapsed ? group.name : undefined}
                    onClick={() => onViewChange(`group:${group.id}`)}
                  >
                    <Folder24Regular />
                    {!collapsed && (
                      <span className={styles.pinLabel}>
                        {group.isPinned && <PinRegular fontSize={12} />}
                        <span className={styles.label}>{group.name}</span>
                      </span>
                    )}
                    {!collapsed && group.count !== undefined && <Badge size="small" appearance="outline">{group.count}</Badge>}
                    {!collapsed && (
                      <span
                        className={`group-more ${styles.groupMoreButton}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Menu>
                          <MenuTrigger disableButtonEnhancement>
                            <Button
                              size="small"
                              appearance="subtle"
                              aria-label={`管理分组 ${group.name}`}
                              icon={<MoreHorizontal20Regular />}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </MenuTrigger>
                          <MenuPopover>
                            <MenuList>
                              <MenuItem
                                icon={group.isPinned ? <PinOffRegular /> : <PinRegular />}
                                onClick={() => onTogglePinGroup(group.id, !group.isPinned)}
                              >
                                {group.isPinned ? "取消置顶" : "置顶"}
                              </MenuItem>
                              <MenuItem
                                icon={<Rename20Regular />}
                                onClick={() => {
                                  const newName = window.prompt("重命名分组", group.name);
                                  if (newName && newName.trim() && newName !== group.name) {
                                    onRenameGroup(group.id, newName.trim());
                                  }
                                }}
                              >
                                重命名
                              </MenuItem>
                              <MenuItem
                                icon={<Delete24Regular />}
                                onClick={() => {
                                  if (window.confirm(`确定删除分组「${group.name}」？\n\n关联的表情不会被删除。`)) {
                                    onDeleteGroup(group.id);
                                  }
                                }}
                              >
                                删除
                              </MenuItem>
                            </MenuList>
                          </MenuPopover>
                        </Menu>
                      </span>
                    )}
                  </button>
                </div>
              );
              return <CollapsedTooltip key={group.id} collapsed={collapsed} label={group.name}>{button}</CollapsedTooltip>;
            })
          ) : !collapsed ? (
            <div className={styles.emptyGroup}>
              <span>无匹配分组</span>
            </div>
          ) : null
        ) : !collapsed ? (
          <div className={styles.emptyGroup}>
            <Folder24Regular />
            <span>还没有分组</span>
          </div>
        ) : null}
      </div>

      <Divider className={styles.divider} />

      <div className={styles.navigation}>
        {(() => {
          const ungroupedSelected = currentView === "ungrouped";
          const ungroupedButton = (
            <button
              type="button"
              className={mergeClasses(styles.navItem, collapsed && styles.navItemCollapsed, ungroupedSelected && styles.navItemSelected)}
              aria-label="未分组"
              onClick={() => onViewChange("ungrouped")}
            >
              <Folder24Regular />
              {!collapsed && <span className={styles.label}>未分组</span>}
            </button>
          );
          return <CollapsedTooltip collapsed={collapsed} label="未分组">{ungroupedButton}</CollapsedTooltip>;
        })()}
        {(() => {
          const trashSelected = currentView === "trash";
          const trashButton = (
            <button
              type="button"
              className={mergeClasses(styles.navItem, collapsed && styles.navItemCollapsed, trashSelected && styles.navItemSelected)}
              aria-label="回收站"
              onClick={() => onViewChange("trash")}
            >
              <Delete24Regular />
              {!collapsed && <span className={styles.label}>回收站</span>}
              {!collapsed && trashCount > 0 && <Badge size="small" appearance="tint">{trashCount}</Badge>}
            </button>
          );
          return <CollapsedTooltip collapsed={collapsed} label="回收站">{trashButton}</CollapsedTooltip>;
        })()}
      </div>

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
            {!collapsed && <span className={styles.shortcut}>{shortcutLabel}</span>}
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
