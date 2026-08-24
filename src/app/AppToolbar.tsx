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
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  Search20Regular,
} from "@fluentui/react-icons";
import type { KeyboardEvent } from "react";
import { AppIcon } from "../components/AppIcon";
import { ImportMenu } from "../features/import/ImportMenu";
import { ThemeQuickMenu } from "./ThemeQuickMenu";

interface AppToolbarProps {
  query: string;
  importing: boolean;
  showImport: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onQueryChange: (query: string) => void;
  onImportFolder: () => void;
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
  onImportFolder,
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
            appearance="subtle"
            aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            icon={sidebarCollapsed ? <PanelLeftExpand20Regular /> : <PanelLeftContract20Regular />}
            onClick={onToggleSidebar}
          />
        </Tooltip>
        <AppIcon />
        {!sidebarCollapsed && <span className={styles.title}>表情匣</span>}
      </div>

      <div className={styles.searchWrap} data-emobox-main-search>
        <SearchBox
          className={styles.search}
          aria-label="搜索表情、标签或文件名"
          contentBefore={<Search20Regular />}
          placeholder="搜索表情、标签或文件名"
          value={query}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
        />
      </div>

      <div className={styles.actions}>
        {showImport && (
          <ImportMenu label="导入" appearance="primary" disabled={importing} onImportFolder={onImportFolder} />
        )}
        <ThemeQuickMenu />
      </div>
    </header>
  );
}
