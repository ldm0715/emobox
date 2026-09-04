import {
  Badge,
  Button,
  Dropdown,
  Link,
  Option,
  Switch,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import {
  Alert20Regular,
  Apps24Regular,
  CheckmarkCircle16Regular,
  ClipboardPaste20Regular,
  Color20Regular,
  Dismiss20Regular,
  Document20Regular,
  Folder20Regular,
  FolderOpen20Regular,
  Gif20Regular,
  Highlight20Regular,
  Home20Regular,
  Info24Regular,
  Keyboard24Regular,
  Link20Regular,
  ScanText20Regular,
  ShieldCheckmark20Regular,
  Storage24Regular,
} from "@fluentui/react-icons";
import { useState, type ReactNode } from "react";
import type { ThemePreference } from "../useSiteTheme";
import logoUrl from "../assets/logo.png";

/* ------------------------------------------------------------------ */
/* 设置弹层（1:1 复刻应用 SettingsMenu；在演示窗口内部弹出，            */
/* 760×680 固定尺寸，开关可拨动但不持久化）                              */
/* ------------------------------------------------------------------ */

type SettingsSection = "general" | "shortcuts" | "storage" | "about";

const NAV_ITEMS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: "general", label: "常规", icon: <Apps24Regular /> },
  { id: "shortcuts", label: "快捷键", icon: <Keyboard24Regular /> },
  { id: "storage", label: "存储与导入", icon: <Storage24Regular /> },
  { id: "about", label: "关于", icon: <Info24Regular /> },
];

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const FEATURES = [
  "受管导入 · 原文件永不动",
  "秒速搜索 · 组*标签语法",
  "全局搜索浮层 · Ctrl+Alt+Space",
  "GIF 动图保真粘贴",
  "SHA-256 + dHash 双重去重",
  "分组 / 标签 / 收藏 / 回收站",
  "OCR 识图自动打标签",
  "应用内自动更新",
  "本地优先 · 数据不出本机",
];

const DEPENDENCIES: { name: string; url: string }[] = [
  { name: "Tauri", url: "https://github.com/tauri-apps/tauri" },
  { name: "React", url: "https://github.com/facebook/react" },
  { name: "Fluent UI", url: "https://github.com/microsoft/fluentui" },
  { name: "Vite", url: "https://github.com/vitejs/vite" },
  { name: "TypeScript", url: "https://github.com/microsoft/TypeScript" },
];

const useStyles = makeStyles({
  // 尺寸照抄应用 DialogSurface：min(760px, 100vw-48px) × min(680px, 100vh-48px)。
  // 演示窗口固定 1100×720，这里恒为 760×680 居中。
  surface: {
    width: "760px",
    height: "680px",
    maxWidth: "calc(100% - 32px)",
    maxHeight: "calc(100% - 32px)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow16,
    animationName: {
      from: { opacity: "0", transform: "scale(0.96)" },
      to: { opacity: "1", transform: "scale(1)" },
    },
    animationDuration: tokens.durationFast,
    animationTimingFunction: tokens.curveEasyEase,
  },
  titleBar: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    height: "48px",
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalXS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  brandTitle: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  brandLogo: {
    width: "20px",
    height: "20px",
    display: "block",
  },
  content: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "208px minmax(0, 1fr)",
    backgroundColor: tokens.colorNeutralBackground2,
    overflow: "hidden",
  },
  navigation: {
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM} ${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  navItem: {
    position: "relative",
    minHeight: "32px",
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr)",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalM,
    padding: `0 ${tokens.spacingHorizontalM}`,
    border: "none",
    background: "transparent",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    ":hover": {
      color: tokens.colorNeutralForeground1,
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
  },
  navItemSelected: {
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    "& > svg": {
      color: tokens.colorBrandForeground1,
    },
    "&::before": {
      content: '""',
      position: "absolute",
      left: "0",
      top: "50%",
      transform: "translateY(-50%)",
      width: "3px",
      height: "18px",
      borderRadius: tokens.borderRadiusCircular,
      backgroundColor: tokens.colorBrandStroke1,
    },
  },
  panel: {
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    maxWidth: "640px",
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXL} ${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`,
  },
  pageHeader: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    marginBottom: tokens.spacingVerticalXXL,
  },
  pageTitle: {
    margin: "0",
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
  },
  pageSubtitle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase400,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    marginBottom: tokens.spacingVerticalXXL,
    ":last-child": {
      marginBottom: "0",
    },
  },
  groupTitle: {
    margin: "0",
    marginBottom: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  settingRow: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
  },
  rowIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    alignSelf: "center",
    color: tokens.colorNeutralForeground2,
    "& svg": {
      width: "20px",
      height: "20px",
      display: "block",
      flexShrink: 0,
    },
  },
  settingText: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalSNudge,
  },
  settingLabel: {
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  settingDetail: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  dropdownMin: {
    minWidth: "126px",
  },
  keyRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  key: {
    padding: `1px ${tokens.spacingHorizontalXS}`,
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    textDecoration: "none",
    ":hover": {
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
  },
  featureGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.spacingVerticalS,
  },
  featureItem: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    "& svg": {
      color: tokens.colorPaletteGreenForeground1,
      flexShrink: 0,
    },
  },
  aboutFooter: {
    marginTop: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  updateSwitchActions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  pathRow: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
});

function LabelInfo(props: { label: string; detail: string }) {
  const styles = useStyles();
  return (
    <div className={styles.settingText}>
      <span className={styles.settingLabel}>{props.label}</span>
      <span className={styles.settingDetail}>{props.detail}</span>
    </div>
  );
}

export function SettingsMockup(props: {
  open: boolean;
  onClose: () => void;
  onNotify: (title: string) => void;
  /** 演示窗口的局部主题（与应用语义一致：设置页与工具栏按钮是同一份设置）。 */
  theme: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
}) {
  const styles = useStyles();

  const [section, setSection] = useState<SettingsSection>("general");
  const [closeToTray, setCloseToTray] = useState(false);
  const [defaultView, setDefaultView] = useState("all");
  const [autoPaste, setAutoPaste] = useState(true);
  const [selectionSearch, setSelectionSearch] = useState(true);
  const [downloadWebGif, setDownloadWebGif] = useState(false);
  const [ocrEngine, setOcrEngine] = useState("windows");
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  function checkUpdate() {
    setCheckingUpdate(true);
    window.setTimeout(() => {
      setCheckingUpdate(false);
      props.onNotify("已是最新版本 v0.1.3（演示）");
    }, 900);
  }

  function PageHeader(props: { title: string; subtitle: string }) {
    return (
      <header className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>{props.title}</h2>
        <div className={styles.pageSubtitle}>{props.subtitle}</div>
      </header>
    );
  }

  function renderGeneral() {
    return (
      <>
        <PageHeader title="常规" subtitle="主题、启动视图与行为开关。" />
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>外观</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <Color20Regular />
            </span>
            <LabelInfo label="主题" detail="顶部工具栏的主题按钮与这里使用同一份设置。" />
            <Dropdown
              className={styles.dropdownMin}
              value={THEME_OPTIONS.find((option) => option.value === props.theme)?.label}
              selectedOptions={[props.theme]}
              onOptionSelect={(_, data) =>
                data.optionValue && props.onThemeChange(data.optionValue as ThemePreference)
              }
            >
              {THEME_OPTIONS.map((option) => (
                <Option key={option.value} value={option.value}>
                  {option.label}
                </Option>
              ))}
            </Dropdown>
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>通用</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <FolderOpen20Regular />
            </span>
            <LabelInfo
              label="关闭窗口时最小化到系统托盘"
              detail="开启后，点击关闭按钮时主窗口驻留系统托盘、从托盘菜单退出；关闭则直接退出应用。未记住选择时，点击关闭按钮会先询问。"
            />
            <Switch
              checked={closeToTray}
              onChange={(_, data) => setCloseToTray(data.checked)}
              aria-label="关闭窗口时最小化到系统托盘"
            />
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <Home20Regular />
            </span>
            <div className={styles.settingText}>
              <span className={styles.settingLabel}>默认启动页面</span>
            </div>
            <Dropdown
              className={styles.dropdownMin}
              value={defaultView === "all" ? "全部表情" : defaultView === "recent" ? "最近使用" : "收藏"}
              selectedOptions={[defaultView]}
              onOptionSelect={(_, data) => data.optionValue && setDefaultView(data.optionValue)}
            >
              <Option value="all">全部表情</Option>
              <Option value="recent">最近使用</Option>
              <Option value="favorites">收藏</Option>
            </Dropdown>
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>行为</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <ClipboardPaste20Regular />
            </span>
            <LabelInfo
              label="自动粘贴到原窗口"
              detail="在浮层选中表情后自动粘贴回唤起浮层的窗口；关闭后仅复制到剪贴板。"
            />
            <Switch
              checked={autoPaste}
              onChange={(_, data) => setAutoPaste(data.checked)}
              aria-label="选择表情后自动粘贴到打开浮层前的窗口"
            />
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <Highlight20Regular />
            </span>
            <LabelInfo
              label="用选中文字自动搜索"
              detail="打开浮层时用当前选中文字作为搜索词，选中文字会被剪切，粘贴表情时正好替换原文字。"
            />
            <Switch
              checked={selectionSearch}
              onChange={(_, data) => setSelectionSearch(data.checked)}
              aria-label="打开浮层时用选中文字自动搜索"
            />
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <Gif20Regular />
            </span>
            <LabelInfo
              label="联网下载网页 GIF"
              detail="浏览器复制的动图只有静态首帧，开启后下载原始 GIF 保留动画。仅请求剪贴板上的 .gif 链接，不上传任何数据。"
            />
            <Switch
              checked={downloadWebGif}
              onChange={(_, data) => setDownloadWebGif(data.checked)}
              aria-label="联网下载网页 GIF"
            />
          </div>
        </div>
      </>
    );
  }

  function renderShortcuts() {
    return (
      <>
        <PageHeader title="全局快捷键" subtitle="在任意应用中唤起 EmoBox 的组合键。" />
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>快捷键</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <Keyboard24Regular />
            </span>
            <LabelInfo
              label="打开快捷搜索浮层"
              detail="在任意应用中唤出或隐藏独立搜索浮层。快捷键须包含 Ctrl、Alt、Shift 或 Win。"
            />
            <div className={styles.keyRow}>
              <span className={styles.key}>Ctrl</span>+
              <span className={styles.key}>Alt</span>+
              <span className={styles.key}>Space</span>
              <Button size="small" onClick={() => props.onNotify("演示版不可修改快捷键")}>
                修改
              </Button>
            </div>
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <ScanText20Regular />
            </span>
            <LabelInfo
              label="收藏剪贴板图片"
              detail="按组合键把当前剪贴板图片保存到素材库；仅由你主动触发，不监听剪贴板。"
            />
            <div className={styles.keyRow}>
              <span className={styles.key}>Ctrl</span>+
              <span className={styles.key}>Alt</span>+
              <span className={styles.key}>S</span>
              <Button size="small" onClick={() => props.onNotify("演示版不可修改快捷键")}>
                修改
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  function renderStorage() {
    return (
      <>
        <PageHeader title="存储与导入" subtitle="素材库位置、导入行为与隐私边界。" />
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>存储</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <Folder20Regular />
            </span>
            <div className={styles.settingText}>
              <span className={styles.settingLabel}>素材库位置</span>
              <span className={styles.pathRow}>%APPDATA%\com.emobox.app</span>
            </div>
            <Button
              size="small"
              icon={<FolderOpen20Regular />}
              onClick={() => props.onNotify("演示版无法打开本机文件夹")}
            >
              打开文件夹
            </Button>
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>文字识别（OCR）</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <ScanText20Regular />
            </span>
            <LabelInfo
              label="识别引擎"
              detail="导入后自动识别图片中的文字并转为标签。系统 OCR / Tesseract 完全本地离线；AI Studio 云端识别更准，但图片会上传到百度服务器。"
            />
            <Dropdown
              className={styles.dropdownMin}
              value={
                ocrEngine === "windows"
                  ? "系统 OCR（本地）"
                  : ocrEngine === "tesseract"
                    ? "Tesseract（本地）"
                    : "AI Studio（云端）"
              }
              selectedOptions={[ocrEngine]}
              onOptionSelect={(_, data) => data.optionValue && setOcrEngine(data.optionValue)}
            >
              <Option value="windows">系统 OCR（本地）</Option>
              <Option value="tesseract">Tesseract（本地）</Option>
              <Option value="aiStudio">AI Studio（云端）</Option>
            </Dropdown>
          </div>
        </div>
      </>
    );
  }

  function renderAbout() {
    return (
      <>
        <PageHeader title="关于" subtitle="本地优先的表情素材管理工具，无需账号或网络服务。" />
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>项目</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <Link20Regular />
            </span>
            <div className={styles.settingText}>
              <span className={styles.settingLabel}>仓库</span>
            </div>
            <a
              className={styles.chip}
              href="https://github.com/ldm0715/emobox"
              target="_blank"
              rel="noreferrer"
            >
              <span>ldm0715/emobox</span>
            </a>
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <Document20Regular />
            </span>
            <div className={styles.settingText}>
              <span className={styles.settingLabel}>开源协议</span>
            </div>
            <a
              className={styles.chip}
              href="https://github.com/ldm0715/emobox/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
            >
              <ShieldCheckmark20Regular />
              <span>GPL-3.0</span>
            </a>
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>更新</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <Alert20Regular />
            </span>
            <LabelInfo
              label="自动检查更新"
              detail="每次启动 EmoBox 时静默检查 GitHub Releases 上的新版本，发现新版本会弹窗提示。"
            />
            <div className={styles.updateSwitchActions}>
              <Switch
                checked={autoCheckUpdates}
                onChange={(_, data) => setAutoCheckUpdates(data.checked)}
                aria-label="自动检查更新"
              />
              <Button disabled={checkingUpdate} onClick={checkUpdate}>
                {checkingUpdate ? "检查中…" : "检查更新"}
              </Button>
            </div>
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>当前功能</h3>
          <div className={mergeClasses(styles.card, styles.featureGrid)}>
            {FEATURES.map((feature) => (
              <div key={feature} className={styles.featureItem}>
                <CheckmarkCircle16Regular />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>开源依赖</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}>
              <Link20Regular />
            </span>
            <div className={styles.settingText}>
              <span className={styles.settingDetail}>
                基于{" "}
                {DEPENDENCIES.map((dependency, index) => (
                  <span key={dependency.name}>
                    {index > 0 ? " · " : ""}
                    <Link href={dependency.url} target="_blank" rel="noreferrer">
                      {dependency.name}
                    </Link>
                  </span>
                ))}{" "}
                构建
              </span>
            </div>
          </div>
        </div>
        <div className={styles.aboutFooter}>© 2026 EmoBox · GPL-3.0</div>
      </>
    );
  }

  return (
    <div className={styles.surface} role="dialog" aria-label="EmoBox 设置（演示）">
      <div className={styles.titleBar}>
        <span className={styles.brandTitle}>
          <img src={logoUrl} alt="" className={styles.brandLogo} />
          <span>EmoBox</span>
          <Badge appearance="tint">v0.1.3</Badge>
        </span>
        <Button
          appearance="subtle"
          aria-label="关闭设置"
          icon={<Dismiss20Regular />}
          onClick={props.onClose}
        />
      </div>
      <div className={styles.content}>
        <nav className={styles.navigation} aria-label="设置分区">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={mergeClasses(styles.navItem, section === item.id && styles.navItemSelected)}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <section className={styles.panel}>
          {section === "general" && renderGeneral()}
          {section === "shortcuts" && renderShortcuts()}
          {section === "storage" && renderStorage()}
          {section === "about" && renderAbout()}
        </section>
      </div>
    </div>
  );
}
