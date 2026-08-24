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
import { DEFAULT_QUICK_SEARCH_SHORTCUT } from "../../config/shortcuts";
import {
  copyImageToClipboard,
  getErrorMessage,
  getIndexedImages,
  getQuickSearchShortcutStatus,
  hideQuickSearch,
} from "../../lib/tauri";
import type { IndexedImage } from "../../types";
import { QuickSearchPanel } from "./QuickSearchPanel";

const QUICK_SEARCH_OPENED_EVENT = "quick-search-opened";
const SUCCESS_VISIBILITY_MS = 500;

export function QuickSearchWindow() {
  const toasterId = useId("quick-search-toaster");
  const { dispatchToast } = useToastController(toasterId);
  const [items, setItems] = useState<IndexedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyError, setCopyError] = useState("");
  const [copyingPath, setCopyingPath] = useState<string>();
  const [activationId, setActivationId] = useState(0);
  const [shortcut, setShortcut] = useState(DEFAULT_QUICK_SEARCH_SHORTCUT);
  const closeTimer = useRef<number | undefined>(undefined);

  const activate = useCallback(async () => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    setActivationId((current) => current + 1);
    setLoading(true);
    setError("");
    setCopyError("");
    setCopyingPath(undefined);

    try {
      setItems(await getIndexedImages());
      const status = await getQuickSearchShortcutStatus().catch(() => null);
      if (status?.shortcut) setShortcut(status.shortcut);
    } catch (loadError) {
      setItems([]);
      setError(`无法读取表情索引：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, []);

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

    try {
      const outcome = await copyImageToClipboard(item.path);
      dispatchToast(
        <Toast>
          <ToastTitle>已复制 {item.name}</ToastTitle>
          <ToastBody>{outcome.message}</ToastBody>
        </Toast>,
        { intent: "success", timeout: SUCCESS_VISIBILITY_MS },
      );
      closeTimer.current = window.setTimeout(close, SUCCESS_VISIBILITY_MS);
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
    }
  }, [close, copyingPath, dispatchToast]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    listen(QUICK_SEARCH_OPENED_EVENT, () => {
      void activate();
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((listenError) => {
      setError(`无法监听快捷搜索激活事件：${getErrorMessage(listenError)}`);
      setLoading(false);
    });

    void activate();

    return () => {
      disposed = true;
      if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
      unlisten?.();
    };
  }, [activate]);

  return (
    <>
      <QuickSearchPanel
        items={items}
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
