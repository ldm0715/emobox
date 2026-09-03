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
  Spinner,
  Switch,
  Toast,
  ToastTitle,
  Toaster,
  Tooltip,
  mergeClasses,
  makeStyles,
  tokens,
  useToastController,
} from "@fluentui/react-components";
import {
  Alert20Regular,
  ArrowClockwise20Regular,
  ArrowMinimize20Regular,
  ArrowUpload20Regular,
  ClipboardPaste20Regular,
  Color20Regular,
  Document20Regular,
  Gif20Regular,
  Highlight20Regular,
  Home20Regular,
  Image20Regular,
  ImageMultiple20Regular,
  Link20Regular,
  ScanText20Regular,
  Search20Regular,
  ShieldCheckmark20Regular,
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
import {
  backfillOcrTags,
  checkForUpdate,
  getErrorMessage,
  getOcrCapabilities,
  openExternalUrl,
} from "../lib/tauri";
import { ShortcutEditor } from "../features/search/ShortcutEditor";
import type {
  DefaultLibraryView,
  OcrCapabilities,
  OcrEngineKind,
  OcrTagsUpdatedPayload,
  StorageInfo,
  UpdateCheckResult,
} from "../types";
import { ABOUT_DEPENDENCIES } from "./aboutDependencies";
import { GithubIcon, MirrorSourceCard } from "./aboutUpdate";
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
  /** 手动检查发现新版本时回调（App 层据此打开更新弹窗）。 */
  onUpdateAvailable: (result: UpdateCheckResult & { status: "available" }) => void;
  /** OCR 存量回填进度（App 层从 ocr-tags-updated 事件聚合；null = 本会话没跑过）。 */
  ocrBackfill: OcrTagsUpdatedPayload | null;
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

const ocrEngineLabels: Record<OcrEngineKind, string> = {
  off: "关闭",
  windows: "系统 OCR（本地）",
  tesseract: "Tesseract OCR（本地）",
  aiStudio: "AI Studio PaddleOCR（云端）",
};

/** AI Studio 识别模型（v2 异步 API 的 model 请求参数）→ 下拉展示文案。 */
const aiStudioModelLabels: Record<string, string> = {
  "PP-OCRv6": "PP-OCRv6（纯文字识别，推荐）",
  "PP-OCRv5": "PP-OCRv5（纯文字识别）",
};

/** AI Studio 控制台入口（openExternalUrl 主机白名单内的唯一百度域名）。 */
const AI_STUDIO_CONSOLE_URL = "https://aistudio.baidu.com/paddleocr/task";

/** Tesseract Windows 安装包说明页（github.com 在 openExternalUrl 白名单内）。 */
const TESSERACT_DOWNLOAD_URL = "https://github.com/UB-Mannheim/tesseract/wiki";

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
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalL,
    // 内容区较窄时控件换到文案下方（跟文案同列、不顶到图标下方），左对齐、不溢出。
    "@media (max-width: 640px)": {
      gridTemplateColumns: "auto minmax(0, 1fr)",
      rowGap: tokens.spacingVerticalS,
      justifyItems: "start",
      "& > *:nth-child(3)": {
        gridColumn: 2,
      },
    },
  },
  // 图标 + 纵向内容（无右置控件）的两列行：素材库路径、快捷键卡、功能/依赖清单。
  settingRowStack: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "start",
    columnGap: tokens.spacingHorizontalL,
  },
  // 设置行左端的 Fluent 20px 图标（Win11 设置同范式，弱化色）。
  rowIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
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
  // 「自动检查更新」行右端：Switch + 检查更新按钮并排（三列 settingRow 的控件列）。
  updateSwitchActions: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
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
  // Phase 32：AI Studio API URL / Token 两个输入框的纵排容器与全宽输入。
  ocrFields: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalS,
  },
  ocrInput: {
    width: "100%",
    input: {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: tokens.fontSizeBase200,
    },
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
  onUpdateAvailable,
  ocrBackfill,
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
    updateMirrors,
    ocrEngine,
    setOcrEngine,
    aiStudioOcrApiUrl,
    setAiStudioOcrApiUrl,
    aiStudioOcrToken,
    setAiStudioOcrToken,
    aiStudioOcrModel,
    setAiStudioOcrModel,
    tesseractPath,
    setTesseractPath,
  } = useAppSettings();
  // 「检查更新」的就地反馈 toaster（top-end，与主窗口一致）。
  const toasterId = "settings-update-toaster";
  const { dispatchToast } = useToastController(toasterId);
  const [section, setSection] = useState<SettingsSection>("general");
  // 版本号随 tauri.conf.json 运行时读取（getVersion）；读到之前不渲染版本胶囊，
  // 不再写死回退值。
  const [appVersion, setAppVersion] = useState<string | null>(null);
  // 「检查更新」按钮检查中态。发现新版本 → onUpdateAvailable 交给 App 层弹窗；
  // 已是最新 / 没有发布 / 出错 → toast 反馈（弹窗只在有新版本时出现）。
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  // Phase 32：Windows OCR / Tesseract 可用性（进入「存储与导入」页时懒检测一次；
  // 「重新检测」按钮把它置回 null 复用同一条懒检测链路重拉）。
  const [ocrCaps, setOcrCaps] = useState<OcrCapabilities | null>(null);
  // 存量回填触发中的短暂状态（await backfillOcrTags 期间）；批处理进度
  // 由 App 层经 ocrBackfill 事件 state 传入。
  const [backfillStarting, setBackfillStarting] = useState(false);
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

  // 引擎可用性探测要跑 WinRT / spawn Tesseract 进程（Rust 侧 spawn_blocking），
  // 只在首次进入「存储与导入」时做一次，失败静默（显示"检测中"不阻塞）。
  useEffect(() => {
    if (section !== "storage" || ocrCaps) return;
    let cancelled = false;
    getOcrCapabilities()
      .then((capabilities) => {
        if (!cancelled) setOcrCaps(capabilities);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [section, ocrCaps]);

  const backfillRunning = ocrBackfill !== null && !ocrBackfill.finished;

  // 存量回填：命令立即返回待识别总数，识别在后台进行、进度经
  // ocr-tags-updated 事件推进（App 层转成 ocrBackfill state 传回这里）。
  async function handleBackfillOcr() {
    setBackfillStarting(true);
    try {
      const total = await backfillOcrTags();
      if (total === 0) {
        dispatchToast(
          <Toast>
            <ToastTitle>所有表情都已识别过，没有待处理的条目</ToastTitle>
          </Toast>,
          { intent: "info" },
        );
      }
    } catch (error) {
      onNotifyError(`触发存量识别失败：${getErrorMessage(error)}`);
    } finally {
      setBackfillStarting(false);
    }
  }

  // 「检查更新」按钮：发现新版本交给 App 层弹窗；其余结果就地 toast 反馈
  // （弹窗只在有新版本时出现，检查职责在这里完成）。
  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    try {
      const result = await checkForUpdate(updateMirrors);
      if (result.status === "available") {
        onUpdateAvailable(result);
      } else if (result.status === "upToDate") {
        dispatchToast(
          <Toast>
            <ToastTitle>已是最新版本（v{result.currentVersion}）</ToastTitle>
          </Toast>,
          { intent: "success" },
        );
      } else if (result.status === "noRelease") {
        dispatchToast(
          <Toast>
            <ToastTitle>仓库还没有发布任何版本</ToastTitle>
          </Toast>,
          { intent: "info" },
        );
      } else {
        onNotifyError(result.message);
      }
    } catch (error) {
      onNotifyError(`检查更新失败：${getErrorMessage(error)}`);
    } finally {
      setCheckingUpdate(false);
    }
  }

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
            <span className={styles.rowIcon}><Color20Regular /></span>
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
            <span className={styles.rowIcon}><ArrowMinimize20Regular /></span>
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
            <span className={styles.rowIcon}><Home20Regular /></span>
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
            <span className={styles.rowIcon}><ClipboardPaste20Regular /></span>
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
            <span className={styles.rowIcon}><Highlight20Regular /></span>
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
            <span className={styles.rowIcon}><Gif20Regular /></span>
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
          <div className={mergeClasses(styles.card, styles.settingRowStack)}>
            <span className={styles.rowIcon}><Search20Regular /></span>
            <div className={styles.shortcutItem}>
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
          </div>
          <div className={mergeClasses(styles.card, styles.settingRowStack)}>
            <span className={styles.rowIcon}><Image20Regular /></span>
            <div className={styles.shortcutItem}>
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
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>快捷操作</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}><SearchSquare20Regular /></span>
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
          <div className={mergeClasses(styles.card, styles.settingRowStack)}>
            <span className={styles.rowIcon}><FolderOpen20Regular /></span>
            <div className={styles.settingText}>
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
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>导入与索引</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}><ArrowUpload20Regular /></span>
            <div className={styles.settingText}>
              <LabelInfo
                label="导入与索引方式"
                detail="导入图片、拖拽或导入文件夹都会复制进素材库；导入文件夹会自动按子文件夹建立同名分组。只处理你主动导入、拖入或主动从剪贴板收藏的图片，不会读取微信、QQ 的聊天记录、缓存或私密目录。"
              />
            </div>
            <Badge appearance="tint">仅本地处理</Badge>
          </div>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}><ImageMultiple20Regular /></span>
            <div className={styles.settingText}>
              <div className={styles.settingLabel}>支持格式</div>
              <div className={styles.formatList}>
                {formats.map((format) => <Badge key={format} appearance="outline">{format}</Badge>)}
              </div>
            </div>
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>文字识别（OCR）</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}><ScanText20Regular /></span>
            <div className={styles.settingText}>
              <LabelInfo
                label="识别引擎"
                detail="导入完成后在后台识别图片中的文字并自动追加为标签（文件名标签保留不变，搜索时两路都能命中）。「系统 OCR」完全本地离线，零额度成本，中文识别依赖系统语言包；「Tesseract」是外置开源本地引擎，需自行安装并配置中文语言包，对风格化文字效果一般；「AI Studio PaddleOCR」是百度云端识别，对表情包文字更准，但图片会上传到百度服务器，且按张消耗每日免费额度。"
              />
            </div>
            <Dropdown
              className={styles.dropdown}
              value={ocrEngineLabels[ocrEngine]}
              selectedOptions={[ocrEngine]}
              onOptionSelect={(_, data) => setOcrEngine(data.optionValue as OcrEngineKind)}
            >
              <Option value="windows">系统 OCR（本地）</Option>
              <Option value="tesseract">Tesseract OCR（本地）</Option>
              <Option value="aiStudio">AI Studio PaddleOCR（云端）</Option>
              <Option value="off">关闭</Option>
            </Dropdown>
          </div>
          {ocrEngine === "windows" && (
            <div className={mergeClasses(styles.card, styles.settingRow)}>
              <span className={styles.rowIcon}><ShieldCheckmark20Regular /></span>
              <div className={styles.settingText}>
                <div className={styles.settingLabel}>本地识别状态</div>
                <div className={styles.settingDescription}>
                  {ocrCaps === null
                    ? "正在检测系统 OCR 可用性…"
                    : ocrCaps.windowsOcrAvailable
                      ? `可用，识别走本地引擎，图片不出本机。系统可用语言：${ocrCaps.windowsLanguages.join("、") || "系统默认"}。`
                      : "未检测到可用的识别语言：请在 Windows 设置 → 时间和语言 → 语言中为中文安装「文字识别」可选功能。缺语言包时识别失败会静默跳过，不影响导入。"}
                </div>
              </div>
              <Badge appearance="tint">{ocrCaps?.windowsOcrAvailable ? "仅本地处理" : "不可用"}</Badge>
            </div>
          )}
          {ocrEngine === "tesseract" && (
            <div className={mergeClasses(styles.card, styles.settingRowStack)}>
              <span className={styles.rowIcon}><ShieldCheckmark20Regular /></span>
              <div className={styles.settingText}>
                <div className={styles.settingLabel}>本地识别状态</div>
                <div className={styles.settingDescription}>
                  {ocrCaps === null
                    ? "正在检测本机 Tesseract 安装状态…"
                    : ocrCaps.tesseractAvailable
                      ? `已检测到 Tesseract${ocrCaps.tesseractVersion ? `（${ocrCaps.tesseractVersion}）` : ""}，识别走本地引擎，图片不出本机。已安装语言：${ocrCaps.tesseractLanguages.join("、") || "无"}。${ocrCaps.tesseractLanguages.includes("chi_sim") ? "" : "未检测到中文语言包（chi_sim），中文识别效果会很差：可重新运行安装程序勾选中文语言数据，或将 chi_sim.traineddata 复制到安装目录的 tessdata 文件夹。"}`
                      : "未检测到 Tesseract：它是一款开源本地 OCR，需自行安装（Windows 安装包由 UB-Mannheim 维护）。安装时建议在语言数据组件中勾选 Chinese (Simplified)，否则无法识别中文。"}
                </div>
                {ocrCaps !== null && !ocrCaps.tesseractAvailable && (
                  <div className={styles.pathRow}>
                    <Button
                      icon={<Link20Regular />}
                      onClick={() => {
                        openExternalUrl(TESSERACT_DOWNLOAD_URL).catch((error) =>
                          onNotifyError(`打开 Tesseract 下载页失败：${getErrorMessage(error)}`),
                        );
                      }}
                    >
                      打开 Tesseract 下载页
                    </Button>
                  </div>
                )}
                <div className={styles.ocrFields}>
                  <Input
                    className={styles.ocrInput}
                    placeholder="tesseract.exe 完整路径（可选，留空自动检测）"
                    value={tesseractPath}
                    onChange={(_, data) => setTesseractPath(data.value)}
                    aria-label="Tesseract 可执行文件路径"
                  />
                </div>
                <div className={styles.pathRow}>
                  <Button
                    icon={ocrCaps === null ? <Spinner size="tiny" /> : <ArrowClockwise20Regular />}
                    onClick={() => setOcrCaps(null)}
                  >
                    重新检测
                  </Button>
                </div>
              </div>
              <Badge appearance="tint">{ocrCaps?.tesseractAvailable ? "仅本地处理" : "未安装"}</Badge>
            </div>
          )}
          {ocrEngine === "aiStudio" && (
            <div className={mergeClasses(styles.card, styles.settingRowStack)}>
              <span className={styles.rowIcon}><Link20Regular /></span>
              <div className={styles.settingText}>
                <LabelInfo
                  label="AI Studio 接口"
                  detail="在 AI Studio 生成 Access Token 粘贴到下面即可；接口地址走官方异步识别端点（paddleocr.aistudio-app.com），留空即可，一般无需修改。识别请求会把图片上传到百度服务器；按张消耗每日免费额度，以 AI Studio 页面说明为准。"
                />
                <div className={styles.ocrFields}>
                  <Input
                    className={styles.ocrInput}
                    placeholder="API 地址（留空使用官方默认端点）"
                    value={aiStudioOcrApiUrl}
                    onChange={(_, data) => setAiStudioOcrApiUrl(data.value)}
                    aria-label="AI Studio API 地址"
                  />
                  <Dropdown
                    className={styles.ocrInput}
                    aria-label="AI Studio 识别模型"
                    value={aiStudioModelLabels[aiStudioOcrModel] ?? aiStudioOcrModel}
                    selectedOptions={[aiStudioOcrModel]}
                    onOptionSelect={(_, data) =>
                      setAiStudioOcrModel(data.optionValue ?? aiStudioOcrModel)}
                  >
                    <Option value="PP-OCRv6">PP-OCRv6（纯文字识别，推荐）</Option>
                    <Option value="PP-OCRv5">PP-OCRv5（纯文字识别）</Option>
                  </Dropdown>
                  <Input
                    className={styles.ocrInput}
                    type="password"
                    placeholder="Access Token"
                    value={aiStudioOcrToken}
                    onChange={(_, data) => setAiStudioOcrToken(data.value)}
                    aria-label="AI Studio Access Token"
                  />
                </div>
                <div className={styles.pathRow}>
                  <Button
                    icon={<Link20Regular />}
                    onClick={() => {
                      openExternalUrl(AI_STUDIO_CONSOLE_URL).catch((error) =>
                        onNotifyError(`打开 AI Studio 失败：${getErrorMessage(error)}`),
                      );
                    }}
                  >
                    打开 AI Studio 控制台
                  </Button>
                </div>
              </div>
            </div>
          )}
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}><ArrowClockwise20Regular /></span>
            <div className={styles.settingText}>
              <LabelInfo
                label="存量回填"
                detail="为导入时还未识别过的存量表情补跑 OCR 并追加标签（识别过但无文字的条目自动跳过）。使用云端引擎会按张消耗免费额度；识别在后台进行，完成后标签自动出现在对应表情上。"
              />
              {backfillRunning && ocrBackfill && (
                <div className={styles.settingDescription}>
                  正在识别 {ocrBackfill.processed}/{ocrBackfill.total} 张…
                </div>
              )}
              {!backfillRunning && ocrBackfill?.finished && (
                <div className={styles.settingDescription}>
                  上次完成：已处理 {ocrBackfill.processed}/{ocrBackfill.total} 张。
                </div>
              )}
            </div>
            <Button
              icon={backfillStarting ? <Spinner size="tiny" /> : <ArrowClockwise20Regular />}
              disabled={ocrEngine === "off" || backfillStarting || backfillRunning}
              onClick={() => void handleBackfillOcr()}
            >
              为现有表情补跑识别
            </Button>
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
        <PageHeader
          title="关于"
          subtitle="本地优先的表情素材管理工具，无需账号或网络服务。"
        />
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>项目</h3>
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}><Link20Regular /></span>
            <div className={styles.settingText}>
              <div className={styles.settingLabel}>仓库</div>
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
            <span className={styles.rowIcon}><Document20Regular /></span>
            <div className={styles.settingText}>
              <div className={styles.settingLabel}>开源协议</div>
            </div>
            <button
              type="button"
              className={styles.dependencyChip}
              onClick={() => void handleOpenDependency(`${REPO_URL}/blob/main/LICENSE`, "GPL-3.0 协议")}
            >
              <ShieldCheckmark20Regular />
              <span>GPL-3.0</span>
            </button>
          </div>
        </div>
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>更新</h3>
          {/* Phase 30：UpdateCard 卡片已删除。「检查更新」在这里做检查：
              发现新版本 → onUpdateAvailable 交给 App 层弹更新弹窗；
              已是最新 / 没有发布 / 出错 → toast 反馈（弹窗只在有新版本时出现）。 */}
          <div className={mergeClasses(styles.card, styles.settingRow)}>
            <span className={styles.rowIcon}><Alert20Regular /></span>
            <div className={styles.settingText}>
              <LabelInfo
                label="自动检查更新"
                detail="每次启动 EmoBox 时静默检查 GitHub Releases 上的新版本，发现新版本会弹窗提示；可随时点「检查更新」手动检查。检查与下载走「镜像源」加速。"
              />
            </div>
            <div className={styles.updateSwitchActions}>
              <Switch
                checked={autoCheckUpdates}
                onChange={(_, data) => setAutoCheckUpdates(data.checked)}
                aria-label="自动检查更新"
              />
              <Button
                disabled={checkingUpdate}
                icon={checkingUpdate ? <Spinner size="extra-tiny" /> : undefined}
                onClick={() => void handleCheckUpdate()}
              >
                检查更新
              </Button>
            </div>
          </div>
          <MirrorSourceCard />
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
    // Toaster 必须是 Dialog 的兄弟节点：Fluent Dialog 遇到两个 children 会把
    // 第一个（DialogSurface）当 trigger 无条件渲染、只卸载第二个——设置界面
    // 将从此常驻无法关闭。
    <>
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
      <Toaster toasterId={toasterId} position="top-end" />
    </>
  );
}
