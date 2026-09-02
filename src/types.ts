// 轻量图片投影：携带 id（供 load_thumbnail 按 id 取缩略图）与展示字段。
export interface IndexedImage {
  id: number;
  name: string;
  path: string;
  extension: string;
  width: number;
  height: number;
  sizeBytes: number;
  /** 添加时间（ms）。网格排序「按添加时间」用；import 汇总等构造点可省略。 */
  importedAt?: number | null;
  /** 记录最后修改时间（ms）。元数据被改动（增删改标签/分组、收藏、回收站移入/收回）时刷新；排序「按修改时间」用；缺失时退化为 importedAt。 */
  modifiedAt?: number | null;
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
  sourceType: "managed_import" | "clipboard";
  isFavorite: boolean;
  lastUsedAt: number | null;     // ms 时间戳（SQLite 主源）
  usageCount: number;
  importedAt: number | null;     // 添加时间（ms）
  modifiedAt: number | null;     // 记录最后修改时间（ms，updated_at）
  groupIds: number[];            // 关联的分组 id 列表
  tagIds: number[];              // 关联的标签 id 列表
}

export type DefaultLibraryView = "all" | "recent" | "favorites" | "trash" | "ungrouped";

export type LibraryView = DefaultLibraryView | `group:${number}`;

export type GridDensity = "compact" | "comfortable" | "large";

export type SortOption =
  | "name-asc"
  | "name-desc"
  | "format"
  | "added-time"
  | "modified-time";

export interface LibraryGroup {
  id: number;
  name: string;
  count: number;
  sortOrder: number;
  isPinned: boolean;
  /** 自定义侧栏图标名（groupIcons.ts 注册表标识），null = 默认文件夹。 */
  icon: string | null;
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
  /** 后端 `fill_relations_for_recent` 填充；recent 视图客户端精确过滤用。 */
  groupIds: number[];
  tagIds: number[];
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

/** `quick-search-opened` 事件载荷（Phase 15）。读不到选中文字时 `selectedText` 为 null。 */
export interface QuickSearchOpenedPayload {
  selectedText: string | null;
}

export interface ImportFailure {
  path: string;
  message: string;
}

// 感知重复命中：dHash 疑似同图。sourcePath 供"强制导入"重试（跳过感知去重）。
export interface PerceptualDuplicateInfo {
  sourcePath: string;
  candidateId: number;
  candidatePath: string;
  hamming: number;
}

export interface ManagedImportSummary {
  successCount: number;
  exactDuplicateCount: number;
  perceptualDuplicateCount: number;
  failedCount: number;
  elapsedMs: number;
  items: IndexedImage[];
  failures: ImportFailure[];
  perceptualDuplicates: PerceptualDuplicateInfo[];
}

// 文件夹导入汇总。groupsCreated 只包含本次真正新建的组名（复用的既有组不计入）。
export interface FolderImportSummary {
  successCount: number;
  exactDuplicateCount: number;
  perceptualDuplicateCount: number;
  failedCount: number;
  groupsCreated: string[];
  elapsedMs: number;
  items: IndexedImage[];
  failures: ImportFailure[];
  perceptualDuplicates: PerceptualDuplicateInfo[];
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

/** 服务端排序字面量（Phase 17 排序下推）：与 Rust `list_indexed_impl` 的 ORDER BY 分支一一对应。 */
export type SearchSort =
  | "recent"
  | "name-asc"
  | "name-desc"
  | "format"
  | "added-time"
  | "modified-time";

export interface SearchOptions {
  view: SearchView;
  query?: string;
  groupId?: number;
  tagIds?: number[];
  favoriteOnly?: boolean;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
}

/** 分页查询结果：当页条目 + 符合过滤条件的总数（与 items 同一搜索回退级计数）。 */
export interface SearchResult {
  items: IndexedEmoji[];
  total: number;
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

// Phase 7: auto-paste result. `kind` is lowercase to match the Rust
// `serde(rename_all = "lowercase")` enum. The frontend dispatches on
// `kind` and shows a single toast.
export type PasteResult =
  | {
      kind: "success";
      reason: string;
      processName: string | null;
      message: string;
    }
  | {
      kind: "clipboardOnly";
      reason:
        | "noTarget"
        | "targetClosed"
        | "activationFailed"
        | "inputFailed"
        | "reused"
        | "invisible"
        | string;
      processName: string | null;
      message: string;
    }
  | {
      kind: "disabled";
      reason: string;
      processName: null;
      message: string;
    };

// Phase 26: 托盘菜单动作（与 Rust `tray::TrayMenuAction` 的 kebab-case 枚举
// 一一对应；Rust 侧统一先隐藏托盘菜单再执行）。
export type TrayMenuAction = "open-main" | "open-search" | "open-settings" | "exit";

// Phase 27: 自动更新（GitHub Releases + 镜像前缀加速）。与 Rust
// `updater::UpdateCheckResult` 的 tag="status" 序列化一一对应。
export type UpdateCheckResult =
  | { status: "upToDate"; currentVersion: string }
  | {
      status: "available";
      currentVersion: string;
      latestVersion: string;
      /** 新版本更新说明（markdown，来自发布 latest.json 的 notes）。 */
      notes: string | null;
      pubDate: string | null;
      size: number | null;
      downloadUrl: string;
    }
  | { status: "noRelease"; currentVersion: string }
  | { status: "error"; message: string };

/** `update-download-progress` 事件载荷（total 来自 Content-Length，缺失为 null）。 */
export interface UpdateDownloadProgress {
  received: number;
  total: number | null;
}

export type UpdateDownloadResult =
  | { status: "completed"; version: string; sha256: string }
  | { status: "cancelled" };

/** 镜像测速结果：ok=false 时 error 说明原因，latencyMs 为 null。 */
export interface MirrorSpeedResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}
