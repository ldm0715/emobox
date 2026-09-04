import { Badge, Button, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowDownload20Regular, Open20Regular } from "@fluentui/react-icons";
import { MainWindowMockup } from "./MainWindowMockup";
import { useLatestRelease } from "../useLatestRelease";

const useStyles = makeStyles({
  hero: {
    maxWidth: "1120px",
    margin: "0 auto",
    paddingLeft: "24px",
    paddingRight: "24px",
    paddingTop: "72px",
    textAlign: "center",
  },
  badgeRow: {
    display: "flex",
    justifyContent: "center",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "18px",
  },
  title: {
    margin: "0",
    fontSize: "clamp(30px, 5vw, 46px)",
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    lineHeight: "1.2",
  },
  subtitle: {
    margin: "16px auto 0",
    maxWidth: "640px",
    fontSize: tokens.fontSizeBase400,
    lineHeight: "1.65",
    color: tokens.colorNeutralForeground2,
  },
  actions: {
    marginTop: "28px",
    display: "flex",
    justifyContent: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  versionPill: {
    display: "inline-flex",
    alignItems: "center",
    marginLeft: "6px",
    padding: "1px 9px",
    fontSize: tokens.fontSizeBase100,
    lineHeight: "1.6",
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForegroundOnBrand,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    border: "1px solid rgba(255, 255, 255, 0.28)",
    borderRadius: tokens.borderRadiusCircular,
  },
  mockupWrap: {
    marginTop: "56px",
  },
});

export function Hero() {
  const styles = useStyles();
  const release = useLatestRelease();

  return (
    <section className={styles.hero}>
      <h1 className={styles.title}>
        本地表情包，理得清楚、
        <br />
        用得飞快
      </h1>
      <p className={styles.subtitle}>
        EmoBox 在 Windows 上管理本地表情包：导入整理、秒速搜索，一键复制到聊天窗口。
      </p>
      <div className={styles.actions}>
        <Button
          as="a"
          href="#download"
          appearance="primary"
          size="large"
          icon={<ArrowDownload20Regular />}
        >
          下载最新版本
          <span className={styles.versionPill}>v{release.version}</span>
        </Button>
        <Button
          as="a"
          href="https://github.com/ldm0715/emobox"
          target="_blank"
          rel="noreferrer"
          size="large"
          icon={<Open20Regular />}
        >
          GitHub 仓库
        </Button>
      </div>
      <div className={styles.badgeRow}>
        <Badge appearance="tint" color="success">
          GPL-3.0 开源
        </Badge>
        <Badge appearance="tint" color="brand">
          Windows 10 / 11（x64）
        </Badge>
        <Badge appearance="tint" color="informative">
          Tauri v2 + React + Fluent UI
        </Badge>
      </div>
      <div className={styles.mockupWrap}>
        <MainWindowMockup />
      </div>
    </section>
  );
}
