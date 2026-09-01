import {
  Button,
  SearchBox,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  type SearchBoxChangeEvent,
} from "@fluentui/react-components";
import {
  PanelLeftContract24Regular,
  PanelLeftExpand24Regular,
  Search20Regular,
} from "@fluentui/react-icons";
import type { KeyboardEvent } from "react";
import { ImportMenu } from "../features/import/ImportMenu";
import { ThemeQuickMenu } from "./ThemeQuickMenu";

interface AppToolbarProps {
  query: string;
  importing: boolean;
  showImport: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onQueryChange: (query: string) => void;
  onImportImages: () => void;
  onImportFolder: () => void;
  onCollectFromClipboard: () => void;
}

const useStyles = makeStyles({
  root: {
    minWidth: 0,
    height: "54px",
    display: "grid",
    gridTemplateColumns: "232px minmax(240px, 560px) minmax(180px, 1fr)",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalM,
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalM,
    // 首列宽度与 AppShell 侧栏同曲线同时长同步动画（此前无过渡，折叠时瞬跳）。
    transitionProperty: "grid-template-columns",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
    "@media (prefers-reduced-motion: reduce)": {
      transitionProperty: "none",
    },
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  rootCollapsed: {
    gridTemplateColumns: "104px minmax(240px, 560px) minmax(180px, 1fr)",
  },
  brand: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  // 展开侧栏按钮：右移 4px，与侧栏内容留出呼吸位（全量对齐图标列的 8px 偏多）。
  sidebarToggle: {
    marginLeft: tokens.spacingHorizontalXS,
  },
  title: {
    overflow: "hidden",
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
  actions: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalXS,
  },
});

export function AppToolbar({
  query,
  importing,
  showImport,
  sidebarCollapsed,
  onToggleSidebar,
  onQueryChange,
  onImportImages,
  onImportFolder,
  onCollectFromClipboard,
}: AppToolbarProps) {
  const styles = useStyles();

  function handleSearchChange(_: SearchBoxChangeEvent, data: { value: string }) {
    onQueryChange(data.value);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;
    if (query) {
      event.preventDefault();
      onQueryChange("");
    } else {
      event.currentTarget.blur();
    }
  }

  return (
    <header className={mergeClasses(styles.root, sidebarCollapsed && styles.rootCollapsed)}>
      <div className={styles.brand}>
        <Tooltip content={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} relationship="label">
          <Button
            className={styles.sidebarToggle}
            appearance="subtle"
            aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            icon={sidebarCollapsed ? <PanelLeftExpand24Regular /> : <PanelLeftContract24Regular />}
            onClick={onToggleSidebar}
          />
        </Tooltip>
        {!sidebarCollapsed && <span className={styles.title}>表情匣</span>}
      </div>

      <div className={styles.searchWrap} data-emobox-main-search>
        <SearchBox
          className={styles.search}
          aria-label="搜索表情、标签或文件名"
          contentBefore={<Search20Regular />}
          placeholder="搜索表情、标签或分组（组*标签）"
          value={query}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
        />
      </div>

      <div className={styles.actions}>
        {showImport && (
          <ImportMenu
            label="导入"
            appearance="primary"
            disabled={importing}
            onImportImages={onImportImages}
            onImportFolder={onImportFolder}
            onCollectFromClipboard={onCollectFromClipboard}
          />
        )}
        <ThemeQuickMenu />
      </div>
    </header>
  );
}