import {
  Toast,
  ToastBody,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from "@fluentui/react-components";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSettings } from "../../components/ThemeProvider";
import { DEFAULT_QUICK_SEARCH_SHORTCUT } from "../../config/shortcuts";
import {
  copyImageToClipboard,
  getErrorMessage,
  getQuickSearchShortcutStatus,
  hideQuickSearch,
  listGroups,
  pasteToTargetWindow,
} from "../../lib/tauri";
import type {
  IndexedImage,
  LibraryGroup,
  PasteResult,
  QuickSearchOpenedPayload,
} from "../../types";
import { QuickSearchPanel } from "./QuickSearchPanel";
import { useQuickSearchQuery } from "./useQuickSearchQuery";
import { overlayDragGuard } from "./overlayDragGuard";

const QUICK_SEARCH_OPENED_EVENT = "quick-search-opened";
const LIBRARY_CHANGED_EVENT = "library-changed";
const SUCCESS_VISIBILITY_MS = 500;
/** 激活后的窗口期内忽略失焦事件：show/center/set_focus 序列可能产生瞬时 blur。 */
const ACTIVATION_FOCUS_GUARD_MS = 300;

export function QuickSearchWindow() {
  const toasterId = useId("quick-search-toaster");
  const { dispatchToast } = useToastController(toasterId);
  const { autoPaste } = useAppSettings();
  const [copyError, setCopyError] = useState("");
  const [copyingPath, setCopyingPath] = useState<string>();
  const [activationId, setActivationId] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [shortcut, setShortcut] = useState(DEFAULT_QUICK_SEARCH_SHORTCUT);
  const [pinnedGroups, setPinnedGroups] = useState<LibraryGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const activatedAtRef = useRef(0);

  const {
    query,
    setQuery,
    resetQuery,
    items,
    total,
    loading,
    loadingMore,
    error,
    loadMore,
    hasMore,
  } = useQuickSearchQuery(activationId, reloadToken, selectedGroupId);

  // seed：打开浮层时前台窗口选中的文字（Phase 15）。非空则作为初始搜索词，
  // 空/未读到则清空 query —— requestSeq 守卫保证旧请求不会污染新会话。
  // 分组选择同时重置回「全部」（每次唤起都从最近使用开始）。
  const activate = useCallback(
    (seed?: string) => {
      if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
      if (seed !== undefined && seed.length > 0) {
        setQuery(seed);
      } else {
        resetQuery();
      }
      setSelectedGroupId(null);
      activatedAtRef.current = Date.now();
      setCopyError("");
      setCopyingPath(undefined);
      setActivationId((current) => current + 1);

      getQuickSearchShortcutStatus()
        .then((status) => {
          if (status?.shortcut) setShortcut(status.shortcut);
        })
        .catch(() => {});
    },
    [resetQuery, setQuery],
  );

  const close = useCallback(() => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    setCopyingPath(undefined);
    // 只隐藏窗口，绝不清 TargetWindowState（hide→paste 自动粘贴链依赖它，
    // 由 Rust 侧 60s TTL 与下次打开时的先清后写负责过期）。
    hideQuickSearch().catch((hideError) => {
      console.error("隐藏快捷搜索窗口失败", hideError);
    });
  }, []);

  // latest-ref 转发：失焦监听的 effect deps 保持 []，close 永远读最新闭包
  // （与 keyShortcutRef 同模式，避免捕获旧 state）。
  const closeRef = useRef(close);
  closeRef.current = close;

  // 点浮层外部（焦点转到其他窗口）→ 立即关闭。浮层内部任何点击（分组/搜索框/
  // 加载更多/卡片）都不会让窗口失焦，天然不误触发。复制流里 hideQuickSearch
  // 触发的 blur 会再调一次 close——幂等（重复 hide 无害）。
  // 整窗拖拽（overlayDragGuard）的 move loop 会让窗口短暂失焦，属正常现象，
  // 不关闭；拖拽结束重新获焦时清标志。
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const unlistenPromise = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) {
        overlayDragGuard.active = false;
        return;
      }
      if (overlayDragGuard.active) return;
      if (Date.now() - activatedAtRef.current > ACTIVATION_FOCUS_GUARD_MS) {
        closeRef.current();
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

  // 点分组按钮 = 切回浏览态：清空关键词（搜索挂起分组筛选，见 useQuickSearchQuery）。
  const handleSelectGroup = useCallback(
    (groupId: number | null) => {
      setSelectedGroupId(groupId);
      setQuery("");
    },
    [setQuery],
  );

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

    listen<QuickSearchOpenedPayload>(QUICK_SEARCH_OPENED_EVENT, (event) => {
      void activate(event.payload?.selectedText ?? undefined);
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

  // 置顶分组：挂载、每次唤起（置顶是纯侧栏变更，不发 library-changed，靠唤起时
  // 重拉兜住）与库变更时刷新。
  useEffect(() => {
    let disposed = false;
    listGroups()
      .then((groups) => {
        if (!disposed) setPinnedGroups(groups.filter((group) => group.isPinned));
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [activationId, reloadToken]);

  return (
    <>
      <QuickSearchPanel
        results={items}
        total={total}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={() => void loadMore()}
        query={query}
        onQueryChange={setQuery}
        pinnedGroups={pinnedGroups}
        selectedGroupId={selectedGroupId}
        onSelectGroup={handleSelectGroup}
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
