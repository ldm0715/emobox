import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./components/ThemeProvider";
import { QuickSearchWindow } from "./features/search/QuickSearchWindow";
import { TrayMenuWindow } from "./features/tray-menu/TrayMenuWindow";
import "./styles/global.css";

const windowLabel = getCurrentWindow().label;
// 透明窗口（圆角浮层）需要 html/body 背景透明，见 global.css。
if (windowLabel === "quick-search") {
  document.documentElement.classList.add("quick-search-window");
}
if (windowLabel === "tray-menu") {
  document.documentElement.classList.add("tray-menu-window");
}
const content =
  windowLabel === "quick-search" ? (
    <QuickSearchWindow />
  ) : windowLabel === "tray-menu" ? (
    <TrayMenuWindow />
  ) : (
    <App />
  );

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>{content}</ThemeProvider>
  </StrictMode>,
);
