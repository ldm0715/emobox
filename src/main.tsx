import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./components/ThemeProvider";
import { QuickSearchWindow } from "./features/search/QuickSearchWindow";
import "./styles/global.css";

const windowLabel = getCurrentWindow().label;
const content = windowLabel === "quick-search" ? <QuickSearchWindow /> : <App />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>{content}</ThemeProvider>
  </StrictMode>,
);
