import {
  FluentProvider,
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme,
} from "@fluentui/react-components";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_CLIPBOARD_COLLECT_SHORTCUT,
  DEFAULT_QUICK_SEARCH_SHORTCUT,
} from "../config/shortcuts";
import { setCloseToTray, setSelectionSearchEnabled } from "../lib/tauri";
import { DEFAULT_UPDATE_MIRRORS, isMirrorList } from "../lib/mirrorSources";
import type { DefaultLibraryView } from "../types";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface PersistedSettings {
  theme: ThemePreference;
  sidebarCollapsed: boolean;
  /** 「我的分组」区折叠状态（侧栏展开态专用）。 */
  sidebarGroupsCollapsed: boolean;
  defaultView: DefaultLibraryView;
  quickSearchShortcut: string;
  clipboardCollectShortcut: string;
  // Phase 7: auto-paste after copy from the quick-search overlay.
  // Windows is the target platform — the Rust command always returns
  // `disabled` on other platforms, so the toggle is a no-op there.
  autoPaste: boolean;
  // Phase 15: use the text selected in the foreground app as the overlay's
  // seed query. localStorage is the source of truth; the value is pushed to
  // the Rust side (SelectionSearchState) so the capture happens before the
  // overlay window even exists in the frontend.
  selectionSearch: boolean;
  // Phase 16: download the original GIF from the web URL found on the
  // clipboard (Chrome/Edge copies carry first-frame bitmap + URL only).
  // Off = static first-frame import with a hint toast. localStorage is the
  // source of truth; the value is passed per-collect-call to the Rust command.
  downloadWebGif: boolean;
  // Phase 25: main-window close behavior. 三态：undefined（键不存在）= 未选择，
  // 点关闭按钮时前端弹询问窗；true = 已记住「最小化到系统托盘」；false = 已记住
  // 「直接退出」。询问弹窗勾「记住」与设置开关拨动都写这一项（弹窗结果与设置项
  // 是同一个状态）。localStorage 事实源，挂载/变更时推送到 Rust 内存镜像。
  closeToTray?: boolean;
  // Phase 27: 自动检查更新（每次启动主窗口静默查一次 GitHub Releases）。
  autoCheckUpdates: boolean;
  // Phase 27: GitHub 加速镜像源列表（前缀代理，顺序 = 尝试顺序；官方直连
  // 由 Rust 侧恒定兜底，不在此列）。
  updateMirrors: string[];
}

interface SettingsContextValue extends PersistedSettings {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarGroupsCollapsed: (collapsed: boolean) => void;
  setDefaultView: (view: DefaultLibraryView) => void;
  setQuickSearchShortcut: (shortcut: string) => void;
  setClipboardCollectShortcut: (shortcut: string) => void;
  setAutoPaste: (enabled: boolean) => void;
  setSelectionSearch: (enabled: boolean) => void;
  setDownloadWebGif: (enabled: boolean) => void;
  /** 拨动设置开关或弹窗勾「记住」时写入；写入即视为已决定、不再弹询问窗。 */
  setCloseToTray: (minimizeToTray: boolean) => void;
  setAutoCheckUpdates: (enabled: boolean) => void;
  setUpdateMirrors: (mirrors: string[]) => void;
}

const STORAGE_KEY = "emobox.settings";
const LEGACY_THEME_KEY = "emobox.theme";
const fontFamily = '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';

const defaultSettings: PersistedSettings = {
  theme: "light",
  sidebarCollapsed: false,
  sidebarGroupsCollapsed: false,
  defaultView: "all",
  quickSearchShortcut: DEFAULT_QUICK_SEARCH_SHORTCUT,
  clipboardCollectShortcut: DEFAULT_CLIPBOARD_COLLECT_SHORTCUT,
  autoPaste: true,
  selectionSearch: true,
  downloadWebGif: false,
  autoCheckUpdates: true,
  updateMirrors: DEFAULT_UPDATE_MIRRORS,
};

const brand: BrandVariants = {
  10: "#061724",
  20: "#082338",
  30: "#0a2e4a",
  40: "#0a3b5c",
  50: "#0e4775",
  60: "#0f548c",
  70: "#115ea3",
  80: "#0f6cbd",
  90: "#2886de",
  100: "#479ef5",
  110: "#62abf5",
  120: "#77b7f7",
  130: "#96c6fa",
  140: "#b4d6fa",
  150: "#cfe4fa",
  160: "#ebf3fc",
};

const lightTheme: Theme = {
  ...createLightTheme(brand),
  fontFamilyBase: fontFamily,
  fontFamilyMonospace: '"Cascadia Mono", Consolas, monospace',
  // 亮色微调（Surface 层级）：分割线降对比（去"表格感"，兼作卡片 1px 浅边框色），
  // 选中导航改极浅品牌蓝 tint（更柔和，左侧品牌指示条保留）。卡片底 BG3 保留默认
  // ——层级不清的根因是无边框，由 cardStyles 的 1px 边框解决，避免灰底加重。
  colorNeutralStroke2: "#e8e8e8",
  colorSubtleBackgroundSelected: "#e8f1fa",
};

// 暗色 Surface 层级（深灰蓝基底，hue≈220 低饱和）：窗口底(BG2)最暗 → 主内容区(BG1)
// → 表情卡(BG3)最亮。Fluent 默认暗色 BG3=#141414 比 BG1 还暗（卡片比背景黑，层级
// 方向反了），这里整组翻转重排；hover 每级 +3~4 亮度，选中态用低饱和深蓝 + 品牌指示。
const darkTheme: Theme = {
  ...createDarkTheme(brand),
  fontFamilyBase: fontFamily,
  fontFamilyMonospace: '"Cascadia Mono", Consolas, monospace',
  // 背景层：窗口/侧栏底 → 内容区 → 卡片（最亮中性层）。
  colorNeutralBackground2: "#191d26",
  colorNeutralBackground2Hover: "#20242f",
  colorNeutralBackground1: "#222732",
  colorNeutralBackground1Hover: "#2c3240",
  colorNeutralBackground3: "#2a303d",
  colorNeutralBackground3Hover: "#333a49",
  colorNeutralBackground3Pressed: "#242a36",
  // 悬停/选中：蓝灰 hover；选中 = 低饱和深蓝底（不铺大亮蓝，指示条与图标仍走品牌色）。
  colorSubtleBackgroundHover: "#282f3b",
  colorSubtleBackgroundSelected: "#24384f",
  colorSubtleBackgroundPressed: "#1d2532",
  // 文字：次要文字提亮并染同色相蓝灰，修"发灰难读"；1/2/4 保留默认。
  colorNeutralForeground3: "#b3bac6",
  // 边框/分割线：低对比蓝灰，消灭"亮灰线"。
  colorNeutralStroke1: "#454c5a",
  colorNeutralStroke1Hover: "#545c6c",
  colorNeutralStroke2: "#333947",
  colorNeutralStroke3: "#333a48",
  colorNeutralStrokeAccessible: "#6d7689",
  // 选中卡 / 拖放提示 / tint 徽章统一低饱和深蓝底（默认 #082338 在新基底上偏暗）。
  colorBrandBackground2: "#1d3a5a",
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function isTheme(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function isDefaultView(value: unknown): value is DefaultLibraryView {
  return value === "all" || value === "recent" || value === "favorites";
}

function isShortcut(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readSettings(): PersistedSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<PersistedSettings>;
    const legacyTheme = window.localStorage.getItem(LEGACY_THEME_KEY);
    return {
      theme: isTheme(parsed.theme) ? parsed.theme : isTheme(legacyTheme) ? legacyTheme : defaultSettings.theme,
      sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : false,
      sidebarGroupsCollapsed:
        typeof parsed.sidebarGroupsCollapsed === "boolean" ? parsed.sidebarGroupsCollapsed : false,
      defaultView: isDefaultView(parsed.defaultView) ? parsed.defaultView : defaultSettings.defaultView,
      quickSearchShortcut: isShortcut(parsed.quickSearchShortcut)
        ? parsed.quickSearchShortcut
        : defaultSettings.quickSearchShortcut,
      clipboardCollectShortcut: isShortcut(parsed.clipboardCollectShortcut)
        ? parsed.clipboardCollectShortcut
        : defaultSettings.clipboardCollectShortcut,
      autoPaste: typeof parsed.autoPaste === "boolean" ? parsed.autoPaste : defaultSettings.autoPaste,
      selectionSearch:
        typeof parsed.selectionSearch === "boolean" ? parsed.selectionSearch : defaultSettings.selectionSearch,
      downloadWebGif:
        typeof parsed.downloadWebGif === "boolean" ? parsed.downloadWebGif : defaultSettings.downloadWebGif,
      // 可选三态：键缺失保持 undefined（未选择），不能落成 false（那是「已记住直接退出」）。
      closeToTray: typeof parsed.closeToTray === "boolean" ? parsed.closeToTray : undefined,
      autoCheckUpdates:
        typeof parsed.autoCheckUpdates === "boolean"
          ? parsed.autoCheckUpdates
          : defaultSettings.autoCheckUpdates,
      updateMirrors: isMirrorList(parsed.updateMirrors)
        ? parsed.updateMirrors
        : defaultSettings.updateMirrors,
    };
  } catch {
    return defaultSettings;
  }
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<PersistedSettings>(readSettings);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setSettings(readSettings());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const resolvedTheme = settings.theme === "system" ? systemTheme : settings.theme;

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    const nativeTheme = settings.theme === "system" ? null : settings.theme;
    getCurrentWindow().setTheme(nativeTheme).catch(() => {
      // Browser preview mode does not expose a Tauri window.
    });
  }, [settings]);

  // 原生滚动条（WebView2）跟随主题：FluentProvider 只切换组件 CSS 变量，
  // 不设置 color-scheme —— 不加这段，滚动条永远按浅色渲染（含深色主题）。
  // 同时同步 <meta name="theme-color">（窗口底色，与 darkTheme BG2 / lightTheme BG2 对齐）。
  useEffect(() => {
    document.documentElement.style.colorScheme = resolvedTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolvedTheme === "dark" ? "#191d26" : "#fafafa");
  }, [resolvedTheme]);

  // Phase 15：把「选中文字自动搜索」推送到 Rust（内存镜像，幂等；两个窗口
  // 都会执行，后到者覆盖为相同值）。失败仅 log —— Rust 侧默认与这里一致。
  useEffect(() => {
    setSelectionSearchEnabled(settings.selectionSearch).catch((error) => {
      console.error("推送选中文字搜索开关失败", error);
    });
  }, [settings.selectionSearch]);

  // Phase 25：把主窗口关闭行为推送到 Rust（CloseBehaviorState 内存镜像，
  // on_window_event 据此即时决定 hide / exit / 弹询问窗）。undefined 推 null
  // = 未选择。幂等；两个窗口都会执行。失败仅 log —— Rust 侧默认 None。
  useEffect(() => {
    setCloseToTray(settings.closeToTray ?? null).catch((error) => {
      console.error("推送关闭行为设置失败", error);
    });
  }, [settings.closeToTray]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...settings,
      resolvedTheme,
      setTheme: (theme) => setSettings((current) => ({ ...current, theme })),
      setSidebarCollapsed: (sidebarCollapsed) => setSettings((current) => ({ ...current, sidebarCollapsed })),
      setSidebarGroupsCollapsed: (sidebarGroupsCollapsed) =>
        setSettings((current) => ({ ...current, sidebarGroupsCollapsed })),
      setDefaultView: (defaultView) => setSettings((current) => ({ ...current, defaultView })),
      setQuickSearchShortcut: (quickSearchShortcut) => setSettings((current) => ({
        ...current,
        quickSearchShortcut,
      })),
      setClipboardCollectShortcut: (clipboardCollectShortcut) => setSettings((current) => ({
        ...current,
        clipboardCollectShortcut,
      })),
      setAutoPaste: (autoPaste) => setSettings((current) => ({
        ...current,
        autoPaste,
      })),
      setSelectionSearch: (selectionSearch) => setSettings((current) => ({
        ...current,
        selectionSearch,
      })),
      setDownloadWebGif: (downloadWebGif) => setSettings((current) => ({
        ...current,
        downloadWebGif,
      })),
      setCloseToTray: (closeToTray) => setSettings((current) => ({
        ...current,
        closeToTray,
      })),
      setAutoCheckUpdates: (autoCheckUpdates) => setSettings((current) => ({
        ...current,
        autoCheckUpdates,
      })),
      setUpdateMirrors: (updateMirrors) => setSettings((current) => ({
        ...current,
        updateMirrors,
      })),
    }),
    [resolvedTheme, settings],
  );

  return (
    <SettingsContext.Provider value={value}>
      <FluentProvider theme={resolvedTheme === "dark" ? darkTheme : lightTheme} style={{ height: "100%" }}>
        {children}
      </FluentProvider>
    </SettingsContext.Provider>
  );
}

export function useAppSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useAppSettings must be used within ThemeProvider");
  return context;
}

export const useAppTheme = useAppSettings;
