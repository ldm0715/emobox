import {
  Button,
  Toast,
  ToastBody,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from "@fluentui/react-components";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./app/AppShell";
import { AppToolbar } from "./app/AppToolbar";
import { CloseActionDialog, type CloseChoice } from "./app/CloseActionDialog";
import { UpdateAvailableDialog } from "./app/UpdateAvailableDialog";
import { LibrarySidebar } from "./app/LibrarySidebar";
import { SettingsDialog } from "./app/SettingsMenu";
import { useAppSettings } from "./components/ThemeProvider";
import { useLibraryImport } from "./features/import/useLibraryImport";
import { ConfirmDialog } from "./features/library/ConfirmDialog";
import { EmojiLibraryView } from "./features/library/EmojiLibraryView";
import { EmojiPreviewDialog } from "./features/library/EmojiPreviewDialog";
import { GroupDialog } from "./features/library/GroupDialog";
import { GroupIconPickerDialog } from "./features/library/GroupIconPickerDialog";
import { MoveToGroupDialog } from "./features/library/MoveToGroupDialog";
import { RenameEmojiDialog } from "./features/library/RenameEmojiDialog";
import { TagPickerDialog } from "./features/library/TagPickerDialog";
import { buildBatchFilenames, normalizeExtension } from "./features/library/batchRename";
import { useDebouncedValue } from "./features/library/useDebouncedValue";
import { useMultiSelection, type SelectionMode } from "./features/library/useMultiSelection";
import {
  addTagsToEmojis,
  checkForUpdate,
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
  OCR_TAGS_UPDATED_EVENT,
  openAssetsDirectory,
  removeTagsFromEmojis,
  renameEmojis,
  renameGroup,
  searchEmojis,
  setEmojisFavorite,
  exitApplication,
  setGroupIcon,
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
  OcrTagsUpdatedPayload,
  RecentImageRecord,
  RenameEntry,
  SearchOptions,
  SearchResult,
  SortOption,
  StorageInfo,
  UpdateCheckResult,
  Tag,
} from "./types";

const viewTitles: Record<string, string> = {
  all: "全部表情",
  recent: "最近使用",
  favorites: "收藏",
  trash: "回收站",
  ungrouped: "未分组",
};

// ConfirmDialog 待确认操作（批量移入回收站 / 彻底删除等，替代原生 window.confirm——原生框不跟随应用主题）。
interface PendingConfirm {
  title: string;
  message: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/** 主窗口分页每页条数（Phase 17）。网格本身另有 72/批的渐进渲染（EmojiGrid）。 */
const PAGE_SIZE = 200;
/**
 * 按视图构造第 offset 页的请求（Phase 17）。recent 视图数据源在客户端（不请求）。
 * trash 走 listDeletedEmojis（kind: "deleted"），其余走 searchEmojis —— 排序
 * 已下推到 SQL（sort 字面量与后端 ORDER BY 分支一一对应）。
 */
function viewPageRequest(
  view: LibraryView,
  query: string,
  sort: SortOption,
  offset: number,
): { kind: "search"; options: SearchOptions } | { kind: "deleted"; offset: number } | null {
  if (view === "trash") return { kind: "deleted", offset };
  if (view === "recent") return null;
  if (view === "favorites") {
    return { kind: "search", options: { view: "favorites", query, sort, limit: PAGE_SIZE, offset } };
  }
  if (view === "ungrouped") {
    return { kind: "search", options: { view: "ungrouped", query, sort, limit: PAGE_SIZE, offset } };
  }
  if (view.startsWith("group:")) {
    const groupId = parseInt(view.slice(6), 10);
    if (!Number.isFinite(groupId)) return null;
    return { kind: "search", options: { view: "group", groupId, query, sort, limit: PAGE_SIZE, offset } };
  }
  return { kind: "search", options: { view: "all", query, sort, limit: PAGE_SIZE, offset } };
}

/** 执行一次视图页请求（视图 effect 与 loadMore 共用）。recent → null。 */
async function fetchViewPage(
  view: LibraryView,
  query: string,
  sort: SortOption,
  offset: number,
): Promise<SearchResult | null> {
  const request = viewPageRequest(view, query, sort, offset);
  if (!request) return null;
  return request.kind === "deleted"
    ? listDeletedEmojis({ limit: PAGE_SIZE, offset: request.offset })
    : searchEmojis(request.options);
}

export function App() {
  const toasterId = useId("emobox-toaster");
  const { dispatchToast } = useToastController(toasterId);
  // 统一通知模型（2026-09 收敛）：全局操作反馈（成功/提示/**失败**）一律走右上角
  // Toast；失败用 error intent + 7s（默认 5s 对错误信息太短）。上下文局部反馈
  // （弹窗表单错误、浮层 footer 状态行）保留内联，不进全局 toast。
  const notifyError = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { intent: "error", timeout: 7000 },
      );
    },
    [dispatchToast],
  );
  // 复制 toast 防重/去双弹状态：
  // - localCopyToastRef：handleCopy 直接弹 toast 前打的标（事件到达时据此跳过，
  //   避免同一次复制弹两条）。主窗口复制不依赖事件链路，HMR 残留的失效监听不影响反馈。
  // - lastCopyToastRef：监听器（浮层复制路径）自己的 1.2s 同图防重，兜住重复投递。
  const localCopyToastRef = useRef({ path: "", at: 0 });
  const lastCopyToastRef = useRef({ path: "", at: 0 });
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarGroupsCollapsed,
    setSidebarGroupsCollapsed,
    defaultView,
    quickSearchShortcut,
    setQuickSearchShortcut,
    clipboardCollectShortcut,
    setClipboardCollectShortcut,
    downloadWebGif,
    setCloseToTray,
    autoCheckUpdates,
    updateMirrors,
  } = useAppSettings();
  // Phase 27：启动静默检查更新。设置走 latest-ref（effect 只在挂载时跑一次，
  // 用户中途改设置不影响本次会话的检查行为，下次启动生效）。
  const updateCheckSettingsRef = useRef({ autoCheckUpdates, updateMirrors });
  updateCheckSettingsRef.current = { autoCheckUpdates, updateMirrors };
  const {
    isImporting,
    importImages,
    importFolder,
    importPaths,
    collectFromClipboard,
  } = useLibraryImport(notifyError);

  // 启动静默检查出的新版本（status === "available"）。null = 没有可用更新。
  // 弹窗展示后置回 null（结果已进弹窗快照）；「稍后/关闭」只关弹窗不改
  // autoCheckUpdates，本次会话不再重弹（启动检查只跑一次）。
  const [updateAvailable, setUpdateAvailable] = useState<UpdateCheckResult | null>(
    null,
  );
  // 更新弹窗打开态：启动发现新版本自动置 true；设置→关于「检查更新」按钮也打开它。
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  // Phase 27：启动 3s 后静默检查更新（错开启动时的库加载/缩略图请求高峰）。
  // 失败静默——网络不可用不该每次启动都打扰；发现新版本改弹窗（不再用 toast）。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const { autoCheckUpdates: enabled, updateMirrors: mirrors } =
        updateCheckSettingsRef.current;
      if (!enabled) return;
      checkForUpdate(mirrors)
        .then((result) => {
          if (result.status !== "available") return;
          setUpdateAvailable(result);
          setUpdateDialogOpen(true);
        })
        .catch(() => {
          // 启动检查失败静默。
        });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  // 当前视图已加载的表情（IndexedEmoji 13 字段）。Phase 17 分页：只持有已加载页，
  // 滚动到底经 loadMore 追加；总数在 viewTotal，不在数组长度里。
  const [currentEmojis, setCurrentEmojis] = useState<IndexedEmoji[]>([]);
  // 当前视图总数（后端 total），header「共 N 张」与 hasMore 判定用。
  const [viewTotal, setViewTotal] = useState(0);
  // 还有未加载的页（currentEmojis.length < viewTotal）。
  const [hasMore, setHasMore] = useState(false);
  // 侧栏计数（后端 total，Phase 17 起与已加载条数解耦）。
  const [allCount, setAllCount] = useState(0);
  const [favoriteCount, setFavoriteCount] = useState(0);
  // 收藏 id 集（后端操作用）。Phase 17 起从每次页面加载合并 + 乐观更新维护，
  // 不再依赖一次性全量抓取。
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(() => new Set());
  // 关系
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  // 回收站数量
  const [trashCount, setTrashCount] = useState(0);
  // 多选状态由 useMultiSelection 托管（见 filteredItems 之后的调用点）。
  // clearSelectionRef 让定义较早的 prepareAfterImport 也能触发清空。
  const clearSelectionRef = useRef<() => void>(() => {});
  // 视图请求序号：视图/搜索词/排序变化时递增，loadMore 的迟到的追加响应
  // 据此丢弃（与浮层 requestSeq 同思路）。
  const viewSeqRef = useRef(0);
  // 落地代数：只在视图/搜索词/排序真正切换且第 1 页数据落地时递增，驱动
  // EmojiLibraryView 的入场动画 key（keep-previous：旧内容无动画保留到新数据
  // 落地，落地瞬间才重挂载淡入，header 计数与内容同一次 commit 原子更新）。
  const [viewGeneration, setViewGeneration] = useState(0);
  // 上次落地的 view|query|sort 复合 key：同 key 的重拉（recentItems/groups/tags
  // 变化触发）原地更新内容、不重播入场动画（否则 recent 视图每次复制都闪一次）。
  const lastLandedKeyRef = useRef<string | null>(null);
  // Phase 22：分组视图内导入后留在原视图，需要手动触发视图 effect 重拉第 1 页
  // （currentView 等 deps 未变）。landingKey 不变 → 不重播入场动画。
  const [viewReloadTick, setViewReloadTick] = useState(0);
  // Phase 32：OCR 存量回填进度（ocr-tags-updated 事件 phase=backfill 时更新；
  // null = 本会话没触发过回填）。传给设置弹窗展示「正在识别 N/M」。
  const [ocrBackfill, setOcrBackfill] = useState<OcrTagsUpdatedPayload | null>(null);
  // loadMore 防重入（哨兵可能连续触发）。
  const loadingMoreRef = useRef(false);
  // 下一页 offset 游标：按「服务端返回的行数」前进（而非本地 currentEmojis 长度）。
  // 本地删除/去重会让 currentEmojis 与服务端结果集错位，若用其长度做 offset，
  // 全被去重的页会永远请求同一 offset 造成死循环。null = 第 1 页未落地
  // （视图刚切换、旧内容还在显示），loadMore 据此跳过，防止用旧 offset
  // 给新视图追加第 2 页。
  const nextOffsetRef = useRef<number | null>(0);
  // 键盘快捷键的 latest-handler 容器：keydown effect deps 保持 []，避免闭包过期。
  const keyShortcutRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  // 剪贴板收藏的 latest-handler 容器：事件监听 effect 不随设置变化重注册，
  // 但 handleCollectFromClipboard 依赖 downloadWebGif 等设置——必须经 ref 转发，
  // 否则监听器捕获首次挂载时的旧闭包（Phase 16 实测踩过：开关改了不生效）。
  const collectFromClipboardRef = useRef<() => void>(() => {});
  // GroupDialog 状态
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  // 正在更改图标的分组（null = 选择器关闭）。
  const [iconPickerGroup, setIconPickerGroup] = useState<LibraryGroup | null>(null);
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
  // 重命名分组弹窗（复用 GroupDialog 的 rename 模式，替代原生 window.prompt）
  const [renameGroupState, setRenameGroupState] = useState<LibraryGroup | null>(null);
  const [renameGroupBusy, setRenameGroupBusy] = useState(false);
  // 单张重命名弹窗（右键菜单）。name 含扩展名完整名（open 键控快照源）。
  const [renameEmojiState, setRenameEmojiState] = useState<{
    id: number;
    name: string;
    extension: string;
  } | null>(null);
  // 批量模板重命名弹窗（分组视图批量条）。数组顺序 = 当前视图排序（编号顺序）。
  const [batchRenameState, setBatchRenameState] = useState<IndexedImage[] | null>(null);
  const [renameEmojiBusy, setRenameEmojiBusy] = useState(false);
  // 待确认操作（ConfirmDialog）
  const [confirmState, setConfirmState] = useState<PendingConfirm | null>(null);

  const [currentView, setCurrentView] = useState<LibraryView>(defaultView);
  // latest-ref 镜像：拖放 / 全局快捷键收藏等不随视图变化重注册的入口读这里
  // 取「发起那一刻」的视图，避免闭包捕获旧值（App.tsx 闭包陷阱惯例）。
  const currentViewRef = useRef<LibraryView>(currentView);
  currentViewRef.current = currentView;
  // Phase 22：当前浏览的分组 id（仅 group:N 视图有值）。导入四入口在发起时
  // 捕获它作为目标分组；只读 ref，回调身份稳定。
  const getCurrentGroupId = useCallback((): number | null => {
    const view = currentViewRef.current;
    if (!view.startsWith("group:")) return null;
    const groupId = parseInt(view.slice(6), 10);
    return Number.isFinite(groupId) ? groupId : null;
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("name-asc");
  const [density, setDensity] = useState<GridDensity>("comfortable");
  const [recentItems, setRecentItems] = useState<RecentImageRecord[]>([]);
  // 显式多选模式：开启后单击即切换选中，关闭时清空选区。
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  // 双击卡片打开的大图预览项（App 持有：keyShortcutRef 豁免与复制/收藏句柄都在这层）。
  const [previewItem, setPreviewItem] = useState<IndexedImage | null>(null);

  const debouncedQuery = useDebouncedValue(searchQuery, 200);

  // tagId → Tag 映射（用于 chip 渲染）
  const tagById = useMemo(() => {
    const m = new Map<number, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  // path → tag 名字数组（names 数组按 emoji 引用缓存，乐观收藏更新等
  // currentEmojis 引用变化时不重建 → tags prop 身份稳定，memo 不失效）。
  const tagsByPathCacheRef = useRef<{ tagById: Map<number, Tag>; names: WeakMap<object, string[]> }>({
    tagById,
    names: new WeakMap(),
  });
  const tagsByPath = useMemo(() => {
    // tagById 变化（建/改/删标签）时缓存整体失效，避免改名后读旧名。
    if (tagsByPathCacheRef.current.tagById !== tagById) {
      tagsByPathCacheRef.current = { tagById, names: new WeakMap() };
    }
    const cache = tagsByPathCacheRef.current.names;
    const result: Record<string, string[]> = {};
    for (const e of currentEmojis) {
      let names = cache.get(e);
      if (!names) {
        names = e.tagIds.map((id) => tagById.get(id)?.name).filter((name): name is string => !!name);
        cache.set(e, names);
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
  // Phase 25：Rust 在用户点主窗口关闭按钮且尚未记住选择时发事件，弹询问窗。
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  // 询问窗决策：勾「记住」写回 closeToTray 设置（弹窗结果与设置项是同一状态，
  // 开关 UI 随之联动），此后不再弹窗；不勾只对本次生效。托盘走前端 hide()
  // （capability core:window:allow-hide），退出走命令（与托盘「退出」同语义）。
  const handleCloseDecide = useCallback(
    (choice: CloseChoice, remember: boolean) => {
      setCloseDialogOpen(false);
      if (remember) setCloseToTray(choice === "tray");
      if (choice === "tray") {
        getCurrentWindow().hide().catch((hideError) => {
          notifyError(`无法最小化到系统托盘：${getErrorMessage(hideError)}`);
        });
      } else {
        exitApplication().catch((exitError) => {
          notifyError(`无法退出应用：${getErrorMessage(exitError)}`);
        });
      }
    },
    [notifyError, setCloseToTray],
  );

  // Phase 17：refreshLibrary 只拉计数（SQL LIMIT 0 + total），不再全量抓 500 行。
  // 收藏标志改为随每页加载合并（mergeFavoriteFlags）。
  const refreshLibrary = useCallback(async () => {
    try {
      const [allResult, favoritesResult] = await Promise.all([
        searchEmojis({ view: "all", limit: 0 }),
        searchEmojis({ view: "favorites", limit: 0 }),
      ]);
      setAllCount(allResult.total);
      setFavoriteCount(favoritesResult.total);
    } catch (loadError) {
      notifyError(`无法读取本地表情库：${getErrorMessage(loadError)}`);
    }
  }, [notifyError]);

  // 从页面加载结果合并收藏标志（只增不减；取消收藏经 toggleFavorite 的乐观
  // 更新维护，不存在其他取消收藏入口）。
  const mergeFavoriteFlags = useCallback((items: IndexedEmoji[]) => {
    setFavoriteIds((curr) => {
      let changed = false;
      const next = new Set(curr);
      for (const item of items) {
        if (item.isFavorite && !next.has(item.id)) {
          next.add(item.id);
          changed = true;
        }
      }
      return changed ? next : curr;
    });
  }, []);

  const refreshSidebar = useCallback(async () => {
    try {
      const [g, t, deleted] = await Promise.allSettled([
        listGroups(),
        listTags(),
        listDeletedEmojis({ limit: 0 }),
      ]);
      if (g.status === "fulfilled") setGroups(g.value);
      if (t.status === "fulfilled") setTags(t.value);
      if (deleted.status === "fulfilled") setTrashCount(deleted.value.total);
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
        notifyError(`加入分组失败：${getErrorMessage(e)}`);
        throw e; // 让弹窗内的 MessageBar 也展示
      } finally {
        setMoveToGroupBusy(false);
      }
    },
    [moveToGroupState, addEmojisToGroupInline, dispatchToast, notifyError],
  );

  const handleTagPickerConfirm = useCallback(
    async (payload: {
      addedTagIds: number[];
      removedTagIds: number[];
      newTagNames: string[];
    }) => {
      if (!tagPickerState) return;
      setTagPickerBusy(true);
      try {
        const createdNewIds: number[] = [];
        for (const name of payload.newTagNames) {
          const created = await createTag(name);
          createdNewIds.push(created.id);
        }
        const addIds = [...payload.addedTagIds, ...createdNewIds];
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
        await refreshSidebar();
        setTagPickerState(null);
        dispatchToast(
          <Toast>
            <ToastTitle>标签已更新</ToastTitle>
          </Toast>,
          { intent: "success" },
        );
      } catch (e) {
        notifyError(`更新标签失败：${getErrorMessage(e)}`);
        throw e;
      } finally {
        setTagPickerBusy(false);
      }
    },
    [tagPickerState, dispatchToast, refreshSidebar, notifyError],
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
      const now = Date.now();
      // 主窗口自己的复制：handleCopy 已直接弹过（见 localCopyToastRef），跳过。
      const local = localCopyToastRef.current;
      if (local.path === payload.item.path && now - local.at < 3000) return;
      // 其余来源（快捷搜索浮层的复制在主窗口报信）+ 防重复投递：同一张图 1.2s 内只弹一次。
      const last = lastCopyToastRef.current;
      if (last.path === payload.item.path && now - last.at < 1200) return;
      lastCopyToastRef.current = { path: payload.item.path, at: now };
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
  }, [dispatchToast, notifyError, refreshLibrary, refreshSidebar]);

  // Phase 25：主窗口关闭询问（Rust 在用户点 X 且未记住选择时发出，窗口保持
  // 可见）。handler 只做 setState、无依赖值，注册一次即可（勿并入上面 deps
  // 不为空的共享监听 effect）。
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen("main-close-requested", () => {
      setCloseDialogOpen(true);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((listenError) => {
      console.error("无法监听主窗口关闭询问事件", listenError);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Phase 26：托盘菜单「设置」（Rust 先显示主窗口再发事件）。handler 只做
  // setState、无依赖值，注册一次即可。
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen("settings-open-requested", () => {
      setSettingsOpen(true);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((listenError) => {
      console.error("无法监听托盘打开设置事件", listenError);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Phase 32：OCR 识别批次进度（Rust 后台每 10 张 + 批末推送）。import 批次
  // → 新标签落地，刷新侧栏标签并重拉当前视图第 1 页（同 key 重拉不重播入场
  // 动画）；backfill 批次 → 更新设置弹窗的回填进度，完成时 toast；
  // manual 批次（Phase 33 标签弹窗触发）走末尾的刷新分支即可——弹窗自己
  // 订阅同一事件管进度与选中集，这里只负责网格/侧栏数据刷新。
  // refreshSidebar / notifyError / dispatchToast 是稳定引用，随 deps 重注册
  // 监听与既有共享监听 effect 同模式。
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<OcrTagsUpdatedPayload>(OCR_TAGS_UPDATED_EVENT, (event) => {
      const payload = event.payload;
      if (payload.phase === "backfill") {
        setOcrBackfill(payload);
        if (payload.finished) {
          void refreshSidebar();
          setViewReloadTick((tick) => tick + 1);
          if (payload.processed <= 0) {
            notifyError("存量识别未能完成，请检查 OCR 设置或查看应用日志");
          } else if (payload.processed < payload.total) {
            dispatchToast(
              <Toast>
                <ToastTitle>
                  存量识别部分完成（{payload.processed}/{payload.total}），可稍后重试
                </ToastTitle>
              </Toast>,
              { intent: "warning" },
            );
          } else {
            dispatchToast(
              <Toast>
                <ToastTitle>存量识别完成：已处理 {payload.processed} 张</ToastTitle>
              </Toast>,
              { intent: "success" },
            );
          }
        }
        return;
      }
      // import 批次：新导入表情的 OCR 标签落地。
      void refreshSidebar();
      setViewReloadTick((tick) => tick + 1);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((listenError) => {
      console.error("无法监听 OCR 进度事件", listenError);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [dispatchToast, notifyError, refreshSidebar]);

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

  // Phase 22：带 targetGroupId（分组视图内发起的导入）且用户仍停留在该分组
  // 视图时，留在分组并经 viewReloadTick 重拉第 1 页；其余情况维持原行为
  // （切回「全部」，让用户看到刚导入的内容）。
  const prepareAfterImport = useCallback(async (targetGroupId: number | null) => {
    const stayedInTargetGroup =
      targetGroupId !== null && currentViewRef.current === `group:${targetGroupId}`;
    if (!stayedInTargetGroup) {
      setCurrentView("all");
    }
    setSearchQuery("");
    clearSelectionRef.current();
    await refreshLibrary();
    await refreshSidebar();
    if (stayedInTargetGroup) {
      setViewReloadTick((tick) => tick + 1);
    }
  }, [refreshLibrary, refreshSidebar]);

  // toast 文案里的目标分组名（用发起导入时捕获的 id 查名，防中途换视图漂移）。
  const groupNameForToast = useCallback(
    (targetGroupId: number | null): string | null => {
      if (targetGroupId === null) return null;
      const group = groups.find((g) => g.id === targetGroupId);
      return group ? `已加入分组「${group.name}」` : "已加入当前分组";
    },
    [groups],
  );

  const showManagedImportResult = useCallback(
    (
      summary: ManagedImportSummary,
      note?: string,
      targetGroupId: number | null = null,
    ) => {
    const intent = summary.failedCount > 0
      ? summary.successCount > 0 ? "warning" : "error"
      : "success";
    const totalDuplicates =
      summary.exactDuplicateCount + summary.perceptualDuplicateCount;
    const retryPaths = summary.perceptualDuplicates.map((d) => d.sourcePath);
    const groupNote = groupNameForToast(targetGroupId);
    const prefix = [note, groupNote].filter(Boolean).join(" ");

    dispatchToast(
      <Toast>
        <ToastTitle
          action={
            retryPaths.length > 0 ? (
              <Button
                appearance="primary"
                onClick={() => {
                  void (async () => {
                    const retried = await importPaths(retryPaths, true, targetGroupId ?? undefined);
                    if (retried) {
                      await prepareAfterImport(targetGroupId);
                      showManagedImportResult(retried, undefined, targetGroupId);
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
          {prefix ? `${prefix} ` : ""}重复跳过 {totalDuplicates} 张
          {summary.perceptualDuplicateCount > 0
            ? `（其中感知相似 ${summary.perceptualDuplicateCount} 张）`
            : ""}
          ，失败 {summary.failedCount} 张。
          {summary.failures[0] ? ` ${summary.failures[0].message}` : ""}
        </ToastBody>
      </Toast>,
      { intent },
    );
  }, [dispatchToast, groupNameForToast, importPaths, prepareAfterImport]);

  // 回收站收紧（2026-09）：回收站只允许 恢复 / 彻底删除，导入属越权——视图绑定的
  // 三条导入入口（导入图片 / 导入文件夹 / 拖放）在 trash 视图一律拒绝。全局快捷键
  // Ctrl+Alt+S 与视图无关，保持可用。
  const notifyTrashImportBlocked = useCallback(() => {
    dispatchToast(
      <Toast>
        <ToastTitle>回收站视图不支持导入图片</ToastTitle>
      </Toast>,
      { intent: "info" },
    );
  }, [dispatchToast]);

  const handleImportImages = useCallback(async () => {
    if (currentViewRef.current === "trash") {
      notifyTrashImportBlocked();
      return;
    }
    // 发起时捕获目标分组（分组视图内发起 → 导入的图自动归入，Phase 22）。
    const targetGroupId = getCurrentGroupId();
    const summary = await importImages(targetGroupId ?? undefined);
    if (!summary) return;
    await prepareAfterImport(targetGroupId);
    showManagedImportResult(summary, undefined, targetGroupId);
  }, [getCurrentGroupId, importImages, notifyTrashImportBlocked, prepareAfterImport, showManagedImportResult]);

  const handleImportFolder = useCallback(async () => {
    if (currentViewRef.current === "trash") {
      notifyTrashImportBlocked();
      return;
    }
    const targetGroupId = getCurrentGroupId();
    const summary = await importFolder(false, targetGroupId ?? undefined);
    if (!summary) return;
    await prepareAfterImport(targetGroupId);

    const totalDuplicates =
      summary.exactDuplicateCount + summary.perceptualDuplicateCount;
    const intent = summary.failedCount > 0
      ? summary.successCount > 0 ? "warning" : "error"
      : "success";
    const groupNote = groupNameForToast(targetGroupId);
    dispatchToast(
      <Toast>
        <ToastTitle>导入完成：成功 {summary.successCount} 张</ToastTitle>
        <ToastBody>
          {groupNote ? `${groupNote}。` : ""}
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
  }, [dispatchToast, getCurrentGroupId, groupNameForToast, importFolder, notifyTrashImportBlocked, prepareAfterImport]);

  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    if (currentViewRef.current === "trash") {
      notifyTrashImportBlocked();
      return;
    }
    const targetGroupId = getCurrentGroupId();
    const summary = await importPaths(paths, false, targetGroupId ?? undefined);
    if (!summary) return;
    await prepareAfterImport(targetGroupId);
    showManagedImportResult(summary, undefined, targetGroupId);
  }, [getCurrentGroupId, importPaths, notifyTrashImportBlocked, prepareAfterImport, showManagedImportResult]);

  const handleCollectFromClipboard = useCallback(async () => {
    const targetGroupId = getCurrentGroupId();
    const outcome = await collectFromClipboard(false, downloadWebGif, targetGroupId ?? undefined);
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
        await prepareAfterImport(targetGroupId);
        // message 携带剪贴板来源说明（GIF 动画保留 / 网页动图提醒等），拼进导入 toast。
        showManagedImportResult(outcome.summary, outcome.message, targetGroupId);
        return;
      case "duplicate":
        await prepareAfterImport(targetGroupId);
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
  }, [collectFromClipboard, dispatchToast, downloadWebGif, getCurrentGroupId, prepareAfterImport, showManagedImportResult]);

  // 事件监听 effect（deps 不含本 handler）经 ref 拿到最新闭包。
  collectFromClipboardRef.current = () => {
    void handleCollectFromClipboard();
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    getCurrentWindow().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter") {
        // 回收站视图拒绝导入：不显示放置提示（drop 会被 handleDroppedPaths 拒绝）。
        if (currentViewRef.current !== "trash") setDragActive(true);
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
      notifyError(`无法启用文件拖拽：${getErrorMessage(dragError)}`);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleDroppedPaths, isImporting, notifyError]);

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

  // 视图变化时重新拉取第 1 页（后端按 view 过滤 + 搜索 query 跨字段 OR + 排序下推）。
  // Phase 17：sortOption 变化也重拉第 1 页（服务端排序）；viewSeqRef 作废在途的
  // loadMore 追加响应。keep-previous：拉取期间不清 currentEmojis（旧内容保留，
  // 不闪空状态），落地瞬间经 viewGeneration 重挂载淡入新内容。
  useEffect(() => {
    let disposed = false;
    viewSeqRef.current += 1;
    const seq = viewSeqRef.current;
    // 作废追加游标：第 1 页落地前 loadMore 一律跳过（见 nextOffsetRef 注释）。
    nextOffsetRef.current = null;
    const trimmedQuery = debouncedQuery.trim();
    (async () => {
      try {
        let items: IndexedEmoji[] = [];
        let total = 0;
        if (currentView === "recent") {
          // recent 走 IndexedImage 派生（已有 recentItems 通道，上限 50，不分页），
          // 保留后端填充的分组/标签关系。
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
          total = items.length;
        } else {
          const result = await fetchViewPage(currentView, trimmedQuery, sortOption, 0);
          if (!result) throw new Error("当前视图不可用");
          items = result.items;
          total = result.total;
        }
        if (disposed || seq !== viewSeqRef.current) return;
        setCurrentEmojis(items);
        setViewTotal(total);
        setHasMore(items.length < total);
        nextOffsetRef.current = items.length;
        mergeFavoriteFlags(items);
        // 真正的视图/搜索词/排序切换（而非同 key 重拉）→ 递增落地代数，
        // 触发 EmojiLibraryView 的容器级入场动画（key 重挂载）。
        const landingKey = `${currentView}|${trimmedQuery}|${sortOption}`;
        if (lastLandedKeyRef.current !== landingKey) {
          lastLandedKeyRef.current = landingKey;
          setViewGeneration((g) => g + 1);
        }
      } catch (e) {
        if (!disposed && seq === viewSeqRef.current) {
          notifyError(`读取视图失败：${getErrorMessage(e)}`);
        }
      }
    })();
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, debouncedQuery, sortOption, recentItems, groups, tags, viewReloadTick]);

  // Phase 17 无限滚动：滚动到底（EmojiGrid 哨兵）时按 nextOffsetRef 追加下一页。
  // seq 守卫丢弃视图/搜索词/排序已切换的迟到响应；追加按 id 去重防删除导致的
  // offset 漂移；offset 游标按服务端行数前进（见 nextOffsetRef 注释）。
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    const seq = viewSeqRef.current;
    const offset = nextOffsetRef.current;
    // 第 1 页未落地（视图刚切换、旧内容还在显示）→ 不追加。
    if (offset === null) return;
    const trimmedQuery = debouncedQuery.trim();
    loadingMoreRef.current = true;
    try {
      const result = await fetchViewPage(currentView, trimmedQuery, sortOption, offset);
      if (seq !== viewSeqRef.current || !result) return;
      nextOffsetRef.current = offset + result.items.length;
      const existing = new Set(currentEmojis.map((e) => e.id));
      const fresh = result.items.filter((e) => !existing.has(e.id));
      if (fresh.length > 0) {
        setCurrentEmojis((curr) => {
          const seen = new Set(curr.map((e) => e.id));
          return [...curr, ...result.items.filter((e) => !seen.has(e.id))];
        });
      }
      setViewTotal(result.total);
      setHasMore(nextOffsetRef.current < result.total);
      mergeFavoriteFlags(result.items);
    } catch (e) {
      notifyError(`加载更多失败：${getErrorMessage(e)}`);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [currentView, debouncedQuery, sortOption, currentEmojis, hasMore, notifyError, mergeFavoriteFlags]);

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

  // favoriteIds 经 latest-ref 读取：回调身份不随收藏集变化（memo(EmojiGridItem) 前提）。
  const favoriteIdsRef = useRef(favoriteIds);
  favoriteIdsRef.current = favoriteIds;
  // toggleFavorite 定义在 useMultiSelection 之前且 deps 不含 currentView，
  // 经 latest-ref 读实时视图（await 期间切走视图时跳过本地剪辑，防误递减 viewTotal）。
  // currentViewRef 已上移到 currentView 声明处（Phase 22：导入入口也要读它）。

  const toggleFavorite = useCallback(async (items: IndexedImage[]) => {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    const allFav = ids.every((id) => favoriteIdsRef.current.has(id));
    const next = !allFav;

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

    // 乐观更新（当前视图 + 收藏 id 集）
    setCurrentEmojis((curr) =>
      curr.map((e) => (ids.includes(e.id) ? { ...e, isFavorite: next } : e)),
    );
    setFavoriteIds((curr) => syncFavoriteIds(curr, next));
    try {
      await setEmojisFavorite(ids, next);
      // 收藏视图里取消收藏：条目已不属于该视图，成功后本地剪辑掉（镜像
      // performDelete 模式；hasMore 不动，哨兵自动回填）。放成功之后做，
      // 回滚路径只需恢复标志翻转。
      if (!next && currentViewRef.current === "favorites") {
        const idSet = new Set(ids);
        setCurrentEmojis((curr) => curr.filter((e) => !idSet.has(e.id)));
        setViewTotal((curr) => Math.max(0, curr - ids.length));
        deselectRef.current(ids);
      }
      // 收藏计数（侧栏）只有后端知道真值，成功后刷新。
      void refreshLibrary();
    } catch (e) {
      // 回滚
      setCurrentEmojis((curr) =>
        curr.map((e) => (ids.includes(e.id) ? { ...e, isFavorite: !next } : e)),
      );
      setFavoriteIds((curr) => syncFavoriteIds(curr, !next));
      notifyError(`更新收藏失败：${getErrorMessage(e)}`);
    }
  }, [notifyError, refreshLibrary]);

  // 投影缓存：同一 IndexedEmoji 引用 → 同一 IndexedImage 对象。翻页追加/乐观收藏
  // 更新时未变化项保持对象身份，memo(EmojiGridItem) 只重渲染真正变化的卡片。
  const viewItemsCacheRef = useRef(new WeakMap<object, IndexedImage>());
  const viewItems = useMemo(() => {
    // currentEmojis 已经是后端按 view 过滤好的；recent 走 IndexedImage 派生
    if (currentView === "recent") {
      return recentItems.map((record) => record.item);
    }
    const cache = viewItemsCacheRef.current;
    return currentEmojis.map((e) => {
      let item = cache.get(e);
      if (!item) {
        item = {
          id: e.id,
          name: e.name,
          path: e.path,
          extension: e.extension,
          width: e.width,
          height: e.height,
          sizeBytes: e.sizeBytes,
          importedAt: e.importedAt,
          modifiedAt: e.modifiedAt,
        };
        cache.set(e, item);
      }
      return item;
    });
  }, [currentView, currentEmojis, recentItems]);

  const filteredItems = useMemo(() => {
    // 搜索过滤与排序均由后端 searchEmojis 处理（Phase 17 排序下推，offset 分页
    // 的前提）。recent 视图数据源在客户端（上限 50），保留客户端排序。
    if (currentView !== "recent") return viewItems;
    const filtered = [...viewItems];
    filtered.sort((left, right) => {
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

  // deselect 经 latest-ref 转发给定义在 hook 之前的 toggleFavorite。
  const deselectRef = useRef(deselect);
  deselectRef.current = deselect;

  // rangeSelect 依赖 anchorId（每次选区变化都换新），经 latest-ref 转发，
  // 保持 handleItemSelect 身份稳定（memo(EmojiGridItem) 前提）。
  const rangeSelectRef = useRef(rangeSelect);
  rangeSelectRef.current = rangeSelect;

  const handleItemSelect = useCallback(
    (item: IndexedImage, mode: SelectionMode) => {
      if (mode === "toggle") toggle(item.id);
      else if (mode === "range") rangeSelectRef.current(item.id);
      else selectOnly(item.id);
    },
    [toggle, selectOnly],
  );

  clearSelectionRef.current = clear;

  // 标签交集初选只需覆盖选中项，而选中项必在当前视图已加载集内（Phase 17 起
  // 从 currentEmojis 派生，不再依赖全量缓存）。
  const indexedById = useMemo(
    () => new Map(currentEmojis.map((e) => [e.id, e])),
    [currentEmojis],
  );

  // 大图预览的分组/标签名（previewItem 必来自当前视图已加载集，indexedById 覆盖它）。
  const previewMeta = useMemo(() => {
    if (!previewItem) return { groupNames: [] as string[], tagNames: [] as string[] };
    const emoji = indexedById.get(previewItem.id);
    return {
      groupNames: (emoji?.groupIds ?? [])
        .map((id) => groups.find((g) => g.id === id)?.name)
        .filter((name): name is string => !!name),
      tagNames: (emoji?.tagIds ?? [])
        .map((id) => tagById.get(id)?.name)
        .filter((name): name is string => !!name),
    };
  }, [previewItem, indexedById, groups, tagById]);

  // 全选按钮（Phase 17）：只作用于已加载项（filteredItems）；全选了则退化为取消全选。
  const allSelected = selectedIds.size > 0 && selectedIds.size >= filteredItems.length;
  const handleToggleSelectAll = useCallback(() => {
    if (selectedIds.size > 0 && selectedIds.size >= filteredItems.length) clear();
    else selectAll();
  }, [selectedIds, filteredItems, clear, selectAll]);

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
  // 本地剪辑后 viewTotal 同步递减；hasMore 保持不变 —— 哨兵会自动 loadMore
  // 回填刚腾出的位置（追加按 id 去重，offset 漂移安全）。侧栏/头部计数经
  // refreshLibrary（后端 total）刷新。
  async function handleDelete(items: IndexedImage[]) {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    const label = ids.length === 1 ? `「${items[0].name}」` : `这 ${ids.length} 个表情`;
    setConfirmState({
      title: "移入回收站",
      message: `将${label}移入回收站？\n可以从侧栏「回收站」恢复。`,
      confirmText: "移入回收站",
      onConfirm: () => void performDelete(ids),
    });
  }

  async function performDelete(ids: number[]) {
    try {
      await softDeleteToTrash(ids);
      const idSet = new Set(ids);
      setCurrentEmojis((curr) => curr.filter((e) => !idSet.has(e.id)));
      setRecentItems((curr) => curr.filter((r) => !idSet.has(r.item.id)));
      setFavoriteIds((curr) => {
        let changed = false;
        const s = new Set(curr);
        for (const id of ids) if (s.delete(id)) changed = true;
        return changed ? s : curr;
      });
      setViewTotal((curr) => Math.max(0, curr - ids.length));
      deselect(ids);
      await refreshSidebar();
      void refreshLibrary();
      dispatchToast(
        <Toast>
          <ToastTitle>已移入回收站</ToastTitle>
        </Toast>,
        { intent: "info" },
      );
    } catch (e) {
      notifyError(`移入回收站失败：${getErrorMessage(e)}`);
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
      setViewTotal((curr) => Math.max(0, curr - ids.length));
      deselect(ids);
      await refreshSidebar();
      void refreshLibrary();
      dispatchToast(
        <Toast>
          <ToastTitle>已从回收站恢复</ToastTitle>
        </Toast>,
        { intent: "success" },
      );
    } catch (e) {
      notifyError(`恢复失败：${getErrorMessage(e)}`);
    }
  }

  async function handlePermanentlyDelete(items: IndexedImage[]) {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    const label = ids.length === 1 ? `「${items[0].name}」` : `这 ${ids.length} 个表情`;
    setConfirmState({
      title: "彻底删除",
      message: `确定要彻底删除${label}？\n此操作不可撤销。`,
      confirmText: "彻底删除",
      destructive: true,
      onConfirm: () => void performPermanentlyDelete(ids),
    });
  }

  async function performPermanentlyDelete(ids: number[]) {
    try {
      const { permanentlyDeleteEmojis } = await import("./lib/tauri");
      await permanentlyDeleteEmojis(ids);
      const idSet = new Set(ids);
      setCurrentEmojis((curr) => curr.filter((e) => !idSet.has(e.id)));
      setRecentItems((curr) => curr.filter((r) => !idSet.has(r.item.id)));
      setFavoriteIds((curr) => {
        let changed = false;
        const s = new Set(curr);
        for (const id of ids) if (s.delete(id)) changed = true;
        return changed ? s : curr;
      });
      setViewTotal((curr) => Math.max(0, curr - ids.length));
      deselect(ids);
      await refreshSidebar();
      dispatchToast(
        <Toast>
          <ToastTitle>已彻底删除</ToastTitle>
        </Toast>,
        { intent: "info" },
      );
    } catch (e) {
      notifyError(`彻底删除失败：${getErrorMessage(e)}`);
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
      notifyError(`从分组移除失败：${getErrorMessage(e)}`);
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

  // 单张重命名：菜单单项操作（多选时 EmojiItemMenu 已隐藏该项）。读 ref 防御
  // 拒绝回收站（菜单 trash 模式本就不渲染，这里是第三重守卫）。
  function handleRenameEmoji(items: IndexedImage[]) {
    if (items.length !== 1 || currentViewRef.current === "trash") return;
    setRenameEmojiState({
      id: items[0].id,
      name: items[0].name,
      extension: items[0].extension,
    });
  }

  // 批量模板重命名：仅分组视图批量条提供（menuMode === "group" 守卫）。
  // selectedItems 保序 = 当前视图排序，编号按此顺序分配。
  function handleBatchRename(items: IndexedImage[]) {
    if (items.length === 0) return;
    setBatchRenameState(items);
  }

  // 重命名成功后的公共收尾：标签列表变了（文件名标签增删）→ 刷新侧栏；
  // viewReloadTick 重拉第 1 页修正 name 排序位置与 tagIds（新标签 id 前端
  // 拿不到）；recent 视图数据源在客户端，对 recentItems 的 name 做本地补丁。
  async function afterRename(idToName: Map<number, string>) {
    setCurrentEmojis((curr) =>
      curr.map((e) => (idToName.has(e.id) ? { ...e, name: idToName.get(e.id)! } : e)),
    );
    setRecentItems((curr) =>
      curr.map((r) =>
        idToName.has(r.item.id)
          ? { ...r, item: { ...r.item, name: idToName.get(r.item.id)! } }
          : r,
      ),
    );
    await refreshSidebar();
    setViewReloadTick((tick) => tick + 1);
  }

  // 点击卡片 Tag → 注入 `*标签` 精确搜索（后端 list_indexed 与 recent 客户端
  // searchSyntax 都支持该语法）。useCallback 保持身份稳定（卡片 memo 前提）。
  const handleTagClick = useCallback((tag: string) => {
    setSearchQuery(`*${tag}`);
  }, []);

  // useCallback：经 EmojiGridItem 传到底，身份不稳定会打破卡片 memo。
  // 成功 toast 直接用命令返回的 outcome 弹（不依赖 image-copied 事件链路——
  // 事件监听在长 dev 会话的 HMR 残留下可能失效，曾导致复制无任何反馈）；
  // 事件监听器侧凭 localCopyToastRef 标记跳过同一次复制，避免双弹。
  const handleCopy = useCallback(async (items: IndexedImage[]) => {
    if (items.length !== 1) return;
    const item = items[0];
    localCopyToastRef.current = { path: item.path, at: Date.now() };
    try {
      const outcome = await copyImageToClipboard(item.path);
      dispatchToast(
        <Toast>
          <ToastTitle>已复制 {item.name}</ToastTitle>
          <ToastBody>{outcome.message}</ToastBody>
        </Toast>,
        { intent: "success" },
      );
    } catch (e) {
      notifyError(`复制失败：${getErrorMessage(e)}`);
    }
  }, [dispatchToast, notifyError]);

  async function handleShowInExplorer(items: IndexedImage[]) {
    if (items.length !== 1) return;
    try {
      await showInExplorer(items[0].path);
    } catch (e) {
      notifyError(`查看文件位置失败：${getErrorMessage(e)}`);
    }
  }

  // ===== Ctrl+A 全选 / Delete 批量回收站（latest-ref，keydown effect deps 保持 []）=====
  keyShortcutRef.current = (event) => {
    // 模态弹窗打开时豁免，避免在弹窗内误触发批量操作。
    const dialogOpen =
      groupDialogOpen || moveToGroupState !== null || tagPickerState !== null || settingsOpen ||
      iconPickerGroup !== null || previewItem !== null || confirmState !== null ||
      renameGroupState !== null || renameEmojiState !== null || batchRenameState !== null ||
      closeDialogOpen;
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
            // 回收站视图隐藏「导入」按钮（与网格卡片在回收站隐藏复制/星标同范式）。
            showImport={currentView !== "trash"}
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
            groupsCollapsed={sidebarGroupsCollapsed}
            currentView={currentView}
            allCount={allCount}
            favoriteCount={favoriteCount}
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
            onRenameGroup={(group) => setRenameGroupState(group)}
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
                notifyError(`删除失败：${getErrorMessage(e)}`);
              }
            }}
            onTogglePinGroup={async (id, pinned) => {
              try {
                await setGroupPinned(id, pinned);
                await refreshSidebar();
              } catch (e) {
                notifyError(`置顶操作失败：${getErrorMessage(e)}`);
              }
            }}
            onToggleGroupsCollapsed={() => setSidebarGroupsCollapsed(!sidebarGroupsCollapsed)}
            onEditGroupIcon={(group) => setIconPickerGroup(group)}
          />
        }
      >
        <EmojiLibraryView
          view={currentView}
          title={currentTitle}
          allItemCount={allCount}
          items={filteredItems}
          total={viewTotal}
          hasMore={hasMore}
          onLoadMore={() => void loadMore()}
          /* 入场动画/重置 key = 落地代数：只在视图/搜索词/排序切换且新数据
             落地时变化（keep-previous，见 viewGeneration 注释）。 */
          resetKey={`${viewGeneration}`}
          ready={viewGeneration > 0}
          query={searchQuery}
          density={density}
          sortOption={sortOption}
          selectedIds={selectedIds}
          favoriteIds={favoriteIds}
          multiSelectMode={multiSelectMode}
          allSelected={allSelected}
          onToggleSelectAll={handleToggleSelectAll}
          dragActive={dragActive}
          importing={isImporting}
          tagsByPath={tagsByPath}
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
          onOpenPreview={setPreviewItem}
          onTagClick={handleTagClick}
          onMoveToGroup={handleMoveToGroup}
          onRemoveFromGroup={handleRemoveFromGroup}
          onAddTags={handleAddTags}
          onRename={handleRenameEmoji}
          onBatchRename={handleBatchRename}
          onShowInExplorer={handleShowInExplorer}
          onDelete={handleDelete}
          onRestore={handleRestore}
          onPermanentlyDelete={handlePermanentlyDelete}
        />
      </AppShell>

      <EmojiPreviewDialog
        open={previewItem !== null}
        item={previewItem}
        favorite={previewItem !== null && favoriteIds.has(previewItem.id)}
        groupNames={previewMeta.groupNames}
        tagNames={previewMeta.tagNames}
        readOnly={currentView === "trash"}
        onOpenChange={(open) => {
          if (!open) setPreviewItem(null);
        }}
        onCopy={(item) => void handleCopy([item])}
        onToggleFavorite={(item) => toggleFavorite([item])}
      />

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
        onNotifyError={notifyError}
        ocrBackfill={ocrBackfill}
        onUpdateAvailable={(result) => {
          setUpdateAvailable(result);
          // 打开更新弹窗前先收起设置弹窗（两个 alert 弹窗互斥，背板互相遮挡）。
          setSettingsOpen(false);
          setUpdateDialogOpen(true);
        }}
      />
      <CloseActionDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        onDecide={handleCloseDecide}
      />
      {/* 应用内更新唯一界面：启动发现新版本自动弹出；设置→关于「检查更新」也打开它。
          常挂载 + open 控制。open 只由 updateDialogOpen 驱动（updateAvailable 仅是
          数据）；设置弹窗打开时强制让位，否则 alert 背板盖住设置弹窗挡掉一切点击。 */}
      <UpdateAvailableDialog
        open={updateDialogOpen && !settingsOpen}
        result={updateAvailable}
        onOpenChange={(next) => {
          setUpdateDialogOpen(next);
          if (!next) setUpdateAvailable(null);
        }}
        onNotifyError={notifyError}
      />
      <Toaster toasterId={toasterId} position="top-end" />

      {/* 常挂载 + open 控制（勿改回 {state && …} 条件挂载——会瞬间卸载、截断 Dialog 内置退场动画）。 */}
      <GroupDialogLite
        open={groupDialogOpen}
        busy={groupDialogBusy}
        onOpenChange={setGroupDialogOpen}
        onSubmit={async (name, icon) => {
            setGroupDialogBusy(true);
            try {
              const group = await createGroup(name);
              if (icon) await setGroupIcon(group.id, icon);
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

      <GroupIconPickerDialog
        open={iconPickerGroup !== null}
        groupName={iconPickerGroup?.name ?? ""}
        currentIcon={iconPickerGroup?.icon ?? null}
        onOpenChange={(open) => {
          if (!open) setIconPickerGroup(null);
        }}
        onSelect={async (icon) => {
          if (!iconPickerGroup) return;
          await setGroupIcon(iconPickerGroup.id, icon);
          await refreshSidebar();
          dispatchToast(
            <Toast>
              <ToastTitle>{icon === null ? "已恢复默认图标" : "分组图标已更新"}</ToastTitle>
            </Toast>,
            { intent: "success" },
          );
        }}
      />

      <GroupDialog
        open={renameGroupState !== null}
        mode="rename"
        initialName={renameGroupState?.name ?? ""}
        busy={renameGroupBusy}
        onOpenChange={(open) => {
          if (!open) setRenameGroupState(null);
        }}
        onSubmit={async (name) => {
          if (!renameGroupState) return;
          setRenameGroupBusy(true);
            try {
              await renameGroup(renameGroupState.id, name);
              await refreshSidebar();
              setRenameGroupState(null);
              dispatchToast(
                <Toast>
                  <ToastTitle>分组已重命名</ToastTitle>
                </Toast>,
                { intent: "success" },
              );
            } finally {
              // 失败时错误由 GroupDialog 的 handleSubmit 捕获并内联显示。
              setRenameGroupBusy(false);
            }
          }}
      />

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        confirmText={confirmState?.confirmText}
        destructive={confirmState?.destructive}
        onOpenChange={(open) => {
          if (!open) setConfirmState(null);
        }}
        onConfirm={() => {
          const pending = confirmState;
          setConfirmState(null);
          pending?.onConfirm();
        }}
      />

      <MoveToGroupDialog
        open={moveToGroupState !== null}
        emojiCount={moveToGroupState?.emojiIds.length ?? 0}
        existingGroups={groups}
        busy={moveToGroupBusy}
        onOpenChange={(open) => {
          if (!open) setMoveToGroupState(null);
        }}
        onConfirm={handleMoveToGroupConfirm}
      />

      <TagPickerDialog
        open={tagPickerState !== null}
        emojiCount={tagPickerState?.emojiIds.length ?? 0}
        emojiIds={tagPickerState?.emojiIds ?? []}
        existingTags={tags}
        initiallySelectedTagIds={tagPickerState?.initiallySelectedTagIds ?? []}
        busy={tagPickerBusy}
        onOpenChange={(open) => {
          if (!open) setTagPickerState(null);
        }}
        onConfirm={handleTagPickerConfirm}
      />

      <RenameEmojiDialog
        open={renameEmojiState !== null}
        mode="single"
        emojiName={renameEmojiState?.name ?? ""}
        extension={renameEmojiState?.extension ?? ""}
        busy={renameEmojiBusy}
        onOpenChange={(open) => {
          if (!open) setRenameEmojiState(null);
        }}
        onSubmit={async (stem) => {
          if (!renameEmojiState) return;
          const { id, extension } = renameEmojiState;
          const ext = normalizeExtension(extension);
          const filename = ext ? `${stem}.${ext}` : stem;
          setRenameEmojiBusy(true);
          try {
            await renameEmojis([{ emojiId: id, filename }]);
            await afterRename(new Map([[id, filename]]));
            dispatchToast(
              <Toast>
                <ToastTitle>已重命名为「{filename}」</ToastTitle>
              </Toast>,
              { intent: "success" },
            );
          } finally {
            // 失败时错误由 RenameEmojiDialog 的 handleSubmit 捕获并内联显示。
            setRenameEmojiBusy(false);
          }
        }}
      />

      <RenameEmojiDialog
        open={batchRenameState !== null}
        mode="batch"
        batchCount={batchRenameState?.length ?? 0}
        busy={renameEmojiBusy}
        onOpenChange={(open) => {
          if (!open) setBatchRenameState(null);
        }}
        onSubmit={async (template) => {
          const items = batchRenameState;
          if (!items || items.length === 0) return;
          const filenames = buildBatchFilenames(
            template,
            items.map((item) => item.extension),
          );
          const renames: RenameEntry[] = items.map((item, index) => ({
            emojiId: item.id,
            filename: filenames[index],
          }));
          setRenameEmojiBusy(true);
          try {
            await renameEmojis(renames);
            await afterRename(
              new Map(renames.map((entry) => [entry.emojiId, entry.filename])),
            );
            dispatchToast(
              <Toast>
                <ToastTitle>已重命名 {renames.length} 个表情</ToastTitle>
              </Toast>,
              { intent: "success" },
            );
          } finally {
            // 失败时错误由 RenameEmojiDialog 的 handleSubmit 捕获并内联显示。
            setRenameEmojiBusy(false);
          }
        }}
      />
    </>
  );
}

// 简化的 GroupDialog 包装（避免循环依赖）
function GroupDialogLite(props: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, icon: string | null) => Promise<void>;
}) {
  return <GroupDialog {...props} mode="create" />;
}
