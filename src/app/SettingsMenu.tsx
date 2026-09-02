import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Input,
  Option,
  Switch,
  Tooltip,
  mergeClasses,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  Apps24Regular,
  CheckmarkCircle16Regular,
  Dismiss20Regular,
  FolderOpen20Regular,
  Info16Regular,
  Info24Regular,
  Keyboard24Regular,
  SearchSquare20Regular,
  Storage24Regular,
} from "@fluentui/react-icons";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useAppSettings, type ThemePreference } from "../components/ThemeProvider";
import { openExternalUrl } from "../lib/tauri";
import { ShortcutEditor } from "../features/search/ShortcutEditor";
import type { DefaultLibraryView, StorageInfo } from "../types";
import { ABOUT_DEPENDENCIES } from "./aboutDependencies";
import { GithubIcon, MirrorSourceCard, UpdateCard } from "./aboutUpdate";
import { navItemBaseStyle, navItemSelectedStyle } from "./navItemStyles";
import logoUrl from "../assets/logo.png";

/** GitHub 仓库（关于页仓库 chip 与 LICENSE 链接共用）。 */
const REPO_URL = "https://github.com/ldm0715/emobox";

type SettingsSection = "general" | "shortcuts" | "storage" | "about";

interface SettingsDialogProps {
  open: boolean;
  storageInfo: StorageInfo | null;
  onOpenAssetsDirectory: () => void;
  onOpenChange: (open: boolean) => void;
  onPreviewQuickSearch: () => void;
  shortcutRegistered: boolean;
  shortcutError: string;
  onUpdateQuickSearchShortcut: (shortcut: string) => Promise<string | null>;
  clipboardCollectShortcut: string;
  clipboardCollectRegistered: boolean;
  clipboardCollectError: string;
  onUpdateClipboardCollectShortcut: (shortcut: string) => Promise<string | null>;
  onNotifyError: (message: string) => void;
}

const themeLabels: Record<ThemePreference, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

const viewLabels: Record<DefaultLibraryView, string> = {
  all: "全部表情",
  recent: "最近使用",
  favorites: "收藏",
  trash: "回收站",
  ungrouped: "未分组",
};

interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: ReactElement;
}

const settingsNavItems: SettingsNavItem[] = [
  { id: "general", label: "常规", icon: <Apps24Regular /> },
  { id: "shortcuts", label: "快捷键", icon: <Keyboard24Regular /> },
  { id: "storage", label: "存储与导入", icon: <Storage24Regular /> },
  { id: "about", label: "关于", icon: <Info24Regular /> },
];

const useStyles = makeStyles({
  surface: {
    width: "min(760px, calc(100vw - 48px))",
    maxWidth: "760px",
    height: "min(680px, calc(100vh - 48px))",
    maxHeight: "680px",
    overflow: "hidden",
    // 整个弹窗统一单一背景色（BG2，与 content 同场）：DialogSurface 默认是 BG1，
    // 会让标题条与内容灰场形成两块背景色；统一后标题/导航/面板同场，卡片（BG1）浮出。
    backgroundColor: tokens.colorNeutralBackground2,
  },
  body: {
    height: "100%",
    minHeight: 0,
  },
  content: {
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr)",
    gridTemplateColumns: "208px minmax(0, 1fr)",
    overflow: "hidden",
    // Win11 Settings 同款底色：内容区整体浅灰，白卡片自然浮出。
    backgroundColor: tokens.colorNeutralBackground2,
  },
  navigation: {
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM} ${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  navItem: {
    // 共享导航行范式（见 navItemStyles.ts），这里只定义设置左导航布局差异。
    ...navItemBaseStyle,
    minHeight: "32px",
    gridTemplateColumns: "24px minmax(0, 1fr)",
    columnGap: tokens.spacingHorizontalM,
    padding: `0 ${tokens.spacingHorizontalM}`,
    fontSize: tokens.fontSizeBase300,
  },
  navItemSelected: navItemSelectedStyle,
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
    margin: 0,
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
      marginBottom: 0,
    },
  },
  groupTitle: {
    margin: 0,
    marginBottom: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  // Win11 Settings 式轻量卡片：细边框 + 大圆角、无阴影；完整设置项整体成卡。
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  settingRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXL,
    // 内容区较窄时控件换到文案下方，左对齐、不溢出。
    "@media (max-width: 640px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
      rowGap: tokens.spacingVerticalS,
      justifyItems: "start",
    },
  },
  settingText: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalSNudge,
  },
  settingLabelRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  settingLabel: {
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  settingDescription: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase400,
    maxWidth: "480px",
  },
  dropdown: {
    minWidth: "180px",
  },
  shortcutItem: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  pathRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    width: "100%",
    flexWrap: "wrap",
    rowGap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalS,
  },
  pathInput: {
    flexGrow: 1,
    minWidth: "200px",
    input: {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: tokens.fontSizeBase100,
      color: tokens.colorNeutralForeground2,
    },
  },
  formatList: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
  },
  // 开源依赖 chip：卡片内 flex-wrap 的可点击标签（品牌单色图标 + 名称）。
  dependencyRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
  dependencyChip: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalSNudge} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    cursor: "pointer",
    "& svg": {
      width: "20px",
      height: "20px",
      display: "block",
      flexShrink: 0,
    },
    ":hover": {
      color: tokens.colorBrandForeground1,
      border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
    ":focus-visible": {
      outlineWidth: tokens.strokeWidthThick,
      outlineStyle: "solid",
      outlineColor: tokens.colorBrandStroke1,
      outlineOffset: "2px",
    },
  },
  // 设置弹窗标题栏的品牌行：logo + 名字 + 版本胶囊（Badge 为 tint 胶囊）。
  brandTitle: {
    display: "inline-flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  brandLogo: {
    width: "22px",
    height: "22px",
    display: "block",
    borderRadius: tokens.borderRadiusSmall,
  },
  // 当前功能清单：双列勾选行，比胶囊堆更克制、扫读更快。
  featureGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    rowGap: tokens.spacingVerticalXS,
    columnGap: tokens.spacingHorizontalL,
    "@media (max-width: 640px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
    },
  },
  featureItem: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase400,
    "& svg": {
      color: tokens.colorBrandForeground1,
      flexShrink: 0,
    },
  },
  aboutFooter: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

export function SettingsDialog({
  open,
  storageInfo,
  onOpenAssetsDirectory,
  onOpenChange,
  onPreviewQuickSearch,
  shortcutRegistered,
  shortcutError,
  onUpdateQuickSearchShortcut,
  clipboardCollectShortcut,
  clipboardCollectRegistered,
  clipboardCollectError,
  onUpdateClipboardCollectShortcut,
  onNotifyError,
}: SettingsDialogProps) {
  const styles = useStyles();
  const {
    theme,
    setTheme,
    defaultView,
    setDefaultView,
    quickSearchShortcut,
    autoPaste,
    setAutoPaste,
    selectionSearch,
    setSelectionSearch,
    downloadWebGif,
    setDownloadWebGif,
    closeToTray,
    setCloseToTray,
    autoCheckUpdates,
    setAutoCheckUpdates,
  } = useAppSettings();
  const [section, setSection] = useState<SettingsSection>("general");
  // 版本号随 tauri.conf.json 运行时读取（getVersion）；读到之前不渲染版本胶囊，
  // 不再写死回退值。
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  // 切换导航项时右侧内容滚回顶部。
  useEffect(() => {
    panelRef.current?.scrollTo(0, 0);
  }, [section]);

  // 版本号随 tauri.conf.json 运行时读取；读取失败保持 null（不渲染胶囊）。
  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((version) => {
        if (!cancelled && version) setAppVersion(version);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleOpenDependency(url: string, name: string) {
    try {
      await openExternalUrl(url);
    } catch (error) {
      onNotifyError(`无法打开 ${name} 的 GitHub 页面：${String(error)}`);
    }
  }

  /** 标题行旁的 Info 图标：把长说明收进 Tooltip，降低默认阅读负担。 */
  function LabelInfo({ label, detail }: { label: string; detail: string }) {
    return (
      <div className={styles.settingLabelRow}>
        <span>{label}</span>
        <Tooltip content={detail} relationship="description" withArrow>
          <span tabIndex={0} aria-label={`${label}详细说明`}><Info16Regular /></span>
        </Tooltip>
      </div>
    );
  }

  function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
      <header className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>{title}</h2>
        {subtitle && <div className={styles.pageSubtitle}>{subtitle}</div>}
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
            <div className={styles.settingText}>
              <LabelInfo label="主题" detail="顶部工具栏的主题按钮与这里使用同一份设置。" />
            </div>
            <Dropdown
              className={styles.dropdown}
              value={themeLabels[theme]}
              selectedOptions={[theme]}
              onOptionSelect={(_, data) => data.optionValue && setTheme(data.optionValue as ThemePreference)}
            >
              <Option value="system">跟随系统</Option>
              <Option value="light">浅色</Option>
              <Option value="dark">深色</Option>
            </Dropdown>
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>通用</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <div className={styles.settingText}>
              <LabelInfo
                label="关闭窗口时最小化到系统托盘"
                detail="开启后，点击关闭按钮时主窗口驻留系统托盘、从托盘菜单退出；关闭则直接退出应用。未记住选择时，点击关闭按钮会先询问。"
              />
            </div>
            <Switch
              checked={closeToTray ?? false}
              onChange={(_, data) => setCloseToTray(data.checked)}
              aria-label="关闭窗口时最小化到系统托盘"
            />
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <div className={styles.settingText}>
              <div className={styles.settingLabel}>默认启动页面</div>
            </div>
            <Dropdown
              className={styles.dropdown}
              value={viewLabels[defaultView]}
              selectedOptions={[defaultView]}
              onOptionSelect={(_, data) => data.optionValue && setDefaultView(data.optionValue as DefaultLibraryView)}
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
            <div className={styles.settingText}>
              <LabelInfo
                label="自动粘贴到原窗口"
                detail="在浮层选中表情后自动粘贴回唤起浮层的窗口；关闭后仅复制到剪贴板。"
              />
            </div>
            <Switch
              checked={autoPaste}
              onChange={(_, data) => setAutoPaste(data.checked)}
              aria-label="选择表情后自动粘贴到打开浮层前的窗口"
            />
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <div className={styles.settingText}>
              <LabelInfo
                label="用选中文字自动搜索"
                detail="打开浮层时用当前选中文字作为搜索词；选中文字会被剪切，粘贴表情时正好替换原文字，放弃选择可手动 Ctrl+V 找回。文字仅用作搜索、不会保存；读取不到时浮层正常打开，兼容性不佳的应用会以模拟 Ctrl+X 方式读取。"
              />
            </div>
            <Switch
              checked={selectionSearch}
              onChange={(_, data) => setSelectionSearch(data.checked)}
              aria-label="打开浮层时用选中文字自动搜索"
            />
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <div className={styles.settingText}>
              <LabelInfo
                label="联网下载网页 GIF"
                detail="浏览器复制的动图只有静态首帧，开启后下载原始 GIF 保留动画。仅请求剪贴板上的 .gif 链接，超时 15 秒、单文件上限 20 MB，不上传任何数据；QQ/Firefox 复制走本地数据，无需联网、不受此开关影响。"
              />
            </div>
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
          <div className={mergeClasses(styles.card, styles.shortcutItem)}>
            <LabelInfo
              label="快速搜索"
              detail="在任意应用中唤出或隐藏独立搜索浮层。快捷键须包含 Ctrl、Alt、Shift 或 Win，可直接键入或点击「录制」。"
            />
            <ShortcutEditor
              shortcut={quickSearchShortcut}
              registered={shortcutRegistered}
              registrationError={shortcutError}
              onApply={onUpdateQuickSearchShortcut}
            />
          </div>
          <div className={mergeClasses(styles.card, styles.shortcutItem)}>
            <LabelInfo
              label="从剪贴板收藏"
              detail="按组合键把当前剪贴板图片保存到素材库；仅由你主动触发，不监听剪贴板。快捷键须包含 Ctrl、Alt、Shift 或 Win，可直接键入或点击「录制」。"
            />
            <ShortcutEditor
              shortcut={clipboardCollectShortcut}
              registered={clipboardCollectRegistered}
              registrationError={clipboardCollectError}
              onApply={onUpdateClipboardCollectShortcut}
              ariaLabel="从剪贴板收藏全局快捷键"
              placeholder="例如 Ctrl+Alt+S"
            />
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>快捷操作</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <div className={styles.settingText}>
              <LabelInfo label="打开快捷搜索浮层" detail="与全局快捷键打开同一个独立搜索窗口。" />
            </div>
            <Button
              icon={<SearchSquare20Regular />}
              onClick={() => {
                onOpenChange(false);
                window.setTimeout(onPreviewQuickSearch, 0);
              }}
            >
              打开浮层
            </Button>
          </div>
        </div>
      </>
    );
  }

  function renderStorage() {
    const libraryPath = storageInfo?.emojisDirectory ?? "正在读取素材库位置";
    const formats = storageInfo?.supportedFormats ?? ["PNG", "JPG", "JPEG", "GIF", "WebP"];
    return (
      <>
        <PageHeader title="存储与导入" subtitle="素材库位置、导入行为与隐私边界。" />
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>素材库位置</h3>
          <div className={mergeClasses(styles.card, styles.settingText)}>
            <div className={styles.settingLabel}>EmoBox 素材库</div>
            <div className={styles.pathRow}>
              <Input
                className={styles.pathInput}
                readOnly
                value={libraryPath}
                aria-label="素材库路径"
                title={libraryPath}
              />
              <Button
                icon={<FolderOpen20Regular />}
                disabled={!storageInfo}
                onClick={onOpenAssetsDirectory}
              >
                在资源管理器中打开
              </Button>
            </div>
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>导入与索引</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <div className={styles.settingText}>
              <LabelInfo
                label="导入与索引方式"
                detail="导入图片、拖拽或导入文件夹都会复制进素材库；导入文件夹会自动按子文件夹建立同名分组。只处理你主动导入、拖入或主动从剪贴板收藏的图片，不会读取微信、QQ 的聊天记录、缓存或私密目录。"
              />
            </div>
            <Badge appearance="tint">仅本地处理</Badge>
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <div className={styles.settingText}>
              <div className={styles.settingLabel}>支持格式</div>
              <div className={styles.formatList}>
                {formats.map((format) => <Badge key={format} appearance="outline">{format}</Badge>)}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }
  function renderAbout() {
    const features = [
      "图片导入与拖拽",
      "SHA-256 去重",
      "搜索",
      "快捷搜索浮层",
      "自动粘贴",
      "系统托盘",
      "最近使用",
      "缩略图",
      "主题",
    ];
    return (
      <>
        <PageHeader title="关于" subtitle="项目信息、更新与开源组件。" />
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>项目</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <div className={styles.settingText}>
              <div className={styles.settingLabel}>仓库</div>
              <div className={styles.settingDescription}>
                本地优先的表情素材管理工具，无需账号或网络服务。
              </div>
            </div>
            <button
              type="button"
              className={styles.dependencyChip}
              onClick={() => void handleOpenDependency(REPO_URL, "EmoBox 仓库")}
            >
              <GithubIcon />
              <span>ldm0715/emobox</span>
            </button>
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <div className={styles.settingText}>
              <div className={styles.settingLabel}>开源协议</div>
              <div className={styles.settingDescription}>
                以 GPL-3.0 协议开源：可自由使用、修改与分发，衍生版本须以同协议开源并保留版权声明。
              </div>
            </div>
            <button
              type="button"
              className={styles.dependencyChip}
              onClick={() => void handleOpenDependency(`${REPO_URL}/blob/main/LICENSE`, "GPL-3.0 协议")}
            >
              <span>GPL-3.0</span>
            </button>
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>更新</h3>
          <UpdateCard appVersion={appVersion} onNotifyError={onNotifyError} />
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <div className={styles.settingText}>
              <LabelInfo
                label="自动检查更新"
                detail="每次启动 EmoBox 时静默检查 GitHub Releases 上的新版本，发现新版本会弹提示；可随时在这里手动检查。检查与下载走「镜像源」加速。"
              />
            </div>
            <Switch
              checked={autoCheckUpdates}
              onChange={(_, data) => setAutoCheckUpdates(data.checked)}
              aria-label="自动检查更新"
            />
          </div>
          <MirrorSourceCard onNotifyError={onNotifyError} />
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>当前功能</h3>
          <div className={mergeClasses(styles.card, styles.featureGrid)}>
            {features.map((feature) => (
              <div key={feature} className={styles.featureItem}>
                <CheckmarkCircle16Regular />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>开源依赖</h3>
          <div className={mergeClasses(styles.card, styles.dependencyRow)}>
            {ABOUT_DEPENDENCIES.map(({ name, url, Icon }) => (
              <button
                key={name}
                type="button"
                className={styles.dependencyChip}
                onClick={() => void handleOpenDependency(url, name)}
              >
                <Icon />
                <span>{name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.aboutFooter}>© 2026 EmoBox · GPL-3.0</div>
      </>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className={styles.surface}>
        <DialogBody className={styles.body}>
          <DialogTitle
            action={
              <Tooltip content="关闭设置" relationship="label">
                <Button appearance="subtle" aria-label="关闭设置" icon={<Dismiss20Regular />} onClick={() => onOpenChange(false)} />
              </Tooltip>
            }
          >
            {/* 设置页最顶端品牌行：logo + 名字 + 版本胶囊（版本运行时读取）。 */}
            <span className={styles.brandTitle}>
              <img src={logoUrl} alt="" className={styles.brandLogo} />
              <span>EmoBox</span>
              {appVersion && <Badge appearance="tint">v{appVersion}</Badge>}
            </span>
          </DialogTitle>
          <DialogContent className={styles.content}>
            <nav className={styles.navigation} aria-label="设置分区">
              {settingsNavItems.map((item) => (
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
            <section className={styles.panel} ref={panelRef}>
              {section === "general" && renderGeneral()}
              {section === "shortcuts" && renderShortcuts()}
              {section === "storage" && renderStorage()}
              {section === "about" && renderAbout()}
            </section>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
