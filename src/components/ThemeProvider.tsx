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
import { DEFAULT_QUICK_SEARCH_SHORTCUT } from "../config/shortcuts";
import type { DefaultLibraryView } from "../types";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface PersistedSettings {
  theme: ThemePreference;
  sidebarCollapsed: boolean;
  defaultView: DefaultLibraryView;
  quickSearchShortcut: string;
}

interface SettingsContextValue extends PersistedSettings {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setDefaultView: (view: DefaultLibraryView) => void;
  setQuickSearchShortcut: (shortcut: string) => void;
}

const STORAGE_KEY = "emobox.settings";
const LEGACY_THEME_KEY = "emobox.theme";
const fontFamily = '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';

const defaultSettings: PersistedSettings = {
  theme: "light",
  sidebarCollapsed: false,
  defaultView: "all",
  quickSearchShortcut: DEFAULT_QUICK_SEARCH_SHORTCUT,
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
      defaultView: isDefaultView(parsed.defaultView) ? parsed.defaultView : defaultSettings.defaultView,
      quickSearchShortcut: isShortcut(parsed.quickSearchShortcut)
        ? parsed.quickSearchShortcut
        : defaultSettings.quickSearchShortcut,
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

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...settings,
      resolvedTheme,
      setTheme: (theme) => setSettings((current) => ({ ...current, theme })),
      setSidebarCollapsed: (sidebarCollapsed) => setSettings((current) => ({ ...current, sidebarCollapsed })),
      setDefaultView: (defaultView) => setSettings((current) => ({ ...current, defaultView })),
      setQuickSearchShortcut: (quickSearchShortcut) => setSettings((current) => ({
        ...current,
        quickSearchShortcut,
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
