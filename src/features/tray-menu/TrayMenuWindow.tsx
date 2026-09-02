import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { trayMenuAction } from "../../lib/tauri";
import type { TrayMenuAction } from "../../types";
import { TrayMenuPanel } from "./TrayMenuPanel";

const TRAY_MENU_OPENED_EVENT = "tray-menu-opened";
/** 激活后的窗口期内忽略失焦事件：show/set_focus 序列可能产生瞬时 blur。 */
const ACTIVATION_FOCUS_GUARD_MS = 300;

export function TrayMenuWindow() {
  const [activationId, setActivationId] = useState(0);
  const activatedAtRef = useRef(0);

  const hide = useCallback(() => {
    // 幂等：Rust 侧动作路径、失焦路径都会触发，重复 hide 无害。
    getCurrentWindow().hide().catch((hideError) => {
      console.error("隐藏托盘菜单窗口失败", hideError);
    });
  }, []);

  // latest-ref 转发：失焦监听的 effect deps 保持 []，hide 永远读最新闭包
  // （与 QuickSearchWindow.closeRef 同模式）。
  const hideRef = useRef(hide);
  hideRef.current = hide;

  // 点菜单外部（焦点转到其他窗口）→ 立即关闭。菜单内部任何点击都不会让
  // 窗口失焦，天然不误触发；点击菜单项先本地 hide 再走 IPC，这里的 blur
  // 会再调一次 hide —— 幂等。
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const unlistenPromise = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) return;
      if (Date.now() - activatedAtRef.current > ACTIVATION_FOCUS_GUARD_MS) {
        hideRef.current();
      }
    });
    unlistenPromise
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Rust 在定位并显示窗口后发 tray-menu-opened：记激活时间（失焦守卫用）
  // 并重挂面板（播放入场动画）。窗口常驻隐藏不销毁，监听只注册一次。
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen(TRAY_MENU_OPENED_EVENT, () => {
      activatedAtRef.current = Date.now();
      setActivationId((current) => current + 1);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Esc 关闭菜单。窗口隐藏时键盘事件不会到达，无需额外守卫。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 先本地藏窗口（点击即刻有反馈），再交给 Rust 执行；Rust 会再兜底藏一次
  // 并执行动作（先藏后动作的顺序约束见 tray.rs::handle_menu_action 注释）。
  const handleAction = useCallback((action: TrayMenuAction) => {
    hideRef.current();
    trayMenuAction(action).catch((actionError) => {
      console.error("托盘菜单动作执行失败", actionError);
    });
  }, []);

  // activationId 变化时重挂面板 → FadeSnappy appear 重播入场动画。
  return <TrayMenuPanel key={activationId} onAction={handleAction} />;
}
