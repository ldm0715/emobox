# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

表情匣 (EmoBox) — a Windows-first Tauri v2 desktop app for managing local emoji image assets and quickly searching/copying them to the clipboard. Two top-level windows: a main `main` window and a transient `quick-search` overlay. Original user images stay in place; EmoBox either indexes them (no copy) or copies them into its own app-data dir for managed storage.

## Build / lint / test commands

```powershell
npm install
npm run tauri dev          # launch app (Vite + Tauri together)
npm run build              # tsc --noEmit + vite build
npm run tauri build -- --no-bundle   # produces src-tauri/target/release/emobox.exe

# Rust toolchain (all paths relative to repo root, run with `cmd` or in pwsh)
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

There is no JS test runner. Acceptance is `npm run build` + Rust unit tests + the manual checklist in `MANUAL_ACCEPTANCE.md`.

## High-level architecture

### Frontend (`src/`, React 19 + TS + Fluent UI v9)

- `src/main.tsx` reads `getCurrentWindow().label` and mounts either `<App />` (main window) or `<QuickSearchWindow />` (overlay). The overlay is its own React tree, not a route.
- `src/App.tsx` owns the bulk of UI state. Phase 6 introduced a 2-tier data model: `currentEmojis: IndexedEmoji[]` (per-view, the data source for the grid) and `indexedEmojis: IndexedEmoji[]` (the "all" cache). A useEffect keyed on `[currentView, debouncedQuery, recentItems]` calls `searchEmojis({view, query, ...})` for non-trash/non-recent views and re-fills `currentEmojis`; the grid `viewItems` is then a thin `IndexedImage` projection of `currentEmojis`. Other state: `groups`, `tags`, `trashCount`, `favoriteIds: Set<number>` (id-based, parallel to the legacy `favorites: Set<string>` used by the existing UI), `selectedIds: Set<number>`, `searchQuery` (debounced 200ms via `useDebouncedValue`), plus `moveToGroupState` / `tagPickerState` for the two dialog flows.
- `src/components/ThemeProvider.tsx` is the *settings* context (not just theme). It persists `theme`, `sidebarCollapsed`, `defaultView`, `quickSearchShortcut`, `clipboardCollectShortcut` to `localStorage: emobox.settings` and also pushes `theme` to the native window via `getCurrentWindow().setTheme(...)`. Default shortcuts come from `src/config/shortcuts.ts`.
- `src/lib/tauri.ts` is the only place `invoke()` is called. Add new Tauri commands there with typed wrappers; do not call `invoke` directly from feature code. Phase 6 added ~20 wrappers for groups / tags / favorites / search / trash.
- `src/types.ts` is the single source of shared contracts. Phase 6 split the old `IndexedImage` (6 fields, used as scan/import intermediate) from `IndexedEmoji` (13 fields with `id`, `sourceType`, `isFavorite`, `groupIds[]`, `tagIds[]`, `lastUsedAt`, `usageCount` — the type the grid consumes). Field names use camelCase because the Rust side uses `#[serde(rename_all = "camelCase")]`.
- Feature folders: `features/import` (the single `ImportMenu` reused by toolbar + empty state), `features/library` (grid view + phase-6 dialogs `GroupDialog` / `MoveToGroupDialog` / `TagPickerDialog` + `useDebouncedValue`), `features/search` (overlay window content). Hooks live next to the components that own them.

### Backend (`src-tauri/src/`, Rust + Tauri 2)

- `lib.rs` — entry point. Wires plugins (`clipboard-manager`, `dialog`, `global-shortcut`, `log`), managed state (`ShortcutRegistry`, `DatabaseState`, `RecentImagesState`), tray setup, `on_window_event` that intercepts `CloseRequested` on both `main` and `quick-search` and hides instead of closes, and `setup` calls `ShortcutRegistry::reconcile` to `unregister_all` any stale OS-level shortcuts on startup. Only the tray `退出` menu item calls `app.exit(0)`. `invoke_handler!` registers ~36 commands (the 14 legacy + 20+ from Phase 6).
- `commands.rs` — all `#[tauri::command]` handlers, registered via `tauri::generate_handler![...]` in `lib.rs`. Long-running work is wrapped in `tauri::async_runtime::spawn_blocking`; everything else is sync. Phase 6 added: `list/create/rename/delete_group`, `list/create/rename/delete_tag`, `add/remove_emojis_to/from_group`, `add/remove_tags_to/from_emojis`, `set_emojis_favorite`, `search_emojis`, `soft_delete_to_trash`, `restore_from_trash`, `permanently_delete_emojis`, `empty_trash`, `list_deleted_emojis`, `show_in_explorer`. The trash commands return `TrashResult { succeeded, files_moved, failures }`; `search_emojis` returns `Vec<IndexedEmoji>` (with `groupIds` / `tagIds` already filled by `fill_relations`).
- `clipboard.rs` — write path: encodes PNG/JPEG/WebP via `image::load_from_memory_with_format`, GIF via `GifDecoder` (first frame only), and writes RGBA via `tauri-plugin-clipboard-manager`. Returns a `ClipboardCopyOutcome` describing source/clipboard format and animation status. Emit nothing from here; the command layer emits `image-copied`. **Phase 6 added a SQLite write**: after a successful copy, `copy_image_to_clipboard` also calls `EmojiRepository::record_image_used(id, at_ms)` so `last_used_at` / `usage_count` are kept in sync (SQLite is the new single source of truth for "recent").
- `clipboard_collect.rs` — read path: `app.clipboard().read_image()` → RGBA → `RgbaImage::from_raw` → `DynamicImage` → `AssetService::stage_dynamic_image` → `ImportService::import_dynamic_image`. Returns a `ClipboardCollectOutcome` enum (Empty / Imported / Duplicate / Failed / Unavailable) instead of `Result` so the frontend can switch on a tagged union without parsing error strings. D2 error classification is here (see invariants).
- `scanner.rs` — pure directory walker (`walkdir`) that returns `ScanSummary`; `scan_and_persist` writes the external-scan results to SQLite via `EmojiRepository::upsert_external_scan`. **Also defines `IndexedEmoji`** (13 fields including `groupIds` / `tagIds`) — the type the frontend grid consumes after a Phase 6 search.
- `thumbnail.rs` — on-demand `data:image/png;base64,...` for the frontend (no disk cache yet).
- `recent.rs` — in-memory `RecentImagesState` cache that now **mirrors** the SQLite-backed `EmojiRepository::search_recent` (50 entries). Phase 6 made SQLite the source of truth: `copy_image_to_clipboard` writes to SQLite via `record_image_used`; `get_recent_images` reads via `search_recent` + `fill_relations_for_recent`. The JSON file at `recent-images.json` is no longer written; it is imported once on first launch (`database::import_legacy_recent_if_present`) and then read-only for backwards compat.
- `tray.rs` — system tray with three fixed items: 打开主窗口 / 打开搜索浮层 / 退出.
- `quick_search.rs` — thin shell after Phase 5: only `WINDOW_LABEL`, `show_quick_search`, `hide_quick_search`, plus `normalize_shortcut` / `shortcut_parser_text` helpers. The frontend `QuickSearchWindow` drives the overlay; on open it now calls `searchEmojis({view: "search-recent", limit: 30})` and `getRecentImages`.
- `shortcut_registry.rs` — shared global-shortcut registration for multiple owners (QuickSearch, ClipboardCollect). Single `Mutex<HashMap<String, ShortcutOwner>>` plus `ShortcutSyncState` (Unknown / Synced / RecoveryRequired). `try_set` is the only mutator; it registers the new shortcut first, then unregisters the old, and sets `RecoveryRequired` if rollback also fails. Conflict detection happens at the map layer (not via plugin errors). `reconcile` is called on startup to clear stale OS-level registrations.
- `database/` — opens `emobox.sqlite3` at `app_data_dir`, runs migrations from `src-tauri/migrations/*.sql`. Exposes `connect()` for repositories. **Three migrations exist**: `0001_create_emojis.sql` (legacy 17 columns), `0002_create_groups_tags.sql` (4 new tables: `groups` / `tags` / `emoji_groups` / `emoji_tags`, all FKs with `ON DELETE CASCADE`), `0003_add_emoji_trash_columns.sql` (`emojis` + `deleted_at` / `trash_path` / `trash_thumbnail_path` + an `idx_emojis_is_deleted_deleted_at` index). `connect()` always opens a fresh connection — there is no pool.
- `repositories/emoji_repository.rs` — SQL access for the `emojis` table. Phase 6 added: `set_favorite_for_ids` (single-transaction bulk), `add_to_group` / `remove_from_group` (matrix writes), `add_tags` / `remove_tags` (matrix), `record_image_used` (last-used bump), `mark_deleted` / `set_trash_paths` / `clear_trash` / `delete_permanently` / `list_deleted_targets` (trash state machine), `list_indexed(options, query, tag_ids)` (the unified search — `query` adds an OR clause across filename / tag name / group name, `tag_ids` is an AND set, both are appended to the view filter, never replace it), `list_deleted` (uses 3-arg `COALESCE(trash_path, managed_path, source_path)` for path), `search_recent`, `fill_relations` (2-query batched `emoji_groups` + `emoji_tags` lookup — never N+1), and `get_relations_for_ids` (the underlying helper).
- `repositories/group_repository.rs` — CRUD for `groups` plus a `list_groups` that includes a per-group emoji count via a subquery. Names are `COLLATE NOCASE` unique.
- `repositories/tag_repository.rs` — same shape as groups, but for `tags`. Names are also `COLLATE NOCASE` unique.
- `services/` — `asset_service` (open-in-explorer, temp file + atomic rename, `encode_image_as_png` is the **only** PNG encode point in the codebase, `stage_file` and `stage_dynamic_image` for the two import paths), `import_service` (`commit_staged` helper shared by `import_one` and `import_dynamic_image`; `static IMPORT_LOCK: Mutex<()>` serializes all writes; `find_managed_by_sha256` for dedup; rollback on DB failure), and **`trash_service`** (the only service Phase 6 added). `trash_service` is the FS↔DB orchestrator for `soft_delete` / `restore` / `permanently_delete` / `empty_trash`. It enforces the **"move file first, then write DB"** invariant: it tries `fs::rename` (with `fs::copy + fs::remove_file` fallback for cross-volume) for the main file, only the thumbnail on success, then a single DB transaction. A main-file failure rolls the row back to `is_deleted = 0`. Group / Tag CRUD stays in their repositories — no service layer needed.

## Three import modes (load-bearing distinction)

| Mode | Tauri command | What it does | Persisted? |
|---|---|---|---|
| **Import folder (index external)** | `scan_directory` (`scanner::scan_and_persist`) | Recursive `walkdir`; entries written to `emojis` with `source_type='external_directory'`; original files untouched | Yes (SQLite), but path-based — moved/renamed source files become stale |
| **Import images / drop (managed copy)** | `import_managed_paths` (`import_service`) | Copies selected files into `app_data_dir/assets/emojis/`, writes thumbnail, stores `managed_path` + `sha256` for dedup | Yes (SQLite + filesystem) |
| **Clipboard collect (managed copy, user-triggered)** | `collect_image_from_clipboard` (`clipboard_collect`) | Reads RGBA from `read_image()`, re-encodes via `stage_dynamic_image`, dedup by SHA-256, stores with `source_type='clipboard'`. Triggered by `Ctrl+Alt+S` or the menu | Yes (SQLite + filesystem) |
| **Read-back** | `get_indexed_images` | `EmojiRepository::list_available` returning only `is_deleted=0` rows, mapped to `IndexedImage` | n/a |

`EmojiLibraryView` consumes `currentEmojis: IndexedEmoji[]` (per-view, set by `App.tsx` after a `searchEmojis` call) and projects it to `IndexedImage` for the grid. A per-view useEffect in `App.tsx` selects the right backend endpoint: `search_emojis` for the four list views (`all` / `favorites` / `ungrouped` / `group:N`), `list_deleted_emojis` for `trash`, and the local `recentItems` for `recent` (filtered client-side because `RecentImageRecord` is the only place that still carries a 6-field `IndexedImage`). The grid `viewItems` is then a thin `IndexedImage` projection of `currentEmojis` — the UI must not assume the recent list is a subset of the indexed list because a recent image can still be copied even if the user has not re-imported its directory this session.

## Quick-search overlay

- `src/features/search/QuickSearchWindow.tsx` listens for the `quick-search-opened` event (emitted by `quick_search::show_quick_search` in Rust) and reloads both `getIndexedImages` and `getRecentImages` on each open. Empty query shows recent items first, then fills with the current memory index.
- Enter / mouse click triggers `copyImageToClipboard` (the Rust command), toasts on success/failure, and auto-hides the overlay ~500 ms after a successful copy. On failure, the overlay stays open and the error is shown inline.
- The default global shortcut is `Ctrl+Alt+Space` (not `Alt+Space`, which Windows reserves for the system window menu). `src/config/shortcuts.ts` exports both constants and the `shortcutFromKeyboardEvent` helper used by `ShortcutEditor`.

## Key invariants / hard rules

- Original user images are never copied, moved, renamed, or deleted by EmoBox, *except* by `import_managed_paths` and `import_dynamic_image` (clipboard collect) which deliberately copy into the managed assets directory, and **`trash_service::soft_delete` / `restore` / `permanently_delete` / `empty_trash` which move files in and out of `app_data_dir/trash/`**. Don't add any other path that mutates user files.
- The main window and quick-search window both intercept `CloseRequested` and hide. Only the tray `退出` menu calls `app.exit(0)`.
- `copy_image_to_clipboard` writes a `tauri::Image` (RGBA) via the clipboard plugin, not a file path / `file://` / text. WebP is converted to a static image; GIF is reduced to its first frame and the outcome's `animationPreserved` is set to `Some(false)`. The same command then calls `EmojiRepository::record_image_used` to keep SQLite in sync.
- **Trash (Phase 6)**: `soft_delete` and `restore` follow **"move file first, then write DB"**. Main file is moved with `fs::rename` (falling back to `fs::copy + fs::remove_file` cross-volume); the thumbnail is moved only on main-file success; the DB transaction writes `is_deleted = 1` and the trash paths only after both file moves land. A main-file failure rolls the row's `is_deleted` back to `0` and leaves the original file in place. The thumbnail move failing is non-fatal (logged + recorded in `TrashFailure`); the main-file move is fatal for that row. `external_directory` rows skip the file stage entirely — they only flip the DB flag.
- **CASCADE behaviour (Phase 6)**: `ON DELETE CASCADE` on `emoji_groups` / `emoji_tags` fires only on physical `DELETE FROM emojis`. `UPDATE emojis SET is_deleted = 1` is **soft delete** and does *not* fire CASCADE — soft-deleted rows keep their group / tag associations and resume them on restore. Only `permanently_delete` and `empty_trash` issue the hard `DELETE`, which cascades and clears associations atomically.
- **Path semantics (Phase 6)**: `IndexedEmoji.path` is a SQL `COALESCE` projection. For `list_indexed` / `search` it is `COALESCE(managed_path, source_path)` (2-arg); for `list_deleted` it is `COALESCE(trash_path, managed_path, source_path)` (3-arg, with `trash_path` taking priority). The frontend grid reads `path` directly and never assembles it itself.
- Recent list: max 50 entries, deduped by `path`, sorted by `lastUsedAt` desc. **SQLite is the source of truth since Phase 6** — `last_used_at` / `usage_count` live on `emojis`, `RecentImagesState` is an in-memory cache, the JSON file at `recent-images.json` is import-only.
- All UI state that should persist across restarts goes through `ThemeProvider` / `localStorage: emobox.settings` (theme, sidebar collapse, default view, two global shortcuts). Don't introduce other persistence backends. (Group / tag / favorite state does **not** go here — it lives in SQLite via the Phase-6 commands.)
- The Rust side persists emoji metadata in SQLite (`emobox.sqlite3` at `app_data_dir`). No cloud, no accounts, no network sync.
- Supported image extensions: `png`, `jpg`, `jpeg`, `gif`, `webp`. Centralize checks in `scanner::supported_extension` (Rust) and `imageFilters` in `useLibraryImport.ts` (TS).
- Unimplemented features must be visibly `disabled` in the UI and not silently fake success. See `ImportMenu.tsx` for the pattern.
- Rust unit tests live in `#[cfg(test)]` modules (e.g. `asset_service.rs`, `import_service.rs`, `scanner.rs`, `recent.rs`, `clipboard.rs`, `shortcut_registry.rs`, `repositories/emoji_repository.rs`, `repositories/group_repository.rs`, `repositories/tag_repository.rs`, `services/trash_service.rs`). No JS test suite; `npm run build` is the only TS-level check.

### PNG encoding is deterministic — load-bearing for clipboard dedup

`AssetService::encode_image_as_png` uses `PngEncoder::new_with_quality(CompressionType::Default, FilterType::Adaptive)` with `ExtendedColorType::Rgba8` — the **only** PNG encode point in the codebase. Same RGBA input always produces byte-identical output and the same SHA-256, locked by `deterministic_png_encoding_produces_identical_bytes_and_hash`. Without this guarantee, repeated clipboard collects of the same image would fail SHA-256 dedup and create duplicate files.

### D2 — clipboard error classification is via arboard error text

`tauri-plugin-clipboard-manager` flattens arboard's typed errors to `String`, so we can't use `match` on the error variant. `clipboard_collect.rs` matches two substrings to map "no image in clipboard" to the `Empty` outcome (info toast "剪贴板中没有图片"):

- `"clipboard is empty"` — truly empty clipboard
- `"not available in the requested format"` — clipboard has text or other non-image format

Anything else goes to `Unavailable` (red error toast). This relies on the arboard 0.x Windows error text; upgrade may require re-verifying. See `docs/phase5-clipboard-probe-results.md` for the decision record.

### `IMPORT_LOCK` serializes all writes

`import_service.rs` holds `static IMPORT_LOCK: Mutex<()>` and acquires it at the top of `import_paths` and `import_dynamic_image`. Concurrent collect-from-clipboard (e.g. rapid `Ctrl+Alt+S` presses) will queue; the second one finds the first's staged asset by SHA-256 and returns `Duplicate` (info toast, not error). Don't add another write path that bypasses this lock.

### `ShortcutRegistry` state machine

`Unknown` (just after process start) → `reconcile` is called in `lib.rs::setup` and unregisters all stale OS-level shortcuts, then sets `Synced`. Every `try_set` ends in `Synced` on success or `RecoveryRequired` on rollback failure. The frontend reads `sync_state` indirectly via the `registered` field of `get_*_shortcut_status`; a `RecoveryRequired` event flows back as a `SetOutcome::Failed { requires_recovery: true }` and should be surfaced to the user (e.g. banner) so they restart or re-record.

### `search_emojis` placeholder substitution

`list_indexed(options, query, tag_ids)` builds the SQL once with literal `?Q` (query) and `?T0..T(N-1)` (per-tag) placeholders, computes the **actual parameter index** for each placeholder as `view_clause_count + 1 (+ 1 if query) (+ i if tags)`, then `String::replace`s the placeholder tokens with `?<index>` before `prepare`. The view filter (`build_view_filter`) uses the `e` table alias — every fragment must reference `e.xxx`, never `emojis.xxx`, or the prepare will fail with `no such column: emojis.id`. Placeholders in `?L` / `?O` are **not** used; limit and offset are always bound at the very end (`params.len() - tag_ids.len() - has_query` is the view string, then limit, then offset).

## Where to look

- New Tauri command? Add wrapper in `src/lib/tauri.ts`, types in `src/types.ts`, handler in `src-tauri/src/commands.rs`, register in `src-tauri/src/lib.rs::invoke_handler`. Long-running work goes through `tauri::async_runtime::spawn_blocking`. The matching repository method should land in `repositories/{emoji,group,tag}_repository.rs` (or a service in `services/` only if the operation crosses the FS boundary — see `trash_service`).
- New global shortcut? Add a new `ShortcutOwner` variant in `shortcut_registry.rs`; the registry handles conflict detection. Frontend adds a `ShortcutterEditor` row in `SettingsMenu.tsx`; no new Rust command needed unless the user can configure it.
- New setting? Extend `PersistedSettings` in `ThemeProvider.tsx`; persistence to `localStorage: emobox.settings` is automatic.
- New view in the sidebar? Add the new value to `viewTitles` in `App.tsx` (and `SettingsMenu.tsx` for the default-view dropdown), extend the `LibraryView` union in `types.ts`, and add a branch to the per-view useEffect in `App.tsx` that calls the matching backend command. Use `searchEmojis({view: "..."})` for new list views; reserved views are `all` / `favorites` / `ungrouped` / `group` / `search-recent` / `trash` — the SQL is built by `build_view_filter`.
- New group / tag / favorite operation? CRUD lives in `group_repository.rs` / `tag_repository.rs`; associations in `EmojiRepository::add_to_group` / `remove_from_group` / `add_tags` / `remove_tags`; the bulk favorite is `EmojiRepository::set_favorite_for_ids` (single transaction, no N+1).
- New trash operation? Route through `trash_service` — never modify files outside that module. Update `trash_service::TrashResult` consumers (the Tauri command) and the dialogs (`TrashDeleteDialog` / `TrashPanel`).
- New clipboard *write* behavior? `clipboard.rs` is the boundary. Don't forget the `record_image_used` writeback so the SQLite `last_used_at` / `usage_count` stay current.
- New clipboard *read* behavior? `clipboard_collect.rs` is the boundary; RGBA must go through `AssetService::stage_dynamic_image` to keep PNG encoding deterministic.
- New search behavior? The unified path is `EmojiRepository::list_indexed(options, query, tag_ids)` — never write a parallel SQL string elsewhere. The placeholder-substitution trick for `?Q` / `?T<i>` is the one place that does this; replicate the pattern in the new method if you add one.
- Implementation history and per-stage design notes: `docs/implementation-plan.md`, `docs/windows-image-clipboard.md`, `docs/system-tray-recent-usage.md`, `docs/search-overlay-global-shortcut.md`, `docs/phase5-clipboard-probe-results.md`, `docs/phase6-groups-tags-trash.md`. README has product-level overview; AGENTS.md has repo conventions.
