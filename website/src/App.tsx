import { FluentProvider } from "@fluentui/react-components";
import { DownloadSection } from "./components/DownloadSection";
import { Features } from "./components/Features";
import { Hero } from "./components/Hero";
import { PainPoints } from "./components/PainPoints";
import { Showcase } from "./components/Showcase";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import { Workflow } from "./components/Workflow";
import { darkTheme, lightTheme } from "./theme";
import { SiteThemeContext } from "./themeContext";
import { useSiteTheme } from "./useSiteTheme";

export function App() {
  const { preference, resolved, systemDark, setPreference } = useSiteTheme();

  return (
    <SiteThemeContext.Provider value={{ preference, resolved, systemDark, setPreference }}>
      <FluentProvider theme={resolved === "dark" ? darkTheme : lightTheme}>
        <SiteHeader />
        <main>
          <Hero />
          <PainPoints />
          <Showcase />
          <Features />
          <Workflow />
          <DownloadSection />
        </main>
        <SiteFooter />
      </FluentProvider>
    </SiteThemeContext.Provider>
  );
}
