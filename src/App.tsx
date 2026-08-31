import {
  Button,
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
import { GroupDialog } from "./features/library/GroupDialog";
import { MoveToGroupDialog } from "./features/library/MoveToGroupDialog";
import { TagPickerDialog } from "./features/library/TagPickerDialog";
import { useDebouncedValue } from "./features/library/useDebouncedValue";
import { useMultiSelection, type SelectionMode } from "./features/library/useMultiSelection";
import {
  addTagsToEmojis,
  copyImageToClipboard,
  createGroup,
  createTag,
  deleteGroup,
  getErrorMessage,
  getRecentImages,
  getStorageInfo,
  listDeletedEmojis,
  listGroups,
  listTags,
  openAssetsDirectory,
  removeTagsFromEmojis,
  renameGroup,
  searchEmojis,
  setEmojisFavorite,
  setGroupPinned,
  showInExplorer,
  showQuickSearch,
  softDeleteToTrash,
  updateClipboardCollectShortcut,
  updateQuickSearchShortcut,
} from "./lib/tauri";
import { filterItemsByQuery } from "./lib/searchSyntax";
import type {
  GridDensity,
  ImageCopiedEvent,
  IndexedEmoji,
  IndexedImage,
  LibraryGroup,
  LibraryView,
  ManagedImportSummary,
  RecentImageRecord,
  SortOption,
  StorageInfo,
  Tag,
} from "./types";

const viewTitles: Record<string, string> = {
  all: "全部表情",
  recent: "最近使用",
  favorites: "收藏",
  trash: "回收站",
  ungrouped: "未分组",
};

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

function toLegacyImage(emoji: IndexedEmoji): IndexedImage {
  return {
    id: emoji.id,
    name: emoji.name,
    path: emoji.path,
    extension: emoji.extension,
    width: emoji.width,
    height: emoji.height,
    sizeBytes: emoji.sizeBytes,
  };
}

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
    downloadWebGif,
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

  // 当前视图对应的表情（IndexedEmoji 13 字段）。
  const [currentEmojis, setCurrentEmojis] = useState<IndexedEmoji[]>([]);
  // 完整数据：IndexedEmoji 13 字段（用于跨视图引用 + 收藏同步）。
  const [indexedEmojis, setIndexedEmojis] = useState<IndexedEmoji[]>([]);
  // 兼容旧 UI 的 IndexedImage 派生（from allItems 视图）。
  const [allItems, setAllItems] = useState<IndexedImage[]>([]);
  // 收藏：path-based（兼容现有 UI）+ id-based（后端操作）
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(() => new Set());
  // 关系
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  // 回收站数量
  const [trashCount, setTrashCount] = useState(0);
  // 多选状态由 useMultiSelection 托管（见 filteredItems 之后的调用点）。
  // clearSelectionRef 让定义较早的 prepareAfterImport 也能触发清空。
  const clearSelectionRef = useRef<() => void>(() => {});
  // 键盘快捷键的 latest-handler 容器：keydown effect deps 保持 []，避免闭包过期。
  const keyShortcutRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  // 剪贴板收藏的 latest-handler 容器：事件监听 effect 不随设置变化重注册，
  // 但 handleCollectFromClipboard 依赖 downloadWebGif 等设置——必须经 ref 转发，
  // 否则监听器捕获首次挂载时的旧闭包（Phase 16 实测踩过：开关改了不生效）。
  const collectFromClipboardRef = useRef<() => void>(() => {});
  // GroupDialog 状态
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupDialogBusy, setGroupDialogBusy] = useState(false);
  // 加入分组弹窗状态
  const [moveToGroupState, setMoveToGroupState] = useState<{
    emojiIds: number[];
  } | null>(null);
  const [moveToGroupBusy, setMoveToGroupBusy] = useState(false);
  // 标签选择弹窗状态
  const [tagPickerState, setTagPickerState] = useState<{
    emojiIds: number[];
    initiallySelectedTagIds: number[];
  } | null>(null);
  const [tagPickerBusy, setTagPickerBusy] = useState(false);

  const [currentView, setCurrentView] = useState<LibraryView>(defaultView);
  const [viewLoading, setViewLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("name-asc");
  const [density, setDensity] = useState<GridDensity>("comfortable");
  const [recentItems, setRecentItems] = useState<RecentImageRecord[]>([]);
  // 显式多选模式：开启后单击即切换选中，关闭时清空选区。
  const [multiSelectMode, setMultiSelectMode] = useState(false);

  const debouncedQuery = useDebouncedValue(searchQuery, 200);

  // tagId → Tag 映射（用于 chip 渲染）
  const tagById = useMemo(() => {
    const m = new Map<number, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  // path → tag 名字数组
  const tagsByPath = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const e of currentEmojis) {
      const names: string[] = [];
      for (const id of e.tagIds) {
        const t = tagById.get(id);
        if (t) names.push(t.name);
      }
      if (names.length > 0) result[e.path] = names;
    }
    return result;
  }, [currentEmojis, tagById]);
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
      // 拉取完整 IndexedEmoji（带 id 和收藏标志）
      const items = await searchEmojis({
        view: "all",
        limit: 500,
        offset: 0,
      });
      setIndexedEmojis(items);
      setAllItems(items.map(toLegacyImage));
      // 同步收藏 id 集合
      const favIds = new Set<number>();
      for (const item of items) {
        if (item.isFavorite) {
          favIds.add(item.id);
        }
      }
      setFavoriteIds(favIds);
      setFavorites(new Set(items.filter((i) => i.isFavorite).map((i) => i.path)));
    } catch (loadError) {
      setError(`无法读取本地表情库：${getErrorMessage(loadError)}`);
    }
  }, [setError]);

  const refreshSidebar = useCallback(async () => {
    try {
      const [g, t, deleted] = await Promise.allSettled([
        listGroups(),
        listTags(),
        listDeletedEmojis(),
      ]);
      if (g.status === "fulfilled") setGroups(g.value);
      if (t.status === "fulfilled") setTags(t.value);
      if (deleted.status === "fulfilled") setTrashCount(deleted.value.length);
    } catch {
      // ignore
    }
  }, []);

  const addEmojisToGroupInline = useCallback(
    async (groupId: number, ids: number[]) => {
      const { addEmojisToGroup } = await import("./lib/tauri");
      await addEmojisToGroup(groupId, ids);
      await refreshSidebar();
    },
    [refreshSidebar],
  );

  const handleMoveToGroupConfirm = useCallback(
    async (payload: {
      existingGroupIds: number[];
      newGroupName: string | null;
    }) => {
      if (!moveToGroupState) return;
      setMoveToGroupBusy(true);
      try {
        let newGroupId: number | null = null;
        if (payload.newGroupName) {
          const created = await createGroup(payload.newGroupName);
          newGroupId = created.id;
        }
        const allGroupIds = [
          ...payload.existingGroupIds,
          ...(newGroupId !== null ? [newGroupId] : []),
        ];
        for (const gid of allGroupIds) {
          await addEmojisToGroupInline(gid, moveToGroupState.emojiIds);
        }
        setMoveToGroupState(null);
        if (allGroupIds.length > 0) {
          setCurrentView(`group:${allGroupIds[0]}`);
        }
        dispatchToast(
          <Toast>
            <ToastTitle>已加入 {allGroupIds.length} 个分组</ToastTitle>
          </Toast>,
          { intent: "success" },
        );
      } catch (e) {
        setError(`加入分组失败：${getErrorMessage(e)}`);
        throw e; // 让弹窗内的 MessageBar 也展示
      } finally {
        setMoveToGroupBusy(false);
      }
    },
    [moveToGroupState, addEmojisToGroupInline, dispatchToast, setError],
  );

  const handleTagPickerConfirm = useCallback(
    async (payload: {
      addedTagIds: number[];
      removedTagIds: number[];
      newTagName: string | null;
    }) => {
      if (!tagPickerState) return;
      setTagPickerBusy(true);
      try {
        let newTagId: number | null = null;
        if (payload.newTagName) {
          const created = await createTag(payload.newTagName);
          newTagId = created.id;
        }
        const addIds = [
          ...payload.addedTagIds,
          ...(newTagId !== null ? [newTagId] : []),
        ];
        if (addIds.length > 0) {
          await addTagsToEmojis(addIds, tagPickerState.emojiIds);
        }
        if (payload.removedTagIds.length > 0) {
          await removeTagsFromEmojis(payload.removedTagIds, tagPickerState.emojiIds);
        }
        const updateTags = (items: IndexedEmoji[]) =>
          items.map((it) => {
            if (!tagPickerState.emojiIds.includes(it.id)) return it;
            const next = new Set(it.tagIds);
            for (const id of addIds) next.add(id);
            for (const id of payload.removedTagIds) next.delete(id);
            return { ...it, tagIds: Array.from(next) };
          });
        setCurrentEmojis(updateTags);
        setIndexedEmojis(updateTags);
        await refreshSidebar();
        setTagPickerState(null);
        dispatchToast(
          <Toast>
            <ToastTitle>标签已更新</ToastTitle>
          </Toast>,
          { intent: "success" },
        );
      } catch (e) {
        setError(`更新标签失败：${getErrorMessage(e)}`);
        throw e;
      } finally {
        setTagPickerBusy(false);
      }
    },
    [tagPickerState, dispatchToast, refreshSidebar, setError],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void refreshLibrary();
    void refreshSidebar();

    Promise.allSettled([getRecentImages(), getStorageInfo()])
      .then(([recentResult, storageResult]) => {
        if (disposed) return;
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

    const collectListener = listen("clipboard-collect-requested", () => {
      void collectFromClipboardRef.current();
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
  }, [dispatchToast, setError, refreshLibrary, refreshSidebar]);

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
    clearSelectionRef.current();
    await refreshLibrary();
    await refreshSidebar();
  }, [refreshLibrary, refreshSidebar]);

  const showManagedImportResult = useCallback(
    (summary: ManagedImportSummary, note?: string) => {
    const intent = summary.failedCount > 0
      ? summary.successCount > 0 ? "warning" : "error"
      : "success";
    const totalDuplicates =
      summary.exactDuplicateCount + summary.perceptualDuplicateCount;
    const retryPaths = summary.perceptualDuplicates.map((d) => d.sourcePath);

    dispatchToast(
      <Toast>
        <ToastTitle
          action={
            retryPaths.length > 0 ? (
              <Button
                appearance="primary"
                onClick={() => {
                  void (async () => {
                    const retried = await importPaths(retryPaths, true);
                    if (retried) {
                      await prepareAfterImport();
                      showManagedImportResult(retried);
                    }
                  })();
                }}
              >
                强制导入
              </Button>
            ) : undefined
          }
        >
          导入完成：成功 {summary.successCount} 张
        </ToastTitle>
        <ToastBody>
          {note ? `${note} ` : ""}重复跳过 {totalDuplicates} 张
          {summary.perceptualDuplicateCount > 0
            ? `（其中感知相似 ${summary.perceptualDuplicateCount} 张）`
            : ""}
          ，失败 {summary.failedCount} 张。
          {summary.failures[0] ? ` ${summary.failures[0].message}` : ""}
        </ToastBody>
      </Toast>,
      { intent },
    );
  }, [dispatchToast, importPaths, prepareAfterImport]);

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

    const totalDuplicates =
      summary.exactDuplicateCount + summary.perceptualDuplicateCount;
    const intent = summary.failedCount > 0
      ? summary.successCount > 0 ? "warning" : "error"
      : "success";
    dispatchToast(
      <Toast>
        <ToastTitle>导入完成：成功 {summary.successCount} 张</ToastTitle>
        <ToastBody>
          {summary.groupsCreated.length > 0
            ? `已新建分组：${summary.groupsCreated.join("、")}。`
            : ""}
          重复跳过 {totalDuplicates} 张
          {summary.perceptualDuplicateCount > 0
            ? `（其中感知相似 ${summary.perceptualDuplicateCount} 张）`
            : ""}
          {summary.failedCount > 0 ? `，失败 ${summary.failedCount} 张` : ""}。
          {summary.failures[0] ? ` ${summary.failures[0].message}` : ""}
        </ToastBody>
      </Toast>,
      { intent },
    );
  }, [dispatchToast, importFolder, prepareAfterImport]);

  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    const summary = await importPaths(paths);
    if (!summary) return;
    await prepareAfterImport();
    showManagedImportResult(summary);
  }, [importPaths, prepareAfterImport, showManagedImportResult]);

  const handleCollectFromClipboard = useCallback(async () => {
    const outcome = await collectFromClipboard(false, downloadWebGif);
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
        // message 携带剪贴板来源说明（GIF 动画保留 / 网页动图提醒等），拼进导入 toast。
        showManagedImportResult(outcome.summary, outcome.message);
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
  }, [collectFromClipboard, dispatchToast, downloadWebGif, prepareAfterImport, showManagedImportResult]);

  // 事件监听 effect（deps 不含本 handler）经 ref 拿到最新闭包。
  collectFromClipboardRef.current = () => {
    void handleCollectFromClipboard();
  };

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
        return;
      }
      keyShortcutRef.current(event);
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, []);

  // 视图变化时重新拉取（后端真正按 view 过滤 + 搜索 query 跨字段 OR）
  useEffect(() => {
    let disposed = false;
    setViewLoading(true);
    const trimmedQuery = debouncedQuery.trim();
    (async () => {
      try {
        let items: IndexedEmoji[] = [];
        if (currentView === "trash") {
          items = await listDeletedEmojis();
        } else if (currentView === "recent") {
          // recent 走 IndexedImage 派生（已有 recentItems 通道），保留后端填充的分组/标签关系。
          items = recentItems.map((r) => ({
            id: r.item.id,
            name: r.item.name,
            path: r.item.path,
            thumbnailPath: null,
            extension: r.item.extension,
            width: r.item.width,
            height: r.item.height,
            sizeBytes: r.item.sizeBytes,
            sourceType: "managed_import",
            isFavorite: false,
            lastUsedAt: Number(r.lastUsedAt),
            usageCount: Number(r.useCount),
            importedAt: null,
            modifiedAt: null,
            groupIds: r.groupIds,
            tagIds: r.tagIds,
          }));
          // 客户端按 query 过滤：精确语法（组*标签）走与后端一致的回退阶梯，否则普通子串。
          items = filterItemsByQuery(items, trimmedQuery, groups, tags);
        } else if (currentView === "favorites") {
          items = await searchEmojis({
            view: "favorites",
            query: trimmedQuery,
            limit: 500,
            offset: 0,
          });
        } else if (currentView === "ungrouped") {
          items = await searchEmojis({
            view: "ungrouped",
            query: trimmedQuery,
            limit: 500,
            offset: 0,
          });
        } else if (currentView.startsWith("group:")) {
          const groupId = parseInt(currentView.slice(6), 10);
          if (Number.isFinite(groupId)) {
            items = await searchEmojis({
              view: "group",
              groupId,
              query: trimmedQuery,
              limit: 500,
              offset: 0,
            });
          }
        } else {
          // "all" 默认
          items = await searchEmojis({
            view: "all",
            query: trimmedQuery,
            limit: 500,
            offset: 0,
          });
        }
        if (disposed) return;
        setCurrentEmojis(items);
        // 同步 allItems（用于其他派生）
        if (currentView === "all") {
          setAllItems(items.map(toLegacyImage));
          setIndexedEmojis(items);
        }
      } catch (e) {
        if (!disposed) setError(`读取视图失败：${getErrorMessage(e)}`);
      } finally {
        if (!disposed) setViewLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, debouncedQuery, recentItems, groups, tags]);

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

  const toggleFavorite = useCallback(async (items: IndexedImage[]) => {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    const allFav = ids.every((id) => favoriteIds.has(id));
    const next = !allFav;
    const idSet = new Set(ids);

    const syncFavorites = (curr: Set<string>, target: boolean) => {
      const s = new Set(curr);
      let changed = false;
      for (const item of items) {
        if (target) {
          if (!s.has(item.path)) {
            s.add(item.path);
            changed = true;
          }
        } else if (s.delete(item.path)) changed = true;
      }
      return changed ? s : curr;
    };
    const syncFavoriteIds = (curr: Set<number>, target: boolean) => {
      const s = new Set(curr);
      let changed = false;
      for (const id of ids) {
        if (target) {
          if (!s.has(id)) {
            s.add(id);
            changed = true;
          }
        } else if (s.delete(id)) changed = true;
      }
      return changed ? s : curr;
    };

    // 乐观更新
    setIndexedEmojis((curr) =>
      curr.map((e) => (idSet.has(e.id) ? { ...e, isFavorite: next } : e)),
    );
    setFavorites((curr) => syncFavorites(curr, next));
    setFavoriteIds((curr) => syncFavoriteIds(curr, next));
    try {
      await setEmojisFavorite(ids, next);
    } catch (e) {
      // 回滚
      setIndexedEmojis((curr) =>
        curr.map((e) => (idSet.has(e.id) ? { ...e, isFavorite: !next } : e)),
      );
      setFavorites((curr) => syncFavorites(curr, !next));
      setFavoriteIds((curr) => syncFavoriteIds(curr, !next));
      setError(`更新收藏失败：${getErrorMessage(e)}`);
    }
  }, [favoriteIds, setError]);

  const viewItems = useMemo(() => {
    // currentEmojis 已经是后端按 view 过滤好的；recent 走 IndexedImage 派生
    if (currentView === "recent") {
      return recentItems.map((record) => record.item);
    }
    return currentEmojis.map((e) => ({
      id: e.id,
      name: e.name,
      path: e.path,
      extension: e.extension,
      width: e.width,
      height: e.height,
      sizeBytes: e.sizeBytes,
      importedAt: e.importedAt,
      modifiedAt: e.modifiedAt,
    }));
  }, [currentView, currentEmojis, recentItems]);

  const filteredItems = useMemo(() => {
    // 搜索过滤已由后端 searchEmojis 处理（query 跨字段 OR 匹配）。
    // 这里只做客户端排序。
    const filtered = [...viewItems];
    if (currentView !== "recent") filtered.sort((left, right) => {
      if (sortOption === "name-desc") return right.name.localeCompare(left.name, "zh-CN");
      if (sortOption === "format") {
        const extensionOrder = left.extension.localeCompare(right.extension, "en");
        return extensionOrder || left.name.localeCompare(right.name, "zh-CN");
      }
      // 时间排序均为「新→旧」；`?? 0` 兜底保证缺失时间戳排最后。
      if (sortOption === "added-time") return (right.importedAt ?? 0) - (left.importedAt ?? 0);
      if (sortOption === "modified-time")
        return (right.modifiedAt ?? right.importedAt ?? 0) - (left.modifiedAt ?? left.importedAt ?? 0);
      return left.name.localeCompare(right.name, "zh-CN");
    });
    return filtered;
  }, [currentView, sortOption, viewItems]);

  // ===== 多选：hook 托管 selectedIds / anchor / Shift 范围 =====
  const { selectedIds, selectOnly, toggle, rangeSelect, selectAll, clear, deselect } =
    useMultiSelection(filteredItems);

  clearSelectionRef.current = clear;

  const indexedById = useMemo(
    () => new Map(indexedEmojis.map((e) => [e.id, e])),
    [indexedEmojis],
  );

  const handleItemSelect = useCallback(
    (item: IndexedImage, mode: SelectionMode) => {
      if (mode === "toggle") toggle(item.id);
      else if (mode === "range") rangeSelect(item.id);
      else selectOnly(item.id);
    },
    [toggle, rangeSelect, selectOnly],
  );

  const handleToggleMultiSelect = useCallback(() => {
    if (multiSelectMode) clear();
    setMultiSelectMode((prev) => !prev);
  }, [multiSelectMode, clear]);

  // 只在真正切换视图时清空选区（覆盖侧栏切换 / 移入分组跳转 / 导入 / 删组所有路径）。
  const prevViewRef = useRef(currentView);
  useEffect(() => {
    if (prevViewRef.current !== currentView) {
      clear();
      setMultiSelectMode(false);
      prevViewRef.current = currentView;
    }
  }, [currentView, clear]);

  // ===== 批量操作（items 数组；单选时传 [item]）=====
  async function handleDelete(items: IndexedImage[]) {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    const label = ids.length === 1 ? `「${items[0].name}」` : `这 ${ids.length} 个表情`;
    if (!window.confirm(`将${label}移入回收站？\n可以从侧栏「回收站」恢复。`)) return;
    try {
      await softDeleteToTrash(ids);
      const idSet = new Set(ids);
      const pathSet = new Set(items.map((item) => item.path));
      setCurrentEmojis((curr) => curr.filter((e) => !idSet.has(e.id)));
      setAllItems((curr) => curr.filter((i) => !idSet.has(i.id)));
      setIndexedEmojis((curr) => curr.filter((e) => !idSet.has(e.id)));
      setRecentItems((curr) => curr.filter((r) => !idSet.has(r.item.id)));
      setFavorites((curr) => {
        let changed = false;
        const s = new Set(curr);
        for (const p of pathSet) if (s.delete(p)) changed = true;
        return changed ? s : curr;
      });
      setFavoriteIds((curr) => {
        let changed = false;
        const s = new Set(curr);
        for (const id of ids) if (s.delete(id)) changed = true;
        return changed ? s : curr;
      });
      deselect(ids);
      await refreshSidebar();
      dispatchToast(
        <Toast>
          <ToastTitle>已移入回收站</ToastTitle>
        </Toast>,
        { intent: "info" },
      );
    } catch (e) {
      setError(`移入回收站失败：${getErrorMessage(e)}`);
    }
  }

  async function handleRestore(items: IndexedImage[]) {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    try {
      const { restoreFromTrash } = await import("./lib/tauri");
      await restoreFromTrash(ids);
      const idSet = new Set(ids);
      setCurrentEmojis((curr) => curr.filter((e) => !idSet.has(e.id)));
      setRecentItems((curr) => curr.filter((r) => !idSet.has(r.item.id)));
      deselect(ids);
      await refreshSidebar();
      dispatchToast(
        <Toast>
          <ToastTitle>已从回收站恢复</ToastTitle>
        </Toast>,
        { intent: "success" },
      );
    } catch (e) {
      setError(`恢复失败：${getErrorMessage(e)}`);
    }
  }

  async function handlePermanentlyDelete(items: IndexedImage[]) {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    const label = ids.length === 1 ? `「${items[0].name}」` : `这 ${ids.length} 个表情`;
    if (!window.confirm(`确定要彻底删除${label}？\n此操作不可撤销。`)) return;
    try {
      const { permanentlyDeleteEmojis } = await import("./lib/tauri");
      await permanentlyDeleteEmojis(ids);
      const idSet = new Set(ids);
      const pathSet = new Set(items.map((item) => item.path));
      setCurrentEmojis((curr) => curr.filter((e) => !idSet.has(e.id)));
      setAllItems((curr) => curr.filter((i) => !idSet.has(i.id)));
      setIndexedEmojis((curr) => curr.filter((e) => !idSet.has(e.id)));
      setRecentItems((curr) => curr.filter((r) => !idSet.has(r.item.id)));
      setFavorites((curr) => {
        let changed = false;
        const s = new Set(curr);
        for (const p of pathSet) if (s.delete(p)) changed = true;
        return changed ? s : curr;
      });
      setFavoriteIds((curr) => {
        let changed = false;
        const s = new Set(curr);
        for (const id of ids) if (s.delete(id)) changed = true;
        return changed ? s : curr;
      });
      deselect(ids);
      await refreshSidebar();
      dispatchToast(
        <Toast>
          <ToastTitle>已彻底删除</ToastTitle>
        </Toast>,
        { intent: "info" },
      );
    } catch (e) {
      setError(`彻底删除失败：${getErrorMessage(e)}`);
    }
  }

  async function handleRemoveFromGroup(items: IndexedImage[]) {
    const groupId = parseInt(currentView.slice(6), 10);
    if (!Number.isFinite(groupId)) return;
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    const group = groups.find((g) => g.id === groupId);
    try {
      const { removeEmojisFromGroup } = await import("./lib/tauri");
      await removeEmojisFromGroup(groupId, ids);
      const idSet = new Set(ids);
      setCurrentEmojis((curr) => curr.filter((e) => !idSet.has(e.id)));
      deselect(ids);
      await refreshSidebar();
      dispatchToast(
        <Toast>
          <ToastTitle>已从「{group?.name ?? "分组"}」移除</ToastTitle>
        </Toast>,
        { intent: "success" },
      );
    } catch (e) {
      setError(`从分组移除失败：${getErrorMessage(e)}`);
    }
  }

  function handleMoveToGroup(items: IndexedImage[]) {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    setMoveToGroupState({ emojiIds: ids });
  }

  function handleAddTags(items: IndexedImage[]) {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    // 初选 = 所有选中项 tagIds 的交集（弹窗 diff 对全集生效）。
    const sets = ids.map((id) => new Set(indexedById.get(id)?.tagIds ?? []));
    const inter = new Set<number>(sets[0] ?? []);
    for (const s of sets.slice(1)) {
      for (const t of [...inter]) if (!s.has(t)) inter.delete(t);
    }
    setTagPickerState({ emojiIds: ids, initiallySelectedTagIds: Array.from(inter) });
  }

  async function handleCopy(items: IndexedImage[]) {
    if (items.length !== 1) return;
    const item = items[0];
    try {
      await copyImageToClipboard(item.path);
      dispatchToast(
        <Toast>
          <ToastTitle>已复制 {item.name}</ToastTitle>
        </Toast>,
        { intent: "success" },
      );
    } catch (e) {
      setError(`复制失败：${getErrorMessage(e)}`);
    }
  }

  async function handleShowInExplorer(items: IndexedImage[]) {
    if (items.length !== 1) return;
    try {
      await showInExplorer(items[0].path);
    } catch (e) {
      setError(`查看文件位置失败：${getErrorMessage(e)}`);
    }
  }

  // ===== Ctrl+A 全选 / Delete 批量回收站（latest-ref，keydown effect deps 保持 []）=====
  keyShortcutRef.current = (event) => {
    // 模态弹窗打开时豁免，避免在弹窗内误触发批量操作。
    const dialogOpen =
      groupDialogOpen || moveToGroupState !== null || tagPickerState !== null || settingsOpen;
    if (dialogOpen) return;

    const el = event.target instanceof HTMLElement ? event.target : null;
    const editable = !!el && (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable ||
      el.getAttribute("role") === "textbox"
    );

    if (event.ctrlKey && event.key.toLocaleLowerCase() === "a") {
      if (editable) return;
      event.preventDefault();
      selectAll();
      return;
    }

    if (event.key === "Delete") {
      if (editable || currentView === "trash") return;
      const selItems = filteredItems.filter((item) => selectedIds.has(item.id));
      if (selItems.length === 0) return;
      event.preventDefault();
      void handleDelete(selItems);
    }
  };

  const currentTitle =
    viewTitles[currentView as keyof typeof viewTitles] ??
    (currentView.startsWith("group:")
      ? groups.find((g) => `group:${g.id}` === currentView)?.name ?? "分组"
      : "");

  return (
    <>
      <AppShell
        sidebarCollapsed={sidebarCollapsed}
        toolbar={
          <AppToolbar
            query={searchQuery}
            importing={isImporting}
            showImport
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
            trashCount={trashCount}
            groups={groups}
            quickSearchShortcut={quickSearchShortcut}
            shortcutRegistered={shortcutRegistered}
            onViewChange={(v) => {
              clear();
              setCurrentView(v);
            }}
            onOpenQuickSearch={() => void openQuickSearch()}
            onOpenSettings={() => setSettingsOpen(true)}
            onCreateGroup={() => setGroupDialogOpen(true)}
            onRenameGroup={async (id, name) => {
              try {
                await renameGroup(id, name);
                await refreshSidebar();
                dispatchToast(
                  <Toast>
                    <ToastTitle>分组已重命名</ToastTitle>
                  </Toast>,
                  { intent: "success" },
                );
              } catch (e) {
                setError(`重命名失败：${getErrorMessage(e)}`);
              }
            }}
            onDeleteGroup={async (id) => {
              try {
                await deleteGroup(id);
                if (currentView === `group:${id}`) setCurrentView("all");
                await refreshSidebar();
                await refreshLibrary();
                dispatchToast(
                  <Toast>
                    <ToastTitle>分组已删除</ToastTitle>
                    <ToastBody>关联的表情不会被删除。</ToastBody>
                  </Toast>,
                  { intent: "success" },
                );
              } catch (e) {
                setError(`删除失败：${getErrorMessage(e)}`);
              }
            }}
            onTogglePinGroup={async (id, pinned) => {
              try {
                await setGroupPinned(id, pinned);
                await refreshSidebar();
              } catch (e) {
                setError(`置顶操作失败：${getErrorMessage(e)}`);
              }
            }}
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
          selectedIds={selectedIds}
          favoriteIds={favoriteIds}
          multiSelectMode={multiSelectMode}
          importing={isImporting}
          error={error}
          tagsByPath={tagsByPath}
          onClearError={() => setError("")}
          onClearSearch={() => setSearchQuery("")}
          onImportImages={() => void handleImportImages()}
          onImportFolder={() => void handleImportFolder()}
          onCollectFromClipboard={() => void handleCollectFromClipboard()}
          onDensityChange={setDensity}
          onSortChange={setSortOption}
          onToggleMultiSelect={handleToggleMultiSelect}
          onItemSelect={handleItemSelect}
          onClearSelection={clear}
          onToggleFavorite={toggleFavorite}
          onCopy={handleCopy}
          onMoveToGroup={handleMoveToGroup}
          onRemoveFromGroup={handleRemoveFromGroup}
          onAddTags={handleAddTags}
          onShowInExplorer={handleShowInExplorer}
          onDelete={handleDelete}
          onRestore={handleRestore}
          onPermanentlyDelete={handlePermanentlyDelete}
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

      {groupDialogOpen && (
        <GroupDialogLite
          open={groupDialogOpen}
          busy={groupDialogBusy}
          onOpenChange={setGroupDialogOpen}
          onSubmit={async (name) => {
            setGroupDialogBusy(true);
            try {
              await createGroup(name);
              await refreshSidebar();
              setGroupDialogOpen(false);
              dispatchToast(
                <Toast>
                  <ToastTitle>分组已创建</ToastTitle>
                </Toast>,
                { intent: "success" },
              );
            } finally {
              setGroupDialogBusy(false);
            }
          }}
        />
      )}

      {moveToGroupState && (
        <MoveToGroupDialog
          open
          emojiCount={moveToGroupState.emojiIds.length}
          existingGroups={groups}
          busy={moveToGroupBusy}
          onOpenChange={(open) => {
            if (!open) setMoveToGroupState(null);
          }}
          onConfirm={handleMoveToGroupConfirm}
        />
      )}

      {tagPickerState && (
        <TagPickerDialog
          open
          emojiCount={tagPickerState.emojiIds.length}
          existingTags={tags}
          initiallySelectedTagIds={tagPickerState.initiallySelectedTagIds}
          busy={tagPickerBusy}
          onOpenChange={(open) => {
            if (!open) setTagPickerState(null);
          }}
          onConfirm={handleTagPickerConfirm}
        />
      )}
    </>
  );
}

// 简化的 GroupDialog 包装（避免循环依赖）
function GroupDialogLite(props: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  return <GroupDialog {...props} mode="create" />;
}
