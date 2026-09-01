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
  motionTokens,
  tokens,
  type SearchBoxChangeEvent,
} from "@fluentui/react-components";
import { Collapse } from "@fluentui/react-motion-components-preview";
import {
  Add20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  Delete24Regular,
  Folder24Regular,
  History24Regular,
  ImageMultiple24Regular,
  Keyboard24Regular,
  MoreHorizontal20Regular,
  PaintBrushRegular,
  PinOff16Regular,
  Pin16Regular,
  Rename20Regular,
  Search20Regular,
  Settings24Regular,
  Star24Regular,
} from "@fluentui/react-icons";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { formatShortcutLabel } from "../config/shortcuts";
import { ConfirmDialog } from "../features/library/ConfirmDialog";
import { getGroupIcon } from "../features/library/groupIcons";
import type { LibraryGroup, LibraryView } from "../types";
import { navItemBaseStyle, navItemSelectedStyle } from "./navItemStyles";

interface LibrarySidebarProps {
  collapsed: boolean;
  currentView: LibraryView;
  allCount: number;
  favoriteCount: number;
  trashCount?: number;
  groups: LibraryGroup[];
  /** 「我的分组」区折叠开关（侧栏展开态专用）。 */
  groupsCollapsed: boolean;
  quickSearchShortcut: string;
  shortcutRegistered: boolean;
  onViewChange: (view: LibraryView) => void;
  onOpenQuickSearch: () => void;
  onOpenSettings: () => void;
  onCreateGroup: () => void;
  /** 请求打开重命名弹窗（App 侧复用 GroupDialog 的 rename 模式）。 */
  onRenameGroup: (group: LibraryGroup) => void;
  onDeleteGroup: (id: number) => void;
  onTogglePinGroup: (id: number, pinned: boolean) => void;
  onToggleGroupsCollapsed: () => void;
  onEditGroupIcon: (group: LibraryGroup) => void;
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
    // 侧栏与顶部栏/内容区同一层级（BG1），靠右侧 hairline 分隔——这是 Fluent
    // 深色模式的标准范式（同层级 surface + 低对比描边），避免侧栏成为全窗口
    // 唯一的暗色块（此前用最暗层 BG2，暗色下看着发黑、与内容割裂）。
    backgroundColor: tokens.colorNeutralBackground1,
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
    // 导航行 / 分组行 / 未分组·回收站共用；8px 行距更透气。
    gap: tokens.spacingVerticalS,
  },
  navItem: {
    // 共享导航行范式（见 navItemStyles.ts），这里只定义侧栏布局差异。
    ...navItemBaseStyle,
    minHeight: "28px",
    gridTemplateColumns: "24px minmax(0, 1fr) auto auto",
    columnGap: tokens.spacingHorizontalS,
    padding: `0 ${tokens.spacingHorizontalM}`,
  },
  navItemCollapsed: {
    width: "44px",
    gridTemplateColumns: "1fr",
    justifyItems: "center",
    padding: 0,
  },
  navItemSelected: navItemSelectedStyle,
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
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
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
    // 侧栏专属细滚动条（其余滚动区走原生默认 + colorScheme 适配）。
    // 尺寸字面量无对应 token；thumb 颜色走 token 随主题切换。
    "::-webkit-scrollbar": {
      width: "6px",
    },
    "::-webkit-scrollbar-track": {
      backgroundColor: "transparent",
    },
    "::-webkit-scrollbar-thumb": {
      backgroundColor: tokens.colorNeutralStroke3,
      borderRadius: "3px", // 半径 = 宽度一半，固定 6px 滚动条的圆柱端
    },
  },
  groupSearch: {
    // SearchBox 根元素是 inline-flex（无 width:100%，仅 max-width），不包一层
    // flex 居中会收缩成内容宽度并贴左。
    display: "flex",
    justifyContent: "center",
    width: "100%",
    marginBottom: tokens.spacingVerticalS,
  },
  pinLabel: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  pinIcon: {
    // 长分组名让 pinLabel 溢出时，flex 默认收缩会把固定 16px 的 SVG 压小
    // （名字越长压得越狠，表现为置顶图钉忽大忽小）；图标绝不可收缩。
    flexShrink: 0,
  },
  bottom: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    // 不要加 gap:夹在两按钮之间的 Divider 自带 8px 上下 margin,容器 gap 会与之
    // 叠加翻倍,导致快捷键按钮偏上、设置按钮偏下(2026-09 修复)。
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
      backgroundColor: tokens.colorSubtleBackgroundHover,
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
  groupsCollapsed,
  quickSearchShortcut,
  shortcutRegistered,
  onViewChange,
  onOpenQuickSearch,
  onOpenSettings,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onTogglePinGroup,
  onToggleGroupsCollapsed,
  onEditGroupIcon,
}: LibrarySidebarProps) {
  const styles = useStyles();
  const [groupSearch, setGroupSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // 删除分组确认弹窗（替代原生 window.confirm——原生框不跟随应用主题）。
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<LibraryGroup | null>(null);
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
    if (collapsed || groupsCollapsed) setSearchOpen(false);
  }, [collapsed, groupsCollapsed]);
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
          <button
            type="button"
            className={styles.groupHeaderToggle}
            aria-expanded={!groupsCollapsed}
            aria-label={groupsCollapsed ? "展开我的分组" : "收起我的分组"}
            onClick={onToggleGroupsCollapsed}
          >
            {groupsCollapsed ? <ChevronRight20Regular /> : <ChevronDown20Regular />}
            <span>我的分组</span>
          </button>
          <div className={styles.groupHeaderActions}>
            {!groupsCollapsed && groups.length > 0 && (
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
            {!groupsCollapsed && (
              <Tooltip content="新建分组" relationship="label">
                <Button
                  size="small"
                  appearance="subtle"
                  aria-label="新建分组"
                  icon={<Add20Regular />}
                  onClick={onCreateGroup}
                />
              </Tooltip>
            )}
          </div>
        </div>
      )}

      <Collapse
        visible={searchOpen && !collapsed && !groupsCollapsed && groups.length > 0}
        duration={motionTokens.durationFast}
        unmountOnExit
      >
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
      </Collapse>

      {/* groupList 容器始终挂载：它是侧栏唯一 flex:1 弹性滚动区（Phase 13），
          折叠时只清空内容，否则底部固定项会因失去弹性区而重排。
          内容包 Collapse 做高度手风琴（侧栏折叠态恒可见 icon 行）；unmountOnExit
          保证收起后内容卸载（presence 默认退场后仍挂载）。 */}
      <div className={mergeClasses(styles.navigation, styles.groupList)}>
        <Collapse
          visible={collapsed || !groupsCollapsed}
          duration={motionTokens.durationGentle}
          exitDuration={motionTokens.durationNormal}
          unmountOnExit
        >
          <div className={styles.navigation}>
        {groups.length > 0 ? (
            filteredGroups.length > 0 ? (
              filteredGroups.map((group) => {
                const selected = currentView === `group:${group.id}`;
                const GroupIcon = getGroupIcon(group.icon);
                const button = (
                  <div key={group.id} className={styles.groupRow} style={{ position: "relative" }}>
                    <button
                      type="button"
                      className={mergeClasses(styles.navItem, collapsed && styles.navItemCollapsed, selected && styles.navItemSelected)}
                      aria-label={collapsed ? group.name : undefined}
                      onClick={() => onViewChange(`group:${group.id}`)}
                    >
                      <GroupIcon />
                      {!collapsed && (
                        <span className={styles.pinLabel}>
                          {group.isPinned && <Pin16Regular className={styles.pinIcon} />}
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
                                  icon={group.isPinned ? <PinOff16Regular /> : <Pin16Regular />}
                                  onClick={() => onTogglePinGroup(group.id, !group.isPinned)}
                                >
                                  {group.isPinned ? "取消置顶" : "置顶"}
                                </MenuItem>
                                <MenuItem
                                  icon={<PaintBrushRegular />}
                                  onClick={() => onEditGroupIcon(group)}
                                >
                                  更改图标
                                </MenuItem>
                                <MenuItem
                                  icon={<Rename20Regular />}
                                  onClick={() => onRenameGroup(group)}
                                >
                                  重命名
                                </MenuItem>
                                <MenuItem
                                  icon={<Delete24Regular />}
                                  onClick={() => setConfirmDeleteGroup(group)}
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
                // 展开态也常驻 Tooltip：长名省略号截断后靠它展示全名。
                return (
                  <Tooltip key={group.id} content={group.name} relationship="label">
                    {button}
                  </Tooltip>
                );
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
        </Collapse>
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
          <button
            type="button"
            className={mergeClasses(styles.hintButton, collapsed && styles.hintCollapsed)}
            aria-label="设置"
            onClick={onOpenSettings}
          >
            <Settings24Regular />
            {!collapsed && <span className={styles.shortcut}>设置</span>}
          </button>
        </Tooltip>
      </div>

      <ConfirmDialog
        open={confirmDeleteGroup !== null}
        title="删除分组"
        message={
          confirmDeleteGroup
            ? `确定删除分组「${confirmDeleteGroup.name}」？\n\n关联的表情不会被删除。`
            : ""
        }
        confirmText="删除"
        destructive
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteGroup(null);
        }}
        onConfirm={() => {
          const group = confirmDeleteGroup;
          setConfirmDeleteGroup(null);
          if (group) onDeleteGroup(group.id);
        }}
      />
    </aside>
  );
}
