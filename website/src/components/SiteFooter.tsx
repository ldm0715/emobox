import { makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  footer: {
    marginTop: "72px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: "32px 24px 40px",
    textAlign: "center",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    lineHeight: "1.8",
  },
});

export function SiteFooter() {
  const styles = useStyles();

  return (
    <footer className={styles.footer}>
      <div>
        © 2026 EmoBox contributors · 以 GPL-3.0 协议开源 · 基于 Tauri v2 + React + Fluent UI 构建
      </div>
    </footer>
  );
}
