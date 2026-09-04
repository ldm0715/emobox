import { Badge, Button, Link, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import {
  ArrowDownload20Regular,
  ArrowRight20Regular,
  Checkmark20Regular,
  Copy20Regular,
  Eye20Regular,
  FolderZip20Regular,
  Laptop20Regular,
} from "@fluentui/react-icons";
import { useState, type ReactElement } from "react";
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
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "16px",
    maxWidth: "760px",
    margin: "0 auto",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    textAlign: "left",
  },
  cardHead: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  cardTitle: {
    margin: "0",
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  cardDesc: {
    margin: "0",
    flex: "1 1 auto",
    fontSize: tokens.fontSizeBase300,
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground2,
  },
  dlButton: {
    width: "100%",
    justifyContent: "center",
  },
  cardFile: {
    marginTop: "2px",
    fontSize: tokens.fontSizeBase100,
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground3,
    wordBreak: "break-all",
  },

  // 校验入口：并入安装版卡片的小字按钮
  verifyButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    alignSelf: "flex-start",
    padding: "2px 0",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    ":hover": {
      color: tokens.colorNeutralForeground1,
    },
    "& svg": {
      width: "14px",
      height: "14px",
    },
  },

  // 底部小字链接（胶囊式）
  links: {
    marginTop: "26px",
    display: "flex",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: "10px",
    fontSize: tokens.fontSizeBase300,
  },
  linkPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 16px",
    borderRadius: tokens.borderRadiusLarge,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground1,
    textDecoration: "none",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    ":hover": {
      color: tokens.colorNeutralForeground1,
      ...shorthands.borderColor(tokens.colorBrandStroke1),
    },
    "& svg": {
      width: "14px",
      height: "14px",
      flexShrink: 0,
      color: tokens.colorNeutralForeground3,
    },
  },

  // 标题行的版本胶囊
  versionPill: {
    display: "inline-flex",
    alignItems: "center",
    marginLeft: "2px",
    padding: "0 8px",
    fontSize: tokens.fontSizeBase100,
    lineHeight: "1.8",
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusCircular,
  },

  // macOS / Linux：计划中
  plannedCard: {
    maxWidth: "560px",
    margin: "0 auto",
    padding: "36px 28px",
    textAlign: "center",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
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

function DownloadCard(props: {
  title: string;
  recommended?: boolean;
  desc: string;
  href: string;
  primary: boolean;
  icon: ReactElement;
  buttonLabel: string;
  fileName: string;
  footer?: ReactElement;
}) {
  const styles = useStyles();
  const card = useCardStyles();
  return (
    <div className={mergeClasses(card.card, styles.card)}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{props.title}</h3>
        {props.recommended ? (
          <Badge appearance="tint" color="brand">
            推荐
          </Badge>
        ) : null}
      </div>
      <p className={styles.cardDesc}>{props.desc}</p>
      <Button
        as="a"
        href={props.href}
        className={styles.dlButton}
        appearance={props.primary ? "primary" : "secondary"}
        icon={props.icon}
      >
        {props.buttonLabel}
      </Button>
      <div className={styles.cardFile}>{props.fileName}</div>
      {props.footer}
    </div>
  );
}

export function DownloadSection() {
  const section = useSectionStyles();
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
          Windows 10 / 11（x64） · 最新版本
          <span className={styles.versionPill}>v{release.version}</span>
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
          <div className={styles.cards}>
            <DownloadCard
              title="安装版"
              recommended
              desc="向导式安装，会自动补齐 WebView2 运行环境，适合大多数用户。"
              href={release.setupUrl}
              primary
              icon={<ArrowDownload20Regular />}
              buttonLabel="下载安装版"
              fileName={release.setupName}
              footer={
                <button
                  type="button"
                  className={styles.verifyButton}
                  onClick={copyChecksum}
                  title="SHA-256 校验和发布在 Release 说明末尾的「校验和」表格中"
                >
                  {copied ? <Checkmark20Regular /> : <Copy20Regular />}
                  {copied ? "已复制校验命令" : "复制 SHA-256 校验命令"}
                </button>
              }
            />
            <DownloadCard
              title="便携版"
              desc="压缩包解压即可运行，无需安装，适合便携与免安装场景。"
              href={release.zipUrl}
              primary={false}
              icon={<FolderZip20Regular />}
              buttonLabel="下载便携版"
              fileName={release.zipName}
            />
          </div>
        </>
      )}

      <div className={styles.links}>
        {[
          { href: RELEASES_PAGE, label: "前往 Releases 页面" },
          { href: `${REPO_URL}/issues`, label: "去 Issue 提意见" },
          { href: `${REPO_URL}#-从源码构建`, label: "从源码构建" },
        ].map((item) => (
          <Link
            key={item.label}
            className={styles.linkPill}
            href={item.href}
            target="_blank"
            rel="noreferrer"
          >
            {item.label}
            <ArrowRight20Regular />
          </Link>
        ))}
      </div>
    </section>
  );
}
