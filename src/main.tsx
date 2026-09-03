import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./components/ThemeProvider";
import { QuickSearchWindow } from "./features/search/QuickSearchWindow";
import { TrayMenuWindow } from "./features/tray-menu/TrayMenuWindow";
import { installDialogFocusGuard } from "./lib/dialogFocusGuard";
import { installPreventFocusScroll } from "./lib/preventFocusScroll";
import "./styles/global.css";

// ★ 承重：让程序化 focus() 默认不滚动视口。tabster 的模态焦点拉回会在整个应用里
// 挑一个可聚焦元素并 focus()（签名支持 preventScroll 却没传），主窗口内容因此被
// 拖走。必须在任何组件挂载前装上，见 lib/preventFocusScroll.ts 顶部注释。
installPreventFocusScroll();

// 焦点卫生（best-effort，非承重）：模态打开期间焦点不该滞留在 <body>。它只影响
// 焦点落点是否合理，不再影响滚动——滚动已由上面那条彻底根除。
installDialogFocusGuard();

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
