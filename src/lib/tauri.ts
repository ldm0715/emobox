import { invoke } from "@tauri-apps/api/core";
import type {
  ClipboardCopyOutcome,
  IndexedImage,
  ManagedImportSummary,
  RecentImageRecord,
  ScanSummary,
  ShortcutRegistrationStatus,
  StorageInfo,
} from "../types";

export function scanDirectory(path: string): Promise<ScanSummary> {
  return invoke<ScanSummary>("scan_directory", { path });
}

export function importManagedPaths(paths: string[]): Promise<ManagedImportSummary> {
  return invoke<ManagedImportSummary>("import_managed_paths", { paths });
}

export function loadThumbnail(path: string, maxSize = 240): Promise<string> {
  return invoke<string>("load_thumbnail", { path, maxSize });
}

export function getIndexedImages(): Promise<IndexedImage[]> {
  return invoke<IndexedImage[]>("get_indexed_images");
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

export function collectImageFromClipboard(): Promise<ClipboardCollectOutcome> {
  return invoke<ClipboardCollectOutcome>("collect_image_from_clipboard");
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