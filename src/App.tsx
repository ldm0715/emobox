import {
  Toast,
  ToastBody,
  ToastTitle,
  Toaster,
  makeStyles,
  tokens,
  useId,
  useToastController,
} from "@fluentui/react-components";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./app/AppShell";
import { AppToolbar } from "./app/AppToolbar";
import { LibrarySidebar } from "./app/LibrarySidebar";
import { SettingsDialog } from "./app/SettingsMenu";
import { useAppSettings } from "./components/ThemeProvider";
import { useLibraryImport } from "./features/import/useLibraryImport";
import { EmojiLibraryView } from "./features/library/EmojiLibraryView";
import {
  getErrorMessage,
  getIndexedImages,
  getRecentImages,
  getStorageInfo,
  openAssetsDirectory,
  showQuickSearch,
  updateClipboardCollectShortcut,
  updateQuickSearchShortcut,
} from "./lib/tauri";
import type {
  GridDensity,
  ImageCopiedEvent,
  IndexedImage,
  LibraryGroup,
  LibraryView,
  ManagedImportSummary,
  RecentImageRecord,
  SortOption,
  StorageInfo,
} from "./types";

const groups: LibraryGroup[] = [];
const viewTitles = {
  all: "全部表情",
  recent: "最近使用",
  favorites: "收藏",
} as const;

const useStyles = makeStyles({
  dropOverlay: {
    position: "fixed",
    inset: "16px",
    zIndex: 10000,
    display: "grid",
    placeItems: "center",
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorNeutralBackground1Hover,
    border: `2px dashed ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow64,
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    pointerEvents: "none",
  },
});

export function App() {
  const styles = useStyles();
  const toasterId = useId("emobox-toaster");
  const { dispatchToast } = useToastController(toasterId);
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    defaultView,
    quickSearchShortcut,
    setQuickSearchShortcut,
    clipboardCollectShortcut,
    setClipboardCollectShortcut,
  } = useAppSettings();
  const {
    isImporting,
    error,
    setError,
    importImages,
    importFolder,
    importPaths,
    collectFromClipboard,
  } = useLibraryImport();

  const [allItems, setAllItems] = useState<IndexedImage[]>([]);
  const [currentView, setCurrentView] = useState<LibraryView>(defaultView);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("name-asc");
  const [density, setDensity] = useState<GridDensity>("comfortable");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [recentItems, setRecentItems] = useState<RecentImageRecord[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [shortcutRegistered, setShortcutRegistered] = useState(false);
  const [shortcutError, setShortcutError] = useState("");
  const lastShortcutErrorToast = useRef("");
  const [clipboardCollectRegistered, setClipboardCollectRegistered] = useState(false);
  const [clipboardCollectError, setClipboardCollectError] = useState("");
  const lastClipboardCollectErrorToast = useRef("");

  const refreshLibrary = useCallback(async () => {
    try {
      setAllItems(await getIndexedImages());
    } catch (loadError) {
      setError(`无法读取本地表情库：${getErrorMessage(loadError)}`);
    }
  }, [setError]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    Promise.allSettled([getIndexedImages(), getRecentImages(), getStorageInfo()])
      .then(([indexedResult, recentResult, storageResult]) => {
        if (disposed) return;
        if (indexedResult.status === "fulfilled") setAllItems(indexedResult.value);
        else setError(`无法读取本地表情库：${getErrorMessage(indexedResult.reason)}`);
        if (recentResult.status === "fulfilled") setRecentItems(recentResult.value);
        if (storageResult.status === "fulfilled") setStorageInfo(storageResult.value);
      });

    listen<ImageCopiedEvent>("image-copied", ({ payload }) => {
      setRecentItems((current) => [
        payload.recent,
        ...current.filter((record) => record.item.path !== payload.item.path),
      ].slice(0, 50));
      dispatchToast(
        <Toast>
          <ToastTitle>已复制 {payload.item.name}</ToastTitle>
          <ToastBody>{payload.outcome.message}</ToastBody>
        </Toast>,
        { intent: "success" },
      );
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((listenError) => {
      console.error("无法监听图片复制事件", listenError);
    });

    // 监听剪贴板收藏请求（来自 Ctrl+Alt+S 全局快捷键）
    const collectListener = listen("clipboard-collect-requested", () => {
      void handleCollectFromClipboard();
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((listenError) => {
      console.error("无法监听剪贴板收藏事件", listenError);
    });
    void collectListener;

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [dispatchToast, setError]);

  const showShortcutError = useCallback((message: string, registered = false) => {
    setShortcutRegistered(registered);
    setShortcutError(message);
    if (lastShortcutErrorToast.current === message) return;

    lastShortcutErrorToast.current = message;
    dispatchToast(
      <Toast>
        <ToastTitle>快捷键注册失败</ToastTitle>
        <ToastBody>{message}</ToastBody>
      </Toast>,
      { intent: "error" },
    );
  }, [dispatchToast]);

  useEffect(() => {
    let cancelled = false;

    updateQuickSearchShortcut(quickSearchShortcut)
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.kind === "registered" || outcome.kind === "unchanged") {
          setShortcutRegistered(true);
          setShortcutError("");
          lastShortcutErrorToast.current = "";
        } else if (outcome.kind === "conflict") {
          setShortcutRegistered(false);
          showShortcutError(
            outcome.otherOwner === "clipboardCollect"
              ? "该快捷键已被「从剪贴板收藏」占用"
              : "该快捷键已被「快速搜索」占用",
          );
        } else if (outcome.kind === "failed") {
          setShortcutRegistered(false);
          showShortcutError(outcome.reason, outcome.requiresRecovery);
        }
      })
      .catch((registrationError) => {
        if (!cancelled) showShortcutError(getErrorMessage(registrationError));
      });

    return () => {
      cancelled = true;
    };
  }, [quickSearchShortcut, showShortcutError]);

  useEffect(() => {
    let cancelled = false;

    updateClipboardCollectShortcut(clipboardCollectShortcut)
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.kind === "registered" || outcome.kind === "unchanged") {
          setClipboardCollectRegistered(true);
          setClipboardCollectError("");
          lastClipboardCollectErrorToast.current = "";
        } else if (outcome.kind === "conflict") {
          setClipboardCollectRegistered(false);
          const message =
            outcome.otherOwner === "quickSearch"
              ? "该快捷键已被「快速搜索」占用"
              : "该快捷键已被「从剪贴板收藏」占用";
          if (lastClipboardCollectErrorToast.current !== message) {
            lastClipboardCollectErrorToast.current = message;
            dispatchToast(
              <Toast>
                <ToastTitle>快捷键注册失败</ToastTitle>
                <ToastBody>{message}</ToastBody>
              </Toast>,
              { intent: "error" },
            );
          }
        } else if (outcome.kind === "failed") {
          setClipboardCollectRegistered(false);
          setClipboardCollectError(outcome.reason);
          if (lastClipboardCollectErrorToast.current !== outcome.reason) {
            lastClipboardCollectErrorToast.current = outcome.reason;
            dispatchToast(
              <Toast>
                <ToastTitle>快捷键注册失败</ToastTitle>
                <ToastBody>{outcome.reason}</ToastBody>
              </Toast>,
              { intent: "error" },
            );
          }
        }
      })
      .catch((registrationError) => {
        if (!cancelled) {
          const message = getErrorMessage(registrationError);
          setClipboardCollectError(message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clipboardCollectShortcut, dispatchToast]);

  const prepareAfterImport = useCallback(async () => {
    setCurrentView("all");
    setSearchQuery("");
    setSelectedPath(null);
    await refreshLibrary();
  }, [refreshLibrary]);

  const showManagedImportResult = useCallback((summary: ManagedImportSummary) => {
    const intent = summary.failedCount > 0
      ? summary.successCount > 0 ? "warning" : "error"
      : "success";
    dispatchToast(
      <Toast>
        <ToastTitle>导入完成：成功 {summary.successCount} 张</ToastTitle>
        <ToastBody>
          重复跳过 {summary.duplicateCount} 张，失败 {summary.failedCount} 张。
          {summary.failures[0] ? ` ${summary.failures[0].message}` : ""}
        </ToastBody>
      </Toast>,
      { intent },
    );
  }, [dispatchToast]);

  const handleImportImages = useCallback(async () => {
    const summary = await importImages();
    if (!summary) return;
    await prepareAfterImport();
    showManagedImportResult(summary);
  }, [importImages, prepareAfterImport, showManagedImportResult]);

  const handleImportFolder = useCallback(async () => {
    const summary = await importFolder();
    if (!summary) return;
    await prepareAfterImport();

    dispatchToast(
      <Toast>
        <ToastTitle>已索引 {summary.indexedCount} 张外部图片</ToastTitle>
        {(summary.skippedCount > 0 || summary.unsupportedCount > 0) && (
          <ToastBody>跳过 {summary.skippedCount} 个无法读取项和 {summary.unsupportedCount} 个其他文件。</ToastBody>
        )}
      </Toast>,
      { intent: "success" },
    );
  }, [dispatchToast, importFolder, prepareAfterImport]);

  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    const summary = await importPaths(paths);
    if (!summary) return;
    await prepareAfterImport();
    showManagedImportResult(summary);
  }, [importPaths, prepareAfterImport, showManagedImportResult]);

  const handleCollectFromClipboard = useCallback(async () => {
    const outcome = await collectFromClipboard();
    if (!outcome) return;
    switch (outcome.kind) {
      case "empty":
        dispatchToast(
          <Toast>
            <ToastTitle>剪贴板中没有图片</ToastTitle>
            <ToastBody>{outcome.message}</ToastBody>
          </Toast>,
          { intent: "info" },
        );
        return;
      case "imported":
        await prepareAfterImport();
        showManagedImportResult(outcome.summary);
        return;
      case "duplicate":
        await prepareAfterImport();
        dispatchToast(
          <Toast>
            <ToastTitle>已在素材库中</ToastTitle>
            <ToastBody>{outcome.message}</ToastBody>
          </Toast>,
          { intent: "info" },
        );
        return;
      case "failed":
        dispatchToast(
          <Toast>
            <ToastTitle>从剪贴板收藏失败</ToastTitle>
            <ToastBody>{`${outcome.message}（${outcome.reason}）`}</ToastBody>
          </Toast>,
          { intent: "error" },
        );
        return;
      case "unavailable":
        dispatchToast(
          <Toast>
            <ToastTitle>无法读取剪贴板</ToastTitle>
            <ToastBody>{`${outcome.message}（${outcome.reason}）`}</ToastBody>
          </Toast>,
          { intent: "error" },
        );
        return;
    }
  }, [collectFromClipboard, dispatchToast, prepareAfterImport, showManagedImportResult]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    getCurrentWindow().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter") {
        setDragActive(true);
      } else if (payload.type === "leave") {
        setDragActive(false);
      } else if (payload.type === "drop") {
        setDragActive(false);
        if (!isImporting) void handleDroppedPaths(payload.paths);
      }
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((dragError) => {
      setError(`无法启用文件拖拽：${getErrorMessage(dragError)}`);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleDroppedPaths, isImporting, setError]);

  useEffect(() => {
    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.ctrlKey && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("[data-emobox-main-search] input")?.focus();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, []);

  const openQuickSearch = useCallback(async () => {
    try {
      await showQuickSearch();
    } catch (openError) {
      dispatchToast(
        <Toast>
          <ToastTitle>无法打开快捷搜索</ToastTitle>
          <ToastBody>{getErrorMessage(openError)}</ToastBody>
        </Toast>,
        { intent: "error" },
      );
    }
  }, [dispatchToast]);

  const handleOpenAssetsDirectory = useCallback(async () => {
    try {
      await openAssetsDirectory();
    } catch (openError) {
      dispatchToast(
        <Toast>
          <ToastTitle>无法打开素材库</ToastTitle>
          <ToastBody>{getErrorMessage(openError)}</ToastBody>
        </Toast>,
        { intent: "error" },
      );
    }
  }, [dispatchToast]);

  const changeQuickSearchShortcut = useCallback(async (shortcut: string) => {
    const outcome = await updateQuickSearchShortcut(shortcut);
    if (outcome.kind === "registered" || outcome.kind === "unchanged") {
      setShortcutRegistered(true);
      setShortcutError("");
      lastShortcutErrorToast.current = "";
      setQuickSearchShortcut(shortcut);
      if (outcome.kind === "registered") {
        dispatchToast(
          <Toast>
            <ToastTitle>快捷键已更新</ToastTitle>
            <ToastBody>{outcome.display}</ToastBody>
          </Toast>,
          { intent: "success" },
        );
      }
      return null;
    }
    if (outcome.kind === "conflict") {
      const message =
        outcome.otherOwner === "clipboardCollect"
          ? "该快捷键已被「从剪贴板收藏」占用"
          : "该快捷键已被「快速搜索」占用";
      showShortcutError(message, false);
      return message;
    }
    // failed
    showShortcutError(outcome.reason, outcome.requiresRecovery);
    return outcome.reason;
  }, [dispatchToast, setQuickSearchShortcut, showShortcutError]);

  const changeClipboardCollectShortcut = useCallback(async (shortcut: string) => {
    const outcome = await updateClipboardCollectShortcut(shortcut);
    if (outcome.kind === "registered" || outcome.kind === "unchanged") {
      setClipboardCollectRegistered(true);
      setClipboardCollectError("");
      lastClipboardCollectErrorToast.current = "";
      setClipboardCollectShortcut(shortcut);
      if (outcome.kind === "registered") {
        dispatchToast(
          <Toast>
            <ToastTitle>快捷键已更新</ToastTitle>
            <ToastBody>{outcome.display}</ToastBody>
          </Toast>,
          { intent: "success" },
        );
      }
      return null;
    }
    if (outcome.kind === "conflict") {
      const message =
        outcome.otherOwner === "quickSearch"
          ? "该快捷键已被「快速搜索」占用"
          : "该快捷键已被「从剪贴板收藏」占用";
      setClipboardCollectError(message);
      return message;
    }
    setClipboardCollectError(outcome.reason);
    return outcome.reason;
  }, [dispatchToast, setClipboardCollectShortcut]);

  const toggleFavorite = useCallback((item: IndexedImage) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(item.path)) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
  }, []);

  const viewItems = useMemo(() => {
    if (currentView === "recent") return recentItems.map((record) => record.item);
    if (currentView === "favorites") return allItems.filter((item) => favorites.has(item.path));
    if (currentView.startsWith("group:")) return [];
    return allItems;
  }, [allItems, currentView, favorites, recentItems]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    const filtered = normalizedQuery
      ? viewItems.filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery))
      : [...viewItems];

    if (currentView !== "recent") filtered.sort((left, right) => {
      if (sortOption === "name-desc") return right.name.localeCompare(left.name, "zh-CN");
      if (sortOption === "format") {
        const extensionOrder = left.extension.localeCompare(right.extension, "en");
        return extensionOrder || left.name.localeCompare(right.name, "zh-CN");
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });

    return filtered;
  }, [currentView, searchQuery, sortOption, viewItems]);

  const currentTitle = currentView.startsWith("group:")
    ? groups.find((group) => `group:${group.id}` === currentView)?.name ?? "分组"
    : viewTitles[currentView as keyof typeof viewTitles];

  return (
    <>
      <AppShell
        sidebarCollapsed={sidebarCollapsed}
        toolbar={
          <AppToolbar
            query={searchQuery}
            importing={isImporting}
            showImport={allItems.length > 0}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
            onQueryChange={setSearchQuery}
            onImportImages={() => void handleImportImages()}
            onImportFolder={() => void handleImportFolder()}
            onCollectFromClipboard={() => void handleCollectFromClipboard()}
          />
        }
        sidebar={
          <LibrarySidebar
            collapsed={sidebarCollapsed}
            currentView={currentView}
            allCount={allItems.length}
            favoriteCount={favorites.size}
            groups={groups}
            quickSearchShortcut={quickSearchShortcut}
            shortcutRegistered={shortcutRegistered}
            onViewChange={setCurrentView}
            onOpenQuickSearch={() => void openQuickSearch()}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        }
      >
        <EmojiLibraryView
          view={currentView}
          title={currentTitle}
          allItemCount={allItems.length}
          items={filteredItems}
          query={searchQuery}
          density={density}
          sortOption={sortOption}
          selectedPath={selectedPath}
          favorites={favorites}
          importing={isImporting}
          error={error}
          onClearError={() => setError("")}
          onClearSearch={() => setSearchQuery("")}
          onImportImages={() => void handleImportImages()}
          onImportFolder={() => void handleImportFolder()}
          onCollectFromClipboard={() => void handleCollectFromClipboard()}
          onDensityChange={setDensity}
          onSortChange={setSortOption}
          onSelect={(item) => setSelectedPath(item.path)}
          onToggleFavorite={toggleFavorite}
        />
      </AppShell>

      <SettingsDialog
        open={settingsOpen}
        storageInfo={storageInfo}
        shortcutRegistered={shortcutRegistered}
        shortcutError={shortcutError}
        onOpenChange={setSettingsOpen}
        onOpenAssetsDirectory={() => void handleOpenAssetsDirectory()}
        onPreviewQuickSearch={() => void openQuickSearch()}
        onUpdateQuickSearchShortcut={changeQuickSearchShortcut}
        clipboardCollectShortcut={clipboardCollectShortcut}
        clipboardCollectRegistered={clipboardCollectRegistered}
        clipboardCollectError={clipboardCollectError}
        onUpdateClipboardCollectShortcut={changeClipboardCollectShortcut}
      />

      {dragActive && <div className={styles.dropOverlay}>释放以保存到 EmoBox 素材库</div>}
      <Toaster toasterId={toasterId} position="top-end" />
    </>
  );
}