import { Badge, Button, Link, makeStyles, tokens } from "@fluentui/react-components";
import {
  ArrowDownload20Regular,
  Checkmark20Regular,
  Copy20Regular,
  Eye20Regular,
  FolderZip20Regular,
  Laptop20Regular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useCardStyles, useSectionStyles } from "../styles/common";
import { useLatestRelease } from "../useLatestRelease";

/* ------------------------------------------------------------------ */
/* 下载安装：检测访问者系统、动态拉取最新版本、直链下载、校验命令复制     */
/* ------------------------------------------------------------------ */

const RELEASES_PAGE = "https://github.com/ldm0715/emobox/releases/latest";
const REPO_URL = "https://github.com/ldm0715/emobox";

type VisitorOS = "windows" | "macos" | "linux" | "unknown";

function detectOS(): VisitorOS {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/Android/i.test(ua)) return "linux";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "unknown";
}

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "16px",
    maxWidth: "820px",
    margin: "0 auto",
  },
  fileName: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: "2px 6px",
    display: "inline-block",
    marginBottom: "14px",
  },
  title: {
    margin: "0 0 8px",
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  text: {
    margin: "0 0 18px",
    fontSize: tokens.fontSizeBase300,
    lineHeight: "1.65",
    color: tokens.colorNeutralForeground2,
  },
  versionBadge: {
    verticalAlign: "1px",
    marginLeft: "6px",
  },
  requirement: {
    margin: "24px auto 0",
    maxWidth: "820px",
    textAlign: "center",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.7",
  },
  footnote: {
    marginTop: "12px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  links: {
    marginTop: "8px",
    display: "flex",
    justifyContent: "center",
    gap: "16px",
    flexWrap: "wrap",
  },

  // 编辑器风格校验命令块（恒暗，类 GitHub dark，不随网站主题变化）
  codeBlock: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    maxWidth: "640px",
    margin: "16px auto 0",
    padding: "16px 14px 12px",
    backgroundColor: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: tokens.borderRadiusMedium,
    color: "#c9d1d9",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    textAlign: "left",
  },
  codeTag: {
    position: "absolute",
    top: "-10px",
    left: "12px",
    padding: "1px 8px",
    fontSize: "11px",
    lineHeight: "1.4",
    color: "#8b949e",
    backgroundColor: "#161b22",
    border: "1px solid #30363d",
    borderRadius: tokens.borderRadiusSmall,
  },
  codePrompt: {
    color: "#7ee787",
    flexShrink: 0,
    userSelect: "none",
  },
  codeText: {
    flex: 1,
    minWidth: 0,
    overflowX: "auto",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  },
  copyButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    flexShrink: 0,
    padding: "4px 10px",
    fontSize: tokens.fontSizeBase100,
    fontFamily: "inherit",
    color: "#c9d1d9",
    backgroundColor: "rgba(240, 246, 252, 0.06)",
    border: "1px solid rgba(240, 246, 252, 0.12)",
    borderRadius: tokens.borderRadiusSmall,
    cursor: "pointer",
    ":hover": {
      color: "#ffffff",
      backgroundColor: "rgba(240, 246, 252, 0.12)",
    },
    "& svg": {
      width: "14px",
      height: "14px",
    },
  },
  copyButtonDone: {
    color: "#7ee787",
  },

  // macOS / Linux：计划中
  plannedCard: {
    maxWidth: "560px",
    margin: "0 auto",
    padding: "36px 28px",
    textAlign: "center",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
  },
  plannedIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "48px",
    height: "48px",
    marginBottom: "14px",
    fontSize: "24px",
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  plannedTitle: {
    margin: "0 0 8px",
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  plannedText: {
    margin: "0 0 18px",
    fontSize: tokens.fontSizeBase300,
    lineHeight: "1.7",
    color: tokens.colorNeutralForeground2,
  },
});

export function DownloadSection() {
  const section = useSectionStyles();
  const card = useCardStyles();
  const styles = useStyles();

  // 访问者系统（同步检测，无需等待）
  const [os] = useState<VisitorOS>(detectOS);
  // 最新版本信息（GitHub API 拉取，带模块级缓存与本地回退）
  const release = useLatestRelease();
  const [copied, setCopied] = useState(false);

  const checksumCommand = `certutil -hashfile ${release.setupName} SHA256`;

  async function copyChecksum() {
    try {
      await navigator.clipboard.writeText(checksumCommand);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const isPlannedPlatform = os === "macos" || os === "linux";
  const osLabel = os === "macos" ? "macOS" : "Linux";

  return (
    <section id="download" className={section.section}>
      <div className={section.header}>
        <h2 className={section.title}>下载安装</h2>
        <p className={section.description}>
          免费开源，Windows 10 / 11（x64）。
          <Badge className={styles.versionBadge} appearance="tint" color="brand">
            最新版本 v{release.version}
          </Badge>
        </p>
      </div>

      {isPlannedPlatform ? (
        <div className={styles.plannedCard}>
          <div>
            <span className={styles.plannedIcon}>
              <Laptop20Regular />
            </span>
          </div>
          <h3 className={styles.plannedTitle}>你正在使用 {osLabel}</h3>
          <p className={styles.plannedText}>
            EmoBox 目前支持 Windows 10 / 11（x64），{osLabel} 版本在计划中。在 GitHub 上关注
            Releases 动态，新平台版本发布会第一时间通知你。
          </p>
          <Button as="a" href={RELEASES_PAGE} target="_blank" rel="noreferrer" icon={<Eye20Regular />}>
            关注 Releases 动态
          </Button>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            <div className={card.card}>
              <h3 className={styles.title}>安装版（推荐）</h3>
              <span className={styles.fileName}>{release.setupName}</span>
              <p className={styles.text}>NSIS 安装向导，缺少 WebView2 运行时会自动下载安装。</p>
              <Button
                as="a"
                href={release.setupUrl}
                appearance="primary"
                icon={<ArrowDownload20Regular />}
              >
                下载安装版
              </Button>
            </div>
            <div className={card.card}>
              <h3 className={styles.title}>便携版</h3>
              <span className={styles.fileName}>{release.zipName}</span>
              <p className={styles.text}>解压即用，适合免安装或绿色便携场景。</p>
              <Button as="a" href={release.zipUrl} icon={<FolderZip20Regular />}>
                下载便携版
              </Button>
            </div>
          </div>

          <div className={styles.requirement}>
            系统要求：Windows 10 / 11（x64）
            <div className={styles.footnote}>
              下载完成后，可在 PowerShell 里运行以下命令校验安装包（SHA-256 校验和同时发布在
              Release 说明末尾的「校验和」表格中）：
            </div>
            <div className={styles.codeBlock}>
              <span className={styles.codeTag}>PowerShell</span>
              <span className={styles.codePrompt} aria-hidden>
                PS&gt;
              </span>
              <code className={styles.codeText}>{checksumCommand}</code>
              <button
                type="button"
                className={copied ? `${styles.copyButton} ${styles.copyButtonDone}` : styles.copyButton}
                onClick={copyChecksum}
                aria-label="复制校验命令"
              >
                {copied ? <Checkmark20Regular /> : <Copy20Regular />}
                {copied ? "已复制" : "复制"}
              </button>
            </div>
          </div>
        </>
      )}

      <div className={styles.links}>
        <Link href={RELEASES_PAGE} target="_blank" rel="noreferrer">
          前往 Releases 页面
        </Link>
        <Link href={`${REPO_URL}#-下载安装`} target="_blank" rel="noreferrer">
          查看完整安装说明
        </Link>
        <Link href={`${REPO_URL}#-从源码构建`} target="_blank" rel="noreferrer">
          从源码构建
        </Link>
      </div>
    </section>
  );
}
