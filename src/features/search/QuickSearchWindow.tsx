import {
  Toast,
  ToastBody,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from "@fluentui/react-components";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSettings } from "../../components/ThemeProvider";
import { DEFAULT_QUICK_SEARCH_SHORTCUT } from "../../config/shortcuts";
import {
  copyImageToClipboard,
  getErrorMessage,
  getQuickSearchShortcutStatus,
  hideQuickSearch,
  pasteToTargetWindow,
} from "../../lib/tauri";
import type { IndexedImage, PasteResult } from "../../types";
import { QuickSearchPanel } from "./QuickSearchPanel";
import { useQuickSearchQuery } from "./useQuickSearchQuery";

const QUICK_SEARCH_OPENED_EVENT = "quick-search-opened";
const LIBRARY_CHANGED_EVENT = "library-changed";
const SUCCESS_VISIBILITY_MS = 500;

export function QuickSearchWindow() {
  const toasterId = useId("quick-search-toaster");
  const { dispatchToast } = useToastController(toasterId);
  const { autoPaste } = useAppSettings();
  const [copyError, setCopyError] = useState("");
  const [copyingPath, setCopyingPath] = useState<string>();
  const [activationId, setActivationId] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [shortcut, setShortcut] = useState(DEFAULT_QUICK_SEARCH_SHORTCUT);
  const closeTimer = useRef<number | undefined>(undefined);

  const { query, setQuery, resetQuery, items, loading, error } = useQuickSearchQuery(
    activationId,
    reloadToken,
  );

  const activate = useCallback(() => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    resetQuery();
    setCopyError("");
    setCopyingPath(undefined);
    setActivationId((current) => current + 1);

    getQuickSearchShortcutStatus()
      .then((status) => {
        if (status?.shortcut) setShortcut(status.shortcut);
      })
      .catch(() => {});
  }, [resetQuery]);

  const close = useCallback(() => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    setCopyingPath(undefined);
    hideQuickSearch().catch((hideError) => {
      console.error("隐藏快捷搜索窗口失败", hideError);
    });
  }, []);

  const copySelectedImage = useCallback(async (item: IndexedImage) => {
    if (copyingPath) return;

    setCopyError("");
    setCopyingPath(item.path);

    // 严格顺序：复制 → 隐藏浮层 → 触发自动粘贴（可选）。
    // 每一步都必须在 finally 里恢复 copyingPath，否则后续选择会被锁死。
    let copyOutcome: Awaited<ReturnType<typeof copyImageToClipboard>> | null = null;
    try {
      // 1) 复制到剪贴板（必走）。
      copyOutcome = await copyImageToClipboard(item.path);
    } catch (copyFailure) {
      const message = getErrorMessage(copyFailure);
      setCopyError(message);
      setCopyingPath(undefined);
      dispatchToast(
        <Toast>
          <ToastTitle>复制失败</ToastTitle>
          <ToastBody>{message}</ToastBody>
        </Toast>,
        { intent: "error" },
      );
      return;
    }

    // 2) 浮层永远要自动关闭（500ms 后）。无论后续步骤成败。
    closeTimer.current = window.setTimeout(close, SUCCESS_VISIBILITY_MS);

    // 主 toast：复制成功。保持原行为。
    dispatchToast(
      <Toast>
        <ToastTitle>已复制 {item.name}</ToastTitle>
        <ToastBody>{copyOutcome.message}</ToastBody>
      </Toast>,
      { intent: "success", timeout: SUCCESS_VISIBILITY_MS },
    );

    // 3) 自动粘贴（可选）。失败路径必须显式降级。
    if (autoPaste) {
      // 3a) 必须先隐藏浮层。浮层 alwaysOnTop，会阻塞 SetForegroundWindow。
      let hidden = true;
      try {
        await hideQuickSearch();
      } catch (hideError) {
        // 隐藏失败：不要继续尝试 paste（可能切前台失败），直接降级。
        hidden = false;
        console.error("隐藏快捷搜索窗口失败", hideError);
      }
      if (!hidden) {
        dispatchToast(
          <Toast>
            <ToastTitle>自动粘贴未执行</ToastTitle>
            <ToastBody>表情已复制，请手动粘贴</ToastBody>
          </Toast>,
          { intent: "info", timeout: SUCCESS_VISIBILITY_MS },
        );
        return;
      }

      // 给 Windows 一个 tick 完成窗口隐藏和焦点状态转移。
      // 50ms 是经验值：太短会导致 SetForegroundWindow 还在等系统消息。
      await new Promise((resolve) => window.setTimeout(resolve, 50));

      // 3b) 调 Rust 端 paste。Rust 不会返回 Err，但 IPC 可能抛错。
      let pasteResult: PasteResult | null = null;
      try {
        pasteResult = await pasteToTargetWindow();
      } catch (ipcError) {
        console.error("auto-paste IPC failed", ipcError);
      }
      if (!pasteResult) {
        dispatchToast(
          <Toast>
            <ToastTitle>自动粘贴未执行</ToastTitle>
            <ToastBody>自动粘贴调用失败，表情已复制到剪贴板</ToastBody>
          </Toast>,
          { intent: "info", timeout: SUCCESS_VISIBILITY_MS },
        );
        return;
      }
      if (pasteResult.kind === "disabled") {
        // Rust 端在非 Windows 平台返回；前端永远不应该看到 disabled，
        // 但即便出现也不显示额外 toast。
        return;
      }
      const intent = pasteResult.kind === "success" ? "success" : "info";
      dispatchToast(
        <Toast>
          <ToastTitle>
            {pasteResult.kind === "success" ? "已粘贴" : "自动粘贴未执行"}
          </ToastTitle>
          <ToastBody>{pasteResult.message}</ToastBody>
        </Toast>,
        { intent, timeout: SUCCESS_VISIBILITY_MS },
      );
    }
  }, [autoPaste, close, copyingPath, dispatchToast]);

  useEffect(() => {
    let disposed = false;
    let unlisteners: UnlistenFn[] = [];

    listen(QUICK_SEARCH_OPENED_EVENT, () => {
      void activate();
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisteners.push(stopListening);
    }).catch(() => {});

    // 库数据变更（主窗口导入/删除/收藏/分组/标签）→ 重载当前搜索，不重置输入。
    listen(LIBRARY_CHANGED_EVENT, () => {
      setReloadToken((current) => current + 1);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisteners.push(stopListening);
    }).catch(() => {});

    void activate();

    return () => {
      disposed = true;
      if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
      unlisteners.forEach((stopListening) => stopListening());
    };
  }, [activate]);

  return (
    <>
      <QuickSearchPanel
        results={items}
        query={query}
        onQueryChange={setQuery}
        loading={loading}
        error={error || undefined}
        copyError={copyError || undefined}
        copyingPath={copyingPath}
        activationId={activationId}
        shortcut={shortcut}
        onClose={close}
        onSelect={(item) => void copySelectedImage(item)}
      />
      <Toaster toasterId={toasterId} position="top-end" />
    </>
  );
}
