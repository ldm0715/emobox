export interface IndexedImage {
  name: string;
  path: string;
  extension: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface ScanSummary {
  directory: string;
  indexedCount: number;
  skippedCount: number;
  unsupportedCount: number;
  elapsedMs: number;
  items: IndexedImage[];
  warnings: string[];
}

export type DefaultLibraryView = "all" | "recent" | "favorites";

export type LibraryView = DefaultLibraryView | `group:${string}`;

export type GridDensity = "compact" | "comfortable" | "large";

export type SortOption = "name-asc" | "name-desc" | "format";

export interface LibraryGroup {
  id: string;
  name: string;
  count?: number;
}


export interface RecentImageRecord {
  item: IndexedImage;
  lastUsedAt: number;
  useCount: number;
}

export interface ShortcutRegistrationStatus {
  shortcut: string | null;
  registered: boolean;
}

export interface ClipboardCopyOutcome {
  sourceFormat: string;
  clipboardFormat: string;
  animationPreserved: boolean | null;
  message: string;
}

export interface ImageCopiedEvent {
  item: IndexedImage;
  outcome: ClipboardCopyOutcome;
  recent: RecentImageRecord;
}

export interface ImportFailure {
  path: string;
  message: string;
}

export interface ManagedImportSummary {
  successCount: number;
  duplicateCount: number;
  failedCount: number;
  elapsedMs: number;
  items: IndexedImage[];
  failures: ImportFailure[];
}

export interface StorageInfo {
  assetsDirectory: string;
  emojisDirectory: string;
  thumbnailsDirectory: string;
  supportedFormats: string[];
}