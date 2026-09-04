import { createContext, useContext } from "react";
import type { ResolvedTheme, ThemePreference } from "./useSiteTheme";

export interface SiteThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  /** 系统当前是否深色（「跟随系统」的解析依据，局部主题消费者也要用）。 */
  systemDark: boolean;
  setPreference: (next: ThemePreference) => void;
}

export const SiteThemeContext = createContext<SiteThemeContextValue | null>(null);

export function useSiteThemeContext(): SiteThemeContextValue {
  const ctx = useContext(SiteThemeContext);
  if (!ctx) throw new Error("SiteThemeContext is missing in the component tree");
  return ctx;
}
