// 扫描器/导入中间结果的 6 字段版本（未入库的）。
export interface IndexedImage {
  name: string;
  path: string;
  extension: string;
  width: number;
  height: number;
  sizeBytes: number;
}

// 已落库的完整表情：携带 id / 收藏 / 使用 / 关联。search/list 全部返回这一种。
export interface IndexedEmoji {
  id: number;
  name: string;
  path: string;                  // 当前可读路径（COALESCE 投影）
  thumbnailPath: string | null;  // 当前有效缩略图路径
  extension: string;
  width: number;
  height: number;
  sizeBytes: number;
  sourceType: "external_directory" | "managed_import" | "clipboard";
  isFavorite: boolean;
  lastUsedAt: number | null;     // ms 时间戳（SQLite 主源）
  usageCount: number;
  groupIds: number[];            // 关联的分组 id 列表
  tagIds: number[];              // 关联的标签 id 列表
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

export type DefaultLibraryView = "all" | "recent" | "favorites" | "trash" | "ungrouped";

export type LibraryView = DefaultLibraryView | `group:${number}`;

export type GridDensity = "compact" | "comfortable" | "large";

export type SortOption = "name-asc" | "name-desc" | "format";

export interface LibraryGroup {
  id: number;
  name: string;
  count: number;
  sortOrder: number;
}

export interface Tag {
  id: number;
  name: string;
  count: number;
}

export interface EmojiRelations {
  groupIds: number[];
  tagIds: number[];
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

// 第六阶段新增

export type SearchView =
  | "all"
  | "favorites"
  | "group"
  | "ungrouped"
  | "search-recent"
  | "trash";

export interface SearchOptions {
  view: SearchView;
  query?: string;
  groupId?: number;
  tagIds?: number[];
  favoriteOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface TrashFailure {
  id: number;
  reason: string;
}

export interface TrashResult {
  succeeded: number;
  filesMoved: number;
  failures: TrashFailure[];
}
