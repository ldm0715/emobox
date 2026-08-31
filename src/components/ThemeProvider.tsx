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
import { setSelectionSearchEnabled } from "../lib/tauri";
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
};

const darkTheme: Theme = {
  ...createDarkTheme(brand),
  fontFamilyBase: fontFamily,
  fontFamilyMonospace: '"Cascadia Mono", Consolas, monospace',
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
  useEffect(() => {
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  // Phase 15：把「选中文字自动搜索」推送到 Rust（内存镜像，幂等；两个窗口
  // 都会执行，后到者覆盖为相同值）。失败仅 log —— Rust 侧默认与这里一致。
  useEffect(() => {
    setSelectionSearchEnabled(settings.selectionSearch).catch((error) => {
      console.error("推送选中文字搜索开关失败", error);
    });
  }, [settings.selectionSearch]);

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
