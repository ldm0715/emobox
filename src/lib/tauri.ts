import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  ClipboardCopyOutcome,
  FolderImportSummary,
  IndexedEmoji,
  IndexedImage,
  LibraryGroup,
  ManagedImportSummary,
  PasteResult,
  RecentImageRecord,
  SearchOptions,
  ShortcutRegistrationStatus,
  StorageInfo,
  Tag,
  TrashResult,
} from "../types";

export function importFolder(
  path: string,
  skipPerceptualDedup = false,
): Promise<FolderImportSummary> {
  return invoke<FolderImportSummary>("import_folder", {
    path,
    skipPerceptualDedup,
  });
}

export function importManagedPaths(
  paths: string[],
  skipPerceptualDedup = false,
): Promise<ManagedImportSummary> {
  return invoke<ManagedImportSummary>("import_managed_paths", {
    paths,
    skipPerceptualDedup,
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
): Promise<ClipboardCollectOutcome> {
  return invoke<ClipboardCollectOutcome>("collect_image_from_clipboard", {
    skipPerceptualDedup,
    downloadWebGif,
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

export function searchEmojis(options: SearchOptions): Promise<IndexedEmoji[]> {
  return invoke<IndexedEmoji[]>("search_emojis", { options });
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

export function listDeletedEmojis(): Promise<IndexedEmoji[]> {
  return invoke<IndexedEmoji[]>("list_deleted_emojis");
}

export function showInExplorer(path: string): Promise<void> {
  return invoke<void>("show_in_explorer", { path });
}

// ---------- Phase 7: 自动粘贴 ----------

export function pasteToTargetWindow(): Promise<PasteResult> {
  return invoke<PasteResult>("paste_to_target_window");
}
