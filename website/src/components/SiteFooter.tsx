import { makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ShieldCheckmark20Regular, Tag20Regular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import logoUrl from "../assets/logo.png";
import { GithubIcon } from "./SiteHeader";
import { useLatestRelease } from "../useLatestRelease";

const REPO_URL = "https://github.com/ldm0715/emobox";
const RELEASES_URL = "https://github.com/ldm0715/emobox/releases";
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
const TAURI_URL = "https://tauri.app";

const useStyles = makeStyles({
  footer: {
    marginTop: "88px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: "40px 24px 48px",
  },
  inner: {
    maxWidth: "1120px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "18px",
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: "10px",
    rowGap: "6px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  logo: {
    width: "22px",
    height: "22px",
    display: "block",
  },
  brandName: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
  },
  dot: {
    color: tokens.colorNeutralForeground4,
  },

  // 徽章行：两段式（品牌色标签段 + 内容段）的 GitHub 风格小勋章
  badges: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  shield: {
    display: "inline-flex",
    alignItems: "stretch",
    height: "20px",
    overflow: "hidden",
    textDecoration: "none",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground1,
    ":hover": {
      ...shorthands.borderColor(tokens.colorBrandStroke1),
    },
  },
  shieldLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "0 7px",
    fontSize: "11px",
    lineHeight: "1",
    color: tokens.colorNeutralForegroundOnBrand,
    backgroundColor: tokens.colorBrandBackground,
    "& svg": {
      width: "13px",
      height: "13px",
      display: "block",
    },
  },
  shieldValue: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0 9px",
    fontSize: "11px",
    lineHeight: "1",
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground2,
  },
  copyright: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground4,
    lineHeight: "1.7",
    textAlign: "center",
  },
});

function Shield(props: { label: string; value: string; icon?: ReactNode; href: string }) {
  const styles = useStyles();
  return (
    <a className={styles.shield} href={props.href} target="_blank" rel="noreferrer" aria-label={`${props.label}: ${props.value}`}>
      <span className={styles.shieldLabel}>
        {props.icon}
        {props.label}
      </span>
      <span className={styles.shieldValue}>{props.value}</span>
    </a>
  );
}

/** Tauri 官方标识（simple-icons 单色，CC0；与 SiteHeader 的 GithubIcon 同源做法）。 */
function TauriMark() {
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.912 0a8.72 8.72 0 0 0-8.308 6.139c1.05-.515 2.18-.845 3.342-.976 2.415-3.363 7.4-3.412 9.88-.097 2.48 3.315 1.025 8.084-2.883 9.45a6.131 6.131 0 0 1-.3 2.762 8.72 8.72 0 0 0 3.01-1.225A8.72 8.72 0 0 0 13.913 0zm.082 6.451a2.284 2.284 0 1 0-.15 4.566 2.284 2.284 0 0 0 .15-4.566zm-5.629.27a8.72 8.72 0 0 0-3.031 1.235 8.72 8.72 0 1 0 13.06 9.9131 10.173 10.174 0 0 1-3.343.965 6.125 6.125 0 1 1-7.028-9.343 6.114 6.115 0 0 1 .342-2.772zm1.713 6.27a2.284 2.284 0 0 0-2.284 2.283 2.284 2.284 0 0 0 2.284 2.284 2.284 2.284 0 0 0 2.284-2.284 2.284 2.284 0 0 0-2.284-2.284z" />
    </svg>
  );
}

export function SiteFooter() {
  const styles = useStyles();
  const release = useLatestRelease();

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandRow}>
          <img className={styles.logo} src={logoUrl} alt="EmoBox logo" />
          <span className={styles.brandName}>EmoBox</span>
          <span className={styles.dot}>·</span>
          <span>Windows 本地表情包管理器</span>
        </div>
        <div className={styles.badges}>
          <Shield label="GitHub" value="ldm0715/emobox" href={REPO_URL} icon={<GithubIcon />} />
          <Shield label="License" value="GPL-3.0" href={LICENSE_URL} icon={<ShieldCheckmark20Regular />} />
          <Shield label="Latest" value={`v${release.version}`} href={RELEASES_URL} icon={<Tag20Regular />} />
          <Shield label="powered by" value="Tauri v2" href={TAURI_URL} icon={<TauriMark />} />
        </div>
        <div className={styles.copyright}>© 2026 EmoBox contributors · 基于 Tauri v2 + React + Fluent UI 构建</div>
      </div>
    </footer>
  );
}
