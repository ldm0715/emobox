import {
  Toast,
  ToastBody,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from "@fluentui/react-components";
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
  getQuickSearchShortcutStatus,
  showQuickSearch,
  updateQuickSearchShortcut,
} from "./lib/tauri";
import type {
  GridDensity,
  IndexedImage,
  LibraryGroup,
  LibraryView,
  SortOption,
} from "./types";

const groups: LibraryGroup[] = [];
const viewTitles = {
  all: "全部表情",
  recent: "最近使用",
  favorites: "收藏",
} as const;

export function App() {
  const toasterId = useId("emobox-toaster");
  const { dispatchToast } = useToastController(toasterId);
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    defaultView,
    quickSearchShortcut,
    setQuickSearchShortcut,
  } = useAppSettings();
  const {
    directory,
    result,
    isImporting,
    error,
    setError,
    importFolder,
  } = useLibraryImport();

  const [currentView, setCurrentView] = useState<LibraryView>(defaultView);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("name-asc");
  const [density, setDensity] = useState<GridDensity>("comfortable");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutRegistered, setShortcutRegistered] = useState(false);
  const [shortcutError, setShortcutError] = useState("");
  const lastShortcutErrorToast = useRef("");

  const allItems = result?.items ?? [];

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
      .then((status) => {
        if (cancelled) return;
        setShortcutRegistered(status.registered);
        setShortcutError("");
        lastShortcutErrorToast.current = "";
      })
      .catch((registrationError) => {
        if (!cancelled) showShortcutError(getErrorMessage(registrationError));
      });

    return () => {
      cancelled = true;
    };
  }, [quickSearchShortcut, showShortcutError]);

  const handleImportFolder = useCallback(async () => {
    const summary = await importFolder();
    if (!summary) return;

    setCurrentView("all");
    setSearchQuery("");
    setSelectedPath(null);

    dispatchToast(
      <Toast>
        <ToastTitle>已导入 {summary.indexedCount} 张表情</ToastTitle>
        {(summary.skippedCount > 0 || summary.unsupportedCount > 0) && (
          <ToastBody>部分文件无法读取或不是支持的图片格式。</ToastBody>
        )}
      </Toast>,
      { intent: "success" },
    );
  }, [dispatchToast, importFolder]);

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

  const changeQuickSearchShortcut = useCallback(async (shortcut: string) => {
    try {
      const status = await updateQuickSearchShortcut(shortcut);
      setShortcutRegistered(status.registered);
      setShortcutError("");
      lastShortcutErrorToast.current = "";
      setQuickSearchShortcut(shortcut);
      dispatchToast(
        <Toast>
          <ToastTitle>快捷键已更新</ToastTitle>
          <ToastBody>{shortcut}</ToastBody>
        </Toast>,
        { intent: "success" },
      );
      return null;
    } catch (registrationError) {
      const message = getErrorMessage(registrationError);
      const status = await getQuickSearchShortcutStatus().catch(() => null);
      showShortcutError(message, status?.registered ?? false);
      return message;
    }
  }, [dispatchToast, setQuickSearchShortcut, showShortcutError]);

  const toggleFavorite = useCallback((item: IndexedImage) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(item.path)) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
  }, []);

  const viewItems = useMemo(() => {
    if (currentView === "recent") return [];
    if (currentView === "favorites") return allItems.filter((item) => favorites.has(item.path));
    if (currentView.startsWith("group:")) return [];
    return allItems;
  }, [allItems, currentView, favorites]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    const filtered = normalizedQuery
      ? viewItems.filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery))
      : [...viewItems];

    filtered.sort((left, right) => {
      if (sortOption === "name-desc") return right.name.localeCompare(left.name, "zh-CN");
      if (sortOption === "format") {
        const extensionOrder = left.extension.localeCompare(right.extension, "en");
        return extensionOrder || left.name.localeCompare(right.name, "zh-CN");
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });

    return filtered;
  }, [searchQuery, sortOption, viewItems]);

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
            onImportFolder={handleImportFolder}
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
          onImportFolder={handleImportFolder}
          onDensityChange={setDensity}
          onSortChange={setSortOption}
          onSelect={(item) => setSelectedPath(item.path)}
          onToggleFavorite={toggleFavorite}
        />
      </AppShell>

      <SettingsDialog
        open={settingsOpen}
        directory={directory}
        shortcutRegistered={shortcutRegistered}
        shortcutError={shortcutError}
        onOpenChange={setSettingsOpen}
        onPreviewQuickSearch={() => void openQuickSearch()}
        onUpdateQuickSearchShortcut={changeQuickSearchShortcut}
      />

      <Toaster toasterId={toasterId} position="top-end" />
    </>
  );
}
