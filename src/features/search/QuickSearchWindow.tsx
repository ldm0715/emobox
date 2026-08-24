import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_QUICK_SEARCH_SHORTCUT } from "../../config/shortcuts";
import {
  getErrorMessage,
  getIndexedImages,
  getQuickSearchShortcutStatus,
  hideQuickSearch,
} from "../../lib/tauri";
import type { IndexedImage } from "../../types";
import { QuickSearchPanel } from "./QuickSearchPanel";

const QUICK_SEARCH_OPENED_EVENT = "quick-search-opened";

export function QuickSearchWindow() {
  const [items, setItems] = useState<IndexedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activationId, setActivationId] = useState(0);
  const [shortcut, setShortcut] = useState(DEFAULT_QUICK_SEARCH_SHORTCUT);

  const activate = useCallback(async () => {
    setActivationId((current) => current + 1);
    setLoading(true);
    setError("");

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
    hideQuickSearch().catch((hideError) => {
      console.error("隐藏快捷搜索窗口失败", hideError);
    });
  }, []);

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
      unlisten?.();
    };
  }, [activate]);

  return (
    <QuickSearchPanel
      items={items}
      loading={loading}
      error={error || undefined}
      activationId={activationId}
      shortcut={shortcut}
      onClose={close}
      onSelect={() => {
        // 第二阶段只确认选中状态，不执行剪贴板复制或自动粘贴。
      }}
    />
  );
}
