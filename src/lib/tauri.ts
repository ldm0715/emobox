import { invoke } from "@tauri-apps/api/core";
import type { IndexedImage, ScanSummary, ShortcutRegistrationStatus } from "../types";

export function scanDirectory(path: string): Promise<ScanSummary> {
  return invoke<ScanSummary>("scan_directory", { path });
}

export function loadThumbnail(path: string, maxSize = 240): Promise<string> {
  return invoke<string>("load_thumbnail", { path, maxSize });
}

export function getIndexedImages(): Promise<IndexedImage[]> {
  return invoke<IndexedImage[]>("get_indexed_images");
}

export function updateQuickSearchShortcut(shortcut: string): Promise<ShortcutRegistrationStatus> {
  return invoke<ShortcutRegistrationStatus>("update_quick_search_shortcut", { shortcut });
}

export function getQuickSearchShortcutStatus(): Promise<ShortcutRegistrationStatus> {
  return invoke<ShortcutRegistrationStatus>("get_quick_search_shortcut_status");
}

export function showQuickSearch(): Promise<void> {
  return invoke<void>("show_quick_search");
}

export function hideQuickSearch(): Promise<void> {
  return invoke<void>("hide_quick_search");
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "发生未知错误。";
}
