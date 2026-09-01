import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { ReactNode } from "react";

interface AppShellProps {
  toolbar: ReactNode;
  sidebar: ReactNode;
  sidebarCollapsed: boolean;
  children: ReactNode;
}

const useStyles = makeStyles({
  root: {
    height: "100%",
    minWidth: 0,
    display: "grid",
    gridTemplateRows: "54px minmax(0, 1fr)",
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  body: {
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "232px minmax(0, 1fr)",
    overflow: "hidden",
    // 侧栏折叠宽度动画（唯一允许的 layout 过渡；单元素 reflow 可承受）。
    // 曲线/时长与 AppToolbar 首列保持同步，避免折叠时两处错拍。
    transitionProperty: "grid-template-columns",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
    "@media (prefers-reduced-motion: reduce)": {
      transitionProperty: "none",
    },
  },
  bodyCollapsed: {
    gridTemplateColumns: "56px minmax(0, 1fr)",
  },
  main: {
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
  },
});

export function AppShell({ toolbar, sidebar, sidebarCollapsed, children }: AppShellProps) {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      {toolbar}
      <div className={mergeClasses(styles.body, sidebarCollapsed && styles.bodyCollapsed)}>
        {sidebar}
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
