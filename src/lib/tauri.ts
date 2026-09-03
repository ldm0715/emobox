import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  ClipboardCopyOutcome,
  EmojiTags,
  FolderImportSummary,
  IndexedEmoji,
  IndexedImage,
  LibraryGroup,
  ManagedImportSummary,
  MirrorSpeedResult,
  OcrCapabilities,
  OcrEngineKind,
  PasteResult,
  RecentImageRecord,
  RenameEntry,
  SearchOptions,
  SearchResult,
  ShortcutRegistrationStatus,
  StorageInfo,
  Tag,
  TrashResult,
  TrayMenuAction,
  UpdateCheckResult,
  UpdateDownloadResult,
} from "../types";

export function importFolder(
  path: string,
  skipPerceptualDedup = false,
  targetGroupId?: number,
): Promise<FolderImportSummary> {
  return invoke<FolderImportSummary>("import_folder", {
    path,
    skipPerceptualDedup,
    // Phase 22：分组视图内导入时目标分组 id（undefined/null → 不指定）。
    targetGroupId: targetGroupId ?? null,
  });
}

export function importManagedPaths(
  paths: string[],
  skipPerceptualDedup = false,
  targetGroupId?: number,
): Promise<ManagedImportSummary> {
  return invoke<ManagedImportSummary>("import_managed_paths", {
    paths,
    skipPerceptualDedup,
    targetGroupId: targetGroupId ?? null,
  });
}

export function loadThumbnail(emojiId: number, maxSize = 240): Promise<string> {
  return invoke<string>("load_thumbnail", { emojiId, maxSize });
}

/** 受管文件 → asset 协议 URL（tauri.conf.json assetProtocol scope 内可读）。 */
export function emojiAssetUrl(path: string): string {
  return convertFileSrc(path);
}

export function getStorageInfo(): Promise<StorageInfo> {
  return invoke<StorageInfo>("get_storage_info");
}

export function openAssetsDirectory(): Promise<void> {
  return invoke<void>("open_assets_directory");
}

/** 打开外部 https 链接（Rust 侧有 https + 主机白名单校验）。 */
export function openExternalUrl(url: string): Promise<void> {
  return invoke<void>("open_external_url", { url });
}

/** 推送主窗口关闭行为到 Rust 内存镜像（null = 未选择，点关闭时前端弹询问窗）。 */
export function setCloseToTray(minimizeToTray: boolean | null): Promise<void> {
  return invoke<void>("set_close_to_tray", { minimizeToTray });
}

/** 退出整个应用（与托盘「退出」同语义）。 */
export function exitApplication(): Promise<void> {
  return invoke<void>("exit_application");
}

/** 托盘菜单项动作（Phase 26）：Rust 侧统一先隐藏托盘菜单再执行。 */
export function trayMenuAction(action: TrayMenuAction): Promise<void> {
  return invoke<void>("tray_menu_action", { action });
}

export function copyImageToClipboard(path: string): Promise<ClipboardCopyOutcome> {
  return invoke<ClipboardCopyOutcome>("copy_image_to_clipboard", { path });
}

export function getRecentImages(): Promise<RecentImageRecord[]> {
  return invoke<RecentImageRecord[]>("get_recent_images");
}

export function showQuickSearch(): Promise<void> {
  return invoke<void>("show_quick_search");
}

export function hideQuickSearch(): Promise<void> {
  return invoke<void>("hide_quick_search");
}

// ---------- Phase 15: 选中文字自动搜索 ----------

/** 把「选中文字自动搜索」开关推送到 Rust（localStorage 是事实源，Rust 只做内存镜像）。 */
export function setSelectionSearchEnabled(enabled: boolean): Promise<void> {
  return invoke<void>("set_selection_search_enabled", { enabled });
}

// ---------- 剪贴板收藏 ----------

export type ClipboardCollectOutcome =
  | { kind: "empty"; message: string }
  | { kind: "imported"; summary: ManagedImportSummary; message: string }
  | { kind: "duplicate"; summary: ManagedImportSummary; message: string }
  | {
      kind: "failed";
      summary: ManagedImportSummary | null;
      message: string;
      reason: string;
    }
  | { kind: "unavailable"; reason: string; message: string };

export function collectImageFromClipboard(
  skipPerceptualDedup = false,
  downloadWebGif = false,
  targetGroupId?: number,
): Promise<ClipboardCollectOutcome> {
  return invoke<ClipboardCollectOutcome>("collect_image_from_clipboard", {
    skipPerceptualDedup,
    downloadWebGif,
    targetGroupId: targetGroupId ?? null,
  });
}

export type SetOutcome =
  | { kind: "unchanged" }
  | { kind: "registered"; display: string }
  | { kind: "conflict"; otherOwner: "quickSearch" | "clipboardCollect" }
  | { kind: "failed"; reason: string; requiresRecovery: boolean };

export function updateQuickSearchShortcut(
  shortcut: string,
): Promise<SetOutcome> {
  return invoke<SetOutcome>("update_quick_search_shortcut", { shortcut });
}

export function getQuickSearchShortcutStatus(): Promise<ShortcutRegistrationStatus> {
  return invoke<ShortcutRegistrationStatus>("get_quick_search_shortcut_status");
}

export function updateClipboardCollectShortcut(
  shortcut: string,
): Promise<SetOutcome> {
  return invoke<SetOutcome>("update_clipboard_collect_shortcut", { shortcut });
}

export function getClipboardCollectShortcutStatus(): Promise<ShortcutRegistrationStatus> {
  return invoke<ShortcutRegistrationStatus>(
    "get_clipboard_collect_shortcut_status",
  );
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "发生未知错误。";
}

// ---------- 第六阶段：分组 / 标签 / 收藏 / 搜索 / 回收站 ----------

export function listGroups(): Promise<LibraryGroup[]> {
  return invoke<LibraryGroup[]>("list_groups");
}

export function createGroup(name: string): Promise<LibraryGroup> {
  return invoke<LibraryGroup>("create_group", { name });
}

export function renameGroup(id: number, name: string): Promise<LibraryGroup> {
  return invoke<LibraryGroup>("rename_group", { id, name });
}

export function deleteGroup(id: number): Promise<void> {
  return invoke<void>("delete_group", { id });
}

export function setGroupPinned(id: number, pinned: boolean): Promise<void> {
  return invoke<void>("set_group_pinned", { id, pinned });
}

export function setGroupIcon(id: number, icon: string | null): Promise<void> {
  return invoke<void>("set_group_icon", { id, icon });
}

export function listTags(): Promise<Tag[]> {
  return invoke<Tag[]>("list_tags");
}

export function createTag(name: string): Promise<Tag> {
  return invoke<Tag>("create_tag", { name });
}

export function renameTag(id: number, name: string): Promise<Tag> {
  return invoke<Tag>("rename_tag", { id, name });
}

export function deleteTag(id: number): Promise<void> {
  return invoke<void>("delete_tag", { id });
}

export function addEmojisToGroup(
  groupId: number,
  emojiIds: number[],
): Promise<void> {
  return invoke<void>("add_emojis_to_group", { groupId, emojiIds });
}

export function removeEmojisFromGroup(
  groupId: number,
  emojiIds: number[],
): Promise<void> {
  return invoke<void>("remove_emojis_from_group", { groupId, emojiIds });
}

export function addTagsToEmojis(
  tagIds: number[],
  emojiIds: number[],
): Promise<void> {
  return invoke<void>("add_tags_to_emojis", { tagIds, emojiIds });
}

export function removeTagsFromEmojis(
  tagIds: number[],
  emojiIds: number[],
): Promise<void> {
  return invoke<void>("remove_tags_from_emojis", { tagIds, emojiIds });
}

export function setEmojisFavorite(
  ids: number[],
  isFavorite: boolean,
): Promise<void> {
  return invoke<void>("set_emojis_favorite", { ids, isFavorite });
}

/** 批量重命名显示名（单张传一条）。只写 SQLite，不动磁盘文件；
 * 文件名标签同步在 Rust 侧完成。 */
export function renameEmojis(renames: RenameEntry[]): Promise<void> {
  return invoke<void>("rename_emojis", { renames });
}

export function searchEmojis(options: SearchOptions): Promise<SearchResult> {
  return invoke<SearchResult>("search_emojis", { options });
}

export function softDeleteToTrash(ids: number[]): Promise<TrashResult> {
  return invoke<TrashResult>("soft_delete_to_trash", { ids });
}

export function restoreFromTrash(ids: number[]): Promise<TrashResult> {
  return invoke<TrashResult>("restore_from_trash", { ids });
}

export function permanentlyDeleteEmojis(ids: number[]): Promise<TrashResult> {
  return invoke<TrashResult>("permanently_delete_emojis", { ids });
}

export function emptyTrash(): Promise<TrashResult> {
  return invoke<TrashResult>("empty_trash");
}

export function listDeletedEmojis(options?: {
  limit?: number;
  offset?: number;
}): Promise<SearchResult> {
  return invoke<SearchResult>("list_deleted_emojis", options);
}

export function showInExplorer(path: string): Promise<void> {
  return invoke<void>("show_in_explorer", { path });
}

// ---------- Phase 7: 自动粘贴 ----------

export function pasteToTargetWindow(): Promise<PasteResult> {
  return invoke<PasteResult>("paste_to_target_window");
}

// ---------- Phase 27: 自动更新（GitHub Releases + 镜像前缀加速） ----------

/** 下载进度事件（emit_to main）：received 已下载字节，total 缺失时进度条走不确定态。 */
export const UPDATE_DOWNLOAD_PROGRESS_EVENT = "update-download-progress";

/** 检查更新：mirrors 为用户镜像列表（依序尝试），Rust 侧末尾恒加官方直连兜底。 */
export function checkForUpdate(mirrors: string[]): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>("check_for_update", { mirrors });
}

/** 下载安装包到临时目录并做 SHA-256 校验；进度经 UPDATE_DOWNLOAD_PROGRESS_EVENT 推送。 */
export function startUpdateDownload(mirrors: string[]): Promise<UpdateDownloadResult> {
  return invoke<UpdateDownloadResult>("start_update_download", { mirrors });
}

export function cancelUpdateDownload(): Promise<void> {
  return invoke<void>("cancel_update_download");
}

/** 启动已下载并通过校验的 NSIS 安装器，随后应用退出。 */
export function installPendingUpdate(): Promise<void> {
  return invoke<void>("install_pending_update");
}

/** 单个镜像测速（经镜像拉取仓库 README 小文件计耗时，Rust 侧只读）。 */
export function testMirrorSpeed(mirror: string): Promise<MirrorSpeedResult> {
  return invoke<MirrorSpeedResult>("test_mirror_speed", { mirror });
}

// ---------- Phase 32: OCR 识图自动打标签 ----------

/** 主窗口事件：一批 OCR 识别有进展（每 10 张 + 批末），主窗口据此刷新标签。 */
export const OCR_TAGS_UPDATED_EVENT = "ocr-tags-updated";

/** 把 OCR 设置推送到 Rust 内存镜像（localStorage 是事实源，Rust 只做镜像，两个窗口都推、幂等）。 */
export function setOcrConfig(config: {
  engine: OcrEngineKind;
  aiStudioApiUrl: string;
  aiStudioToken: string;
  aiStudioModel: string;
  tesseractPath: string;
}): Promise<void> {
  return invoke<void>("set_ocr_config", config);
}

/** 各引擎可用性：Windows OCR 走 WinRT 探测、Tesseract 走进程探测（都在后台线程跑）。 */
export function getOcrCapabilities(): Promise<OcrCapabilities> {
  return invoke<OcrCapabilities>("get_ocr_capabilities");
}

/** 触发存量回填，返回本次待识别数量；识别在后台进行，进度经 OCR_TAGS_UPDATED_EVENT 推送。 */
export function backfillOcrTags(): Promise<number> {
  return invoke<number>("backfill_ocr_tags");
}

/** Phase 33：对指定表情手动重跑 OCR（force：已有结果覆盖 ocr_text、标签只增不删）。返回排队数量，0 = 全部无效/已删除。 */
export function ocrRecognizeEmojis(emojiIds: number[]): Promise<number> {
  return invoke<number>("ocr_recognize_emojis", { emojiIds });
}

/** Phase 33：读取指定表情当前的标签 id 集合（手动识别批末同步弹窗选中集用）。 */
export function getEmojiTags(emojiIds: number[]): Promise<EmojiTags[]> {
  return invoke<EmojiTags[]>("get_emoji_tags", { emojiIds });
}
