import { Button, makeStyles, tokens } from "@fluentui/react-components";
import {
  ArrowDownload20Regular,
  ChatMultiple20Regular,
  Desktop20Regular,
  Open20Regular,
  Rocket20Regular,
  Sparkle20Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
  type FluentIcon,
} from "@fluentui/react-icons";
import { useSiteThemeContext } from "../themeContext";
import { useLatestRelease } from "../useLatestRelease";
import logoUrl from "../assets/logo.png";

const useStyles = makeStyles({
  header: {
    position: "sticky",
    top: "0",
    zIndex: 10,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  inner: {
    maxWidth: "1120px",
    margin: "0 auto",
    paddingLeft: "24px",
    paddingRight: "24px",
    height: "56px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginRight: "8px",
  },
  logo: {
    width: "26px",
    height: "26px",
    display: "block",
  },
  brandName: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  nav: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    marginLeft: "auto",
    "@media (max-width: 760px)": {
      display: "none",
    },
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    "@media (min-width: 761px)": {
      marginLeft: "12px",
    },
    "@media (max-width: 760px)": {
      marginLeft: "auto",
    },
  },
  githubIcon: {
    width: "16px",
    height: "16px",
    display: "block",
  },
});

const NAV_ITEMS: { href: string; label: string; icon: FluentIcon }[] = [
  { href: "#pain-points", label: "痛点", icon: ChatMultiple20Regular },
  { href: "#showcase", label: "界面", icon: Desktop20Regular },
  { href: "#features", label: "特性", icon: Sparkle20Regular },
  { href: "#workflow", label: "上手", icon: Rocket20Regular },
];

/** GitHub 专用标识（simple-icons 单色，CC0；与应用 aboutUpdate.tsx 的 GithubIcon 同源）。 */
export function GithubIcon() {
  return (
    <svg role="img" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function SiteHeader() {
  const styles = useStyles();
  const { resolved, setPreference } = useSiteThemeContext();
  const release = useLatestRelease();

  // 主题图标展示当前状态：深色显示月亮、浅色显示太阳，点击切换到相反主题。
  const nextTheme = resolved === "dark" ? "light" : "dark";

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <img className={styles.logo} src={logoUrl} alt="EmoBox logo" />
          <span className={styles.brandName}>EmoBox</span>
        </div>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Button key={item.href} as="a" href={item.href} appearance="subtle" size="small" icon={<Icon />}>
                {item.label}
              </Button>
            );
          })}
          {/* 下载：点击直接下载最新版安装包（直链，不跳转 Releases 页） */}
          <Button
            as="a"
            href={release.setupUrl}
            appearance="subtle"
            size="small"
            icon={<ArrowDownload20Regular />}
            title={`直接下载 EmoBox v${release.version} 安装包`}
          >
            下载
          </Button>
        </nav>
        <div className={styles.actions}>
          <Button
            appearance="subtle"
            size="small"
            icon={resolved === "dark" ? <WeatherMoon20Regular /> : <WeatherSunny20Regular />}
            aria-label="切换主题"
            title="切换主题"
            onClick={() => setPreference(nextTheme)}
          />
          <Button
            as="a"
            href="https://github.com/ldm0715/emobox"
            target="_blank"
            rel="noreferrer"
            appearance="subtle"
            size="small"
            icon={<GithubIcon />}
          >
            GitHub
          </Button>
        </div>
      </div>
    </header>
  );
}
