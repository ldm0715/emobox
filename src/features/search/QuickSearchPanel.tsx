import {
  Button,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Dismiss20Regular, SearchSquare20Regular } from "@fluentui/react-icons";
import { formatShortcutLabel } from "../../config/shortcuts";
import type { IndexedImage } from "../../types";
import { QuickSearchContent } from "./QuickSearchContent";

interface QuickSearchPanelProps {
  results: IndexedImage[];
  query: string;
  onQueryChange: (query: string) => void;
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
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalL}`,
  },
});

export function QuickSearchPanel({
  results,
  query,
  onQueryChange,
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
    <section className={styles.surface} aria-label="快捷搜索浮层">
      <header className={styles.titleBar} data-tauri-drag-region>
        <SearchSquare20Regular className={styles.icon} />
        <span className={styles.title} data-tauri-drag-region>快捷搜索</span>
        <span className={styles.shortcut} data-tauri-drag-region>
          {formatShortcutLabel(shortcut)}
        </span>
        <Button
          appearance="subtle"
          aria-label="隐藏快捷搜索"
          icon={<Dismiss20Regular />}
          onClick={onClose}
        />
      </header>
      <div className={styles.content}>
        <QuickSearchContent
          results={results}
          query={query}
          onQueryChange={onQueryChange}
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
