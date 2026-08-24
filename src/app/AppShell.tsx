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
    transitionProperty: "grid-template-columns",
    transitionDuration: tokens.durationNormal,
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
