# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

表情匣 (EmoBox) —— 一款 Windows 优先的 Tauri v2 桌面应用，用于管理本地表情图片素材，并快速搜索/复制到剪贴板。有两个顶层窗口：主窗口 `main` 和一个瞬态 `quick-search` 浮层。用户原始图片保持原位；EmoBox 只把"导入"的图片复制到自己的 app-data 目录做受管存储（Phase 8 起不再有"仅索引原路径"模式）。

## 构建 / 检查 / 测试命令

```powershell
npm install
npm run tauri dev          # 启动应用（Vite + Tauri 一起）
npm run build              # tsc --noEmit + vite build
npm run tauri build -- --no-bundle   # 产出 src-tauri/target/release/emobox.exe

# Rust 工具链（所有路径相对仓库根目录，用 `cmd` 或 pwsh 执行）
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# 单测（按名称子串过滤，如 sanitize_trims / same_session_reuse_via_peek）
cargo test --manifest-path src-tauri/Cargo.toml <测试名子串>

# JS 测试：全部 / 单文件 / 按用例名过滤
npx vitest run
npx vitest run src/features/library/useMultiSelection.test.ts
npx vitest run -t "<用例名>"
```

验收标准是 `cargo check` + `cargo clippy -- -D warnings` + `cargo test` + `npm run build`（tsc + vite）+ `npx vitest run`（Phase 8 起浮层 `useQuickSearchQuery` 乱序测试、Phase 9 起 `useMultiSelection` 多选测试）+ `MANUAL_ACCEPTANCE.md` 中的手动清单。

## 高层架构

### 前端（`src/`，React 19 + TS + Fluent UI v9）

- `src/main.tsx` 读取 `getCurrentWindow().label`，挂载 `<App />`（主窗口）或 `<QuickSearchWindow />`（浮层）。浮层是独立的 React 树，不是路由。
- `src/App.tsx` 持有大部分 UI 状态。Phase 6 引入两层数据模型：`currentEmojis: IndexedEmoji[]`（按视图，网格的数据源）和 `indexedEmojis: IndexedEmoji[]`（"全部"缓存）。一个以 `[currentView, debouncedQuery, recentItems]` 为 key 的 useEffect，对非回收站/非最近使用的视图调用 `searchEmojis({view, query, ...})` 并重新填充 `currentEmojis`；网格的 `viewItems` 是 `currentEmojis` 的轻量 `IndexedImage` 投影。其他状态：`groups`、`tags`、`trashCount`、`favoriteIds: Set<number>`（基于 id，与旧 UI 用的 `favorites: Set<string>` 并行）、`searchQuery`（经 `useDebouncedValue` 200ms 防抖），以及两个对话框流程的 `moveToGroupState` / `tagPickerState`。**Phase 9 多选**：`selectedIds: Set<number>` 由 `useMultiSelection(filteredItems)` 托管（网格唯一选中源，旧 `selectedPath` 已删），另有 `multiSelectMode: boolean`（显式多选开关，头部「多选」按钮触发，开启后单击切换选中；切视图经 `prevViewRef` effect 统一清选区 + 关模式）。
- `src/components/ThemeProvider.tsx` 是*设置*上下文（不只是主题）。把 `theme`、`sidebarCollapsed`、`defaultView`、`quickSearchShortcut`、`clipboardCollectShortcut`、`autoPaste`、`selectionSearch`、`downloadWebGif` 持久化到 `localStorage: emobox.settings`，并通过 `getCurrentWindow().setTheme(...)` 把 `theme` 同步给原生窗口。默认快捷键来自 `src/config/shortcuts.ts`。**Phase 15**：`selectionSearch` 在挂载和变更时经 `setSelectionSearchEnabled` 命令推送到 Rust 的 `SelectionSearchState`（内存镜像，localStorage 仍是事实源；两个窗口都推、幂等）。**Phase 16**：`downloadWebGif`（联网下载网页 GIF，默认关）不做 Rust 内存镜像——`App.tsx` 每次收藏时把它作为 `downloadWebGif` 参数传给 `collect_image_from_clipboard` 命令。
- `src/lib/tauri.ts` 是唯一调用 `invoke()` 的地方。新增 Tauri 命令就在这里加类型化包装；不要从特性代码里直接调 `invoke`。Phase 6 加了约 20 个分组/标签/收藏/搜索/回收站包装。
- `src/types.ts` 是共享契约的唯一来源。Phase 8 起 `IndexedImage`（7 字段，含 `id`，网格缩略图按 id 取）与 `IndexedEmoji`（15 字段，含 `id`、`sourceType`、`isFavorite`、`groupIds[]`、`tagIds[]`、`lastUsedAt`、`usageCount`、`importedAt`、`modifiedAt`）并存，`sourceType` 联合为 `"managed_import" | "clipboard"`（外部扫描已移除）。字段名用 camelCase，因为 Rust 侧用 `#[serde(rename_all = "camelCase")]`。
- 特性文件夹：`features/import`（唯一的 `ImportMenu`，工具栏与空状态共用）、`features/library`（网格视图 + Phase 6 对话框 `GroupDialog` / `MoveToGroupDialog` / `TagPickerDialog` + `useDebouncedValue` + Phase 9 多选 `useMultiSelection` hook + Phase 16 悬停播放 `useGifPreview` hook + `isGifExtension`）、`features/search`（浮层窗口内容）。Hook 紧挨着拥有它们的组件。
- `src/app/LibrarySidebar.tsx` — 侧边栏。Phase 13 起布局从上到下固定：全部表情/最近使用/收藏 → 我的分组（标题栏右侧 🔍/＋；搜索收进按钮、点击才展开 `SearchBox`，`searchOpen` 参与过滤条件 → 收起即失效）→ 分组列表（**唯一 `flex:1; min-height:0; overflow-y:auto` 的弹性滚动区**，占满剩余高度）→ 未分组/回收站 → 快捷键（单行）/设置。固定项紧凑（导航行 28px、分隔线 4px、根 padding 6px），不要再给固定项 `flex` 或大留白。**Phase 14**：`divider` 样式显式 `flexGrow: 0` + `flexShrink: 0`——Fluent `Divider` 默认 `flex-grow:1`，曾让 3 个分隔线与分组列表平分剩余高度、分组区只剩 3 行（详见 Phase 14 文档与「关键不变量」）。置顶走 `group.isPinned`（后端 `list_groups` ORDER BY 排前）+ 右键菜单「置顶/取消置顶」+ 名字前小图钉；折叠态搜索重置、`overflow-x:hidden` 防滚动条压窄图标行。详见 `docs/phase13-sidebar-groups-redesign.md` 与 `docs/phase14-sidebar-divider-flex-fix.md`。

### 后端（`src-tauri/src/`，Rust + Tauri 2）

- `lib.rs` — 入口。装配插件（`clipboard-manager`、`dialog`、`global-shortcut`、`log`）、托管状态（`ShortcutRegistry`、`DatabaseState`、`RecentImagesState`、`TargetWindowState`、`SelectionSearchState`）、托盘设置、`on_window_event` 拦截 `main` 和 `quick-search` 的 `CloseRequested` 改为隐藏而非关闭，`setup` 里调用 `ShortcutRegistry::reconcile` 在启动时 `unregister_all` 清掉残留的 OS 级快捷键。只有托盘「退出」菜单项调用 `app.exit(0)`。`invoke_handler!` 注册 37 个命令（Phase 8 删 `scan_directory` / `get_indexed_images`，加 `import_folder`；Phase 13 加 `set_group_pinned`；Phase 15 加 `set_selection_search_enabled`）。
- `commands.rs` — 所有 `#[tauri::command]` 处理器，经 `tauri::generate_handler![...]` 在 `lib.rs` 注册。长时间工作用 `tauri::async_runtime::spawn_blocking` 包裹；其余同步。Phase 8 起：所有库数据变更命令（导入 / 回收站四件套 / 收藏 / 分组 / 标签 / 剪贴板收藏）成功后 `quick_search::notify_library_changed(&app)`；导入命令带 `skip_perceptual_dedup: Option<bool>`；`load_thumbnail` 改按 `emoji_id` 查 DB。Phase 6 新增：`list/create/rename/delete_group`、`list/create/rename/delete_tag`、`add/remove_emojis_to/from_group`、`add/remove_tags_to/from_emojis`、`set_emojis_favorite`、`search_emojis`、`soft_delete_to_trash`、`restore_from_trash`、`permanently_delete_emojis`、`empty_trash`、`list_deleted_emojis`、`show_in_explorer`。**Phase 13 新增** `set_group_pinned`（置顶分组，同步命令、不调 `notify_library_changed`——置顶不改表情数据，不影响快速搜索结果）。回收站命令返回 `TrashResult { succeeded, files_moved, failures }`；`search_emojis` 返回 `Vec<IndexedEmoji>`（`groupIds` / `tagIds` 已由 `fill_relations` 填好）。
- `clipboard.rs` — 写路径：PNG/JPEG/WebP 经 `image::load_from_memory_with_format` 编码，GIF 用 `GifDecoder`（仅首帧），通过 `tauri-plugin-clipboard-manager` 写 RGBA。返回描述来源/剪贴板格式和动画状态的 `ClipboardCopyOutcome`。这里不发射任何事件；命令层发 `image-copied`。**Phase 6 加了 SQLite 回写**：复制成功后 `copy_image_to_clipboard` 也调用 `EmojiRepository::record_image_used(id, at_ms)` 保持 `last_used_at` / `usage_count` 同步（SQLite 是"最近使用"的新单一事实源）。**Phase 16**：GIF 在插件写完 RGBA 首帧后，`append_gif_animation` 经 `platform/windows/clipboard_raw.rs` **追加** CF_HDROP 文件列表（主通道，指向受管 `.gif` —— 实测微信/QQ 只按文件粘贴才保动画，不消费 `image/gif` 位图格式）+ 注册格式 `"image/gif"` 的原始字节（辅通道），均不 `EmptyClipboard`、不破坏插件写的 DIB/PNG，成功 → `animationPreserved=Some(true)`，失败 → warn + 维持 `Some(false)`，绝不影响复制主流程。
- `clipboard_collect.rs` — 读路径：**Phase 16 起最前按序尝试三条动画保真通道** —— ①注册格式 `"image/gif"` 原始字节（Firefox 复制 GIF 时放）；②`CF_HDROP` 文件路径（QQ 复制聊天图片 / 资源管理器复制 .gif 文件时放，指向 `nt_qq\nt_data\Pic\...\Ori\*.gif` 原图，**只读**源文件字节、用源文件名）；③网页 GIF URL 联网下载（`attempt_web_gif`，**设置开关 `downloadWebGif` 默认关**：Chrome/Edge 复制只放首帧位图 + URL；开启时 ureq 下载 —— 仅 http(s) 且 `.gif` 结尾、连接 5s/读取 15s 超时、20 MB 上限；关闭时静态导入 + message 提醒）。三通道都无 → 静默降级原 RGBA 路径：`app.clipboard().read_image()` → RGBA → `RgbaImage::from_raw` → `DynamicImage` → `AssetService::stage_dynamic_image` → `ImportService::import_dynamic_image`。返回 `ClipboardCollectOutcome` 枚举（Empty / Imported / Duplicate / Failed / Unavailable）而非 `Result`；D2 错误分类在这里（见不变量）。`clipboard_filename(extension)` 按参数生成 `.png` / `.gif` 文件名。**这是全应用唯一的网络行为**（下载用户刚复制的 URL，不上传）。
- `scanner.rs` — 目录遍历器（`collect_image_files`，walkdir 递归、只收受支持扩展名）**并定义 `IndexedImage` / `IndexedEmoji`**。Phase 8 删除了 `scan_directory` / `ScanSummary` / `scan_and_persist`（外部索引模式整体移除）。
- `thumbnail.rs` — 缩略图 data URL。**磁盘缓存优先**：`load_thumbnail(emoji_id, max_size)` 按 id 查 DB 的 `thumbnail_path`，缓存存在且非空 → 直接 base64（不重编码）；缺失 → 回退解码原图生成。`write_thumbnail_png` 在导入时写磁盘缓存（Fast 压缩，不再 `sync_all`）。
- `recent.rs` — 内存 `RecentImagesState` 缓存，现在**镜像** SQLite 的 `EmojiRepository::search_recent`（50 条）。Phase 6 让 SQLite 成为事实源：`copy_image_to_clipboard` 经 `record_image_used` 写 SQLite；`get_recent_images` 经 `search_recent` + `fill_relations_for_recent` 读。`recent-images.json` 文件不再写入；首次启动时导入一次（`database::import_legacy_recent_if_present`），之后只读以向后兼容。
- `tray.rs` — 系统托盘，三个固定项：打开主窗口 / 打开搜索浮层 / 退出。
- `quick_search.rs` — 薄壳：`WINDOW_LABEL`、`show_quick_search` / `hide_quick_search`（均泛型 `<R: Runtime>`，托盘 / 主窗口 / 全局快捷键三条路径**共用** —— Phase 15 前快捷键路径内联复制 show 逻辑且从不捕获粘贴目标，是既有 bug，已修）、`normalize_shortcut` / `shortcut_parser_text` 辅助函数，以及 Phase 8 的 `LIBRARY_CHANGED_EVENT` / `notify_library_changed`（数据变更命令调它给浮层发 `library-changed`）。浮层内容由 `QuickSearchWindow` + `useQuickSearchQuery` 驱动（见"快捷搜索浮层"）。**Phase 7**：`show_quick_search` 在 `center/show/set_focus` *之前*调用 `target_window::capture_from_foreground`（这样浮层打开前的前台窗口会在 EmoBox 抢焦点前被捕获）；`hide_quick_search` 只隐藏、**不清空目标**（前端自动粘贴链是 hide-then-paste 顺序，清空会让每次粘贴 `noTarget` 降级 —— Phase 15 修复；跨会话复用由 capture 的"打开即先 clear"防住）。**Phase 15**：其后紧接着调 `selection_capture::capture_selected_text`（选中文字也必须在抢焦点前读 —— UIA `GetFocusedElement` 在浮层 show 之后会指向浮层自己），`quick-search-opened` 的 payload 从 `()` 改为 `QuickSearchOpenedPayload { selectedText: Option<String> }`（camelCase）。
- `platform/` — Phase 7 的 Windows 专属 FFI，也是 `windows` crate + `unsafe` 唯一出现的地方。`platform/mod.rs` 把整棵树藏在 `#[cfg(windows)]` 后面；非 Windows 构建不含它。`windows/foreground_window.rs`（经 `GetForegroundWindow` + `GetWindowThreadProcessId` + `GetWindowTextW` + `OpenProcess`/`QueryFullProcessImageNameW` 捕获前台 HWND / PID / 标题 / 进程名）、`windows/window_activation.rs`（`validate` 用捕获时的 PID 复验防 HWND 复用；`activate` 恢复最小化窗口并用 Drop guard 包住 `AttachThreadInput` 保证 detach 总会执行；轮询 `GetForegroundWindow` 最多 500ms）、`windows/input_simulation.rs`（`SendInput` 发 Ctrl+V / Ctrl+C（Phase 15），均拆成 4 个离散事件、间隔 20ms，用 `VK_LCONTROL`；`click_at` 模拟鼠标）、`windows/focus_restore.rs`（UIA 定位输入控件并点击它；**Phase 15 修复了 E0133 编译损坏** —— UIA 条件查询用 `CreateTrueCondition()` + `FindAll(TreeScope_Subtree)` + 遍历 `CurrentControlType() == UIA_EditControlTypeId`，不用 `CreatePropertyCondition`/VARIANT；EnumChildWindows 回退保留）、`windows/selection_reader.rs`（Phase 15：UIA TextPattern 读前台焦点控件的当前选区，非侵入通道，失败返回 `None` 走 Ctrl+C 兜底）、`windows/clipboard_raw.rs`（Phase 16：Win32 原生剪贴板读写 —— 读注册格式 `"image/gif"` 原始字节（Firefox）与 `CF_HDROP` 文件路径（QQ/资源管理器，`read_file_drop` + `parse_drop_files` 仅支持宽字符列表）；写 CF_HDROP 文件列表（`write_file_drop`，微信/QQ 粘贴动图的已验证通道）+ 注册格式字节。`ClipboardGuard` Drop guard 保证 CloseClipboard；读路径任何失败 → `None` 静默降级；写路径 `SetClipboardData` 成功后 HGLOBAL 所有权转移给系统**不得 free**、失败路径才 `GlobalFree`。**坑**：windows 0.61 里 `GlobalFree` 在 `Win32::Foundation` 而非 `System::Memory`；`GetClipboardData`/`SetClipboardData` 收发 `HANDLE` 需与 `HGLOBAL` 互转；`CF_HDROP` 是 `CLIPBOARD_FORMAT(u16)` 要 `as u32`）。
- `target_window.rs` — Phase 7 内存态 `TargetWindowState { Mutex<Option<TargetWindowInfo>> }`。记录快捷搜索打开时的前台窗口。按会话作用域：每次打开 `capture_from_foreground`（泛型 `<R: Runtime>`）先清空再写入，`peek` 在同一会话内复用，`clear` 在隐藏 / 粘贴失败时调用，60 秒 TTL。绝不持久化。
- `selection_capture.rs` — **Phase 15 选中文字搜索的编排层（替换语义：取词即剪切）**。`SelectionSearchState`（开关内存镜像，默认 `true`，前端推送；`explicitly_set` 标志区分默认值与显式设置）+ `capture_selected_text(app)`：开关关 → 直接 `None`（完全不动剪贴板与输入框）；开 → 先 UIA（`selection_reader::read_selection_uia`，读到后 `cut_selection` 补 Ctrl+X 删选区），失败走 `ctrl_x_fallback`（**等修饰键物理松开**最多 600ms → `send_ctrl_x` 取词+删除一步完成 → 轮询 `read_text` 变化最多 ~300ms；剪切文字**留在剪贴板**作为放弃选择时的找回途径，不恢复原剪贴板）。`sanitize_selection`：trim、折叠空白、40 字符截断（`chars().take`，CJK 安全）。选中文字只存在内存、绝不持久化。
- `shortcut_registry.rs` — 多拥有者（QuickSearch、ClipboardCollect）共享的全局快捷键注册。单个 `Mutex<HashMap<String, ShortcutOwner>>` + `ShortcutSyncState`（Unknown / Synced / RecoveryRequired）。`try_set` 是唯一变更点：先注册新快捷键，再注销旧的，回滚也失败则置 `RecoveryRequired`。冲突检测在 map 层（不经插件错误）。启动时调用 `reconcile` 清掉残留的 OS 级注册。`run_owner_action` 的 QuickSearch 分支直接调 `quick_search::show_quick_search`（Phase 15 统一，勿再内联复制 show 逻辑）。
- `database/` — 在 `app_data_dir` 打开 `emobox.sqlite3`，运行 `src-tauri/migrations/*.sql` 的迁移。给仓库暴露 `connect()`。**`configure_connection` 对每个连接设置**：`PRAGMA foreign_keys=ON`（**这是迁移里 `ON DELETE CASCADE` 真正生效的前提**——分组/标签软删不触发，只有物理 `DELETE` 触发）、`journal_mode=WAL`（读到的是连接自己的快照，跨语句可能看到不同状态，排查并发写入时要开事务取一致快照）、`busy_timeout=5s`、`synchronous=NORMAL`。**有六个迁移**：`0001_create_emojis.sql`（旧 17 列）、`0002_create_groups_tags.sql`（4 张新表：`groups` / `tags` / `emoji_groups` / `emoji_tags`，外键均 `ON DELETE CASCADE`）、`0003_add_emoji_trash_columns.sql`（`emojis` + `deleted_at` / `trash_path` / `trash_thumbnail_path` + `idx_emojis_is_deleted_deleted_at` 索引）、`0004_remove_external_directory_add_perceptual_hash.sql`（Phase 8：删除全部 `external_directory` 行 + 新增 `perceptual_hash` 列；**不建该列的 B-tree 索引**——去重是 Rust 全表 Hamming 扫描，普通索引无加速）、`0005_add_updated_at.sql`（Phase 11：`emojis` + `updated_at` 列，记录**元数据最后修改时间**，存量初始化为 `imported_at`）、`0006_add_group_pinned.sql`（Phase 13：`groups` + `is_pinned` 列，`DEFAULT 0` 自动回填存量；不建索引——分组几十行无加速）。`run_migrations` 之后 `DatabaseState::initialize` 还会调用 `ensure_updated_at_column`——兼容早期把 5 号迁移应用成 `file_modified` 的库，按 `PRAGMA table_info` 幂等补列（不依赖 `ADD COLUMN IF NOT EXISTS`）。`connect()` 总是开新连接 —— 没有连接池。测试里的 `Connection::open_in_memory()` 不走 `configure_connection`（无外键/WAL pragma）。
- `repositories/emoji_repository.rs` — `emojis` 表的 SQL 访问。Phase 6 新增：`set_favorite_for_ids`（单事务批量）、`add_to_group` / `remove_from_group`（矩阵写）、`add_tags` / `remove_tags`（矩阵）、`record_image_used`（最近使用 bump）、`mark_deleted` / `set_trash_paths` / `clear_trash` / `delete_permanently` / `list_deleted_targets`（回收站状态机）、`list_indexed(options, query, tag_ids)`（统一搜索，Phase 8 起锁步绑定 + `组*标签` 精确语法）、`list_deleted`（路径用三参数 `COALESCE(trash_path, managed_path, source_path)`）、`search_recent`、`fill_relations`（两查询批量查 `emoji_groups` + `emoji_tags` —— 从无 N+1）、`get_relations_for_ids`（底层辅助）。**Phase 8 新增**：`find_duplicate_content(sha256, perceptual_hash, threshold, skip_perceptual_dedup)`（SHA 精确 + dHash 感知双通道，候选按 (Hamming, id) 升序取最优）、`find_by_id`、`list_null_perceptual` / `update_perceptual_hash`（惰性回填）、`insert_managed` 增 `ImportGroup` 同事务建组并返回 `InsertResult { emoji_id, group_id, group_created }`、`import_legacy_recent` 重写为只更新既有受管行（不再建 external 行）。**Phase 10 新增**：`parse_exact_query` 支持 `组*标签`（`:` 别名）+ `SearchMode{Exact, Lenient, FuzzyGroup, PlainLike}` 四级回退、`list_untagged_emojis`（文件名标签回填候选）。**Phase 11 新增**：`touch_updated_at(connection, ids)`（刷新 `updated_at` 修改时间；用户 id 级元数据操作在命令层调用，重命名/删除组、标签在仓库内部连带刷新成员，见 `docs/phase11-ui-polish-time-sort.md`）。
- `repositories/group_repository.rs` — `groups` 的 CRUD，加一个 `list_groups` 用子查询带每分组表情数。名称 `COLLATE NOCASE` 唯一。**Phase 13 新增** `set_group_pinned`（`is_pinned` 置顶，不刷成员 `updated_at`——与 rename/delete 区分，置顶只是侧栏排序）；`list_groups` ORDER BY 为 `is_pinned DESC, sort_order, id`（置顶组在前）。
- `repositories/tag_repository.rs` — 与 groups 同形，但针对 `tags`。名称同样 `COLLATE NOCASE` 唯一。
- `services/` — `asset_service`（在资源管理器中打开、临时文件 + 原子重命名、`encode_image_as_png` 是**全仓库唯一** PNG 编码点、`stage_file` / `stage_dynamic_image` / **Phase 16 `stage_bytes`**（内存字节 → 临时文件 → 与 `stage_file` 共用抽出的 `stage_temporary`：解码 → dHash → `animation_status` → Static>512px 才缩放重编码）/ `is_gif_bytes`（GIF magic 校验，剪贴板读写共用）/ `decode_for_import` / `animation_status` / `encode_scaled_image`；Phase 8 起受管副本静态图 >512px 缩到 512px 内重编码，动画/未知格式保持原字节）、`import_service`（`import_one` / `import_folder` / `import_dynamic_image` / **Phase 16 `import_bytes`**（剪贴板 `"image/gif"` 原始字节，SHA 对原始字节算）共用 `commit_staged_as_source_type`；`static IMPORT_LOCK: Mutex<()>` 串行化所有写入；`find_duplicate_content` 双通道去重 + `backfill_perceptual_hashes` 惰性回填 + `ImportGroup` 同事务建组；DB 失败回滚；**导入自动打文件名标签** —— `commit_staged_as_source_type` 对非 clipboard 来源用完整文件名 `find_or_create_id` + `add_tags`，失败仅 warn 不失败导入；另有 `ImportService::backfill_filename_tags` 在 `lib.rs::setup` 启动时一次性回填存量无标签表情，幂等）、以及 **`trash_service`**（Phase 6 新增的唯一服务）。`trash_service` 是 `soft_delete` / `restore` / `permanently_delete` / `empty_trash` 的 FS↔DB 编排器。它强制 **"先移文件再写 DB"** 不变量：主文件用 `fs::rename`（跨卷用 `fs::copy + fs::remove_file` 回退），缩略图只在主文件成功后移动，然后单个 DB 事务。主文件失败会把该行 `is_deleted` 回滚为 `0`。Group / Tag 的 CRUD 留在各自仓库 —— 无需服务层。Phase 7 新增 **`chat_paste_service`** —— 编排 `paste_to_target_window`：`validate` → `activate` → `restore_input_focus` → `SendInput` Ctrl+V。从不返回 `Err`；每个失败都映射为可序列化的 `PasteResult { kind, reason, processName, message }`（`kind` 是 camelCase：`success` / `clipboardOnly` / `disabled`）。`commands::paste_to_target_window` 是唯一调用者：它 `peek` 目标（不消耗 —— 同会话复用），失败时 `clear`。

## 三种导入模式（承重区别）

> **Phase 8（索引移除）**：外部目录"仅索引原路径"模式已整个删除（`scan_directory` / `ScanSummary` / `upsert_external_scan` / `get_indexed_images` 不再存在，存量 `external_directory` 行由 migration 0004 删除）。任何导入都是复制进受管库。

| 模式 | Tauri 命令 | 行为 | 持久化？ |
|---|---|---|---|
| **导入图片 / 拖放（受管复制）** | `import_managed_paths`（`import_service`） | 把选中的文件复制到 `app_data_dir/assets/emojis/`，写缩略图，存 `managed_path` + `sha256` | 是（SQLite + 文件系统） |
| **导入文件夹（受管复制 + 自动分组）** | `import_folder`（`import_service::import_folder`） | 递归复制文件夹内所有支持图片；**每个顶层子文件夹自动建同名分组**（懒建：仅当该子文件夹第一张图成功导入才建组，失败/重复不建空组）；**平铺文件夹（无任何子文件夹）按文件夹本身建同名分组**；有子文件夹时根目录散图不归组 | 是（SQLite + 文件系统） |
| **剪贴板收藏（受管复制，用户触发）** | `collect_image_from_clipboard`（`clipboard_collect`） | **Phase 16**：按序尝试动画保真通道 —— ①`"image/gif"` 原始字节（Firefox）②`CF_HDROP` 文件路径（QQ 复制图片/资源管理器复制 .gif，只读源文件）③网页 GIF URL 联网下载（设置开关 `downloadWebGif`，默认关）→ `import_bytes` 保留动画；都不可用 → `read_image()` 读 RGBA，经 `stage_dynamic_image` 重新编码为静态 PNG（检测到网页动图时 toast 提醒）。SHA-256 去重（gif 路径对原始字节算），以 `source_type='clipboard'` 存储。由 `Ctrl+Alt+S` 或菜单触发 | 是（SQLite + 文件系统） |

**去重（Phase 8）**：双通道 —— SHA-256 字节级（`DedupHitKind::ExactSha`，直接跳过）+ dHash 感知（`PerceptualDuplicate`，携带候选 id/路径/Hamming 距离，前端可"强制导入"）。导入命令带 `skip_perceptual_dedup` 参数，为 true 时只绕过感知、不绕过 SHA。迁移 0004 后旧受管行 `perceptual_hash` 为 NULL，由 `import_folder`/`import_paths` 触发**惰性回填**（`ImportService::backfill_perceptual_hashes`，每批 ≤50）。

**压缩（Phase 8）**：受管副本静态图（PNG/JPG/WebP）任一边 >512px 缩到 512px 内再显式重编码（PNG Fast / JPEG q85 / WebP lossless）；GIF / APNG / 动画 WebP / 无法确认格式一律保持原始字节（`AssetService::animation_status` 内容级检测）。dHash 在压缩前对解码图计算（EXIF 方向已应用）。

`EmojiLibraryView` 消费 `currentEmojis: IndexedEmoji[]`（按视图，由 `App.tsx` 在 `searchEmojis` 调用后设置）并投影为 `IndexedImage`（Phase 8 起 7 字段，含 `id`）供网格用。`App.tsx` 里按视图的 useEffect 选择正确的后端端点：四个列表视图（`all` / `favorites` / `ungrouped` / `group:N`）用 `search_emojis`，`trash` 用 `list_deleted_emojis`，`recent` 用本地 `recentItems`（客户端过滤）。网格的 `viewItems` 是 `currentEmojis` 的轻量 `IndexedImage` 投影。搜索框支持 `组*标签` 精确语法（`list_indexed` 后端解析，NOCASE，精确空结果依次回退「组精确+标签 LIKE」→「组名子串+标签 LIKE」→ 普通 LIKE；也支持 `组名*` / `*标签` / 全角 `＊`，`:` / `：` 保留为别名）。recent 视图是客户端过滤（`src/lib/searchSyntax.ts` 镜像同一语法，含模糊组名回退），经 `RecentImageRecord.groupIds/tagIds`（后端 `fill_relations_for_recent` 填充）做组/标签匹配。**网格选中与右键（Phase 9）**：`EmojiGrid` 持有一个共享受控 `Menu`（`EmojiItemMenu` 内容），用 `positioning={{ target }}` 光标定位（本地 `VirtualTarget` helper，事件/按钮 rect 两种锚点，不依赖 `usePositioningMouseTarget`）；`EmojiGridItem` 单击按 `multiSelectMode` 分发（开启=切换选中，否则=替换），Ctrl/Shift 仍可切换/范围；`EmojiItemMenu` 的 `multi` 为 true 时隐藏 复制/查看文件位置。选中 ≥2（多选模式下 ≥1）时 `EmojiLibraryView` 在 `.content` 底部浮出批量条（`LibraryHeader` 提供「多选」开关）。

## 快捷搜索浮层

- `src/features/search/QuickSearchWindow.tsx` 用 `useQuickSearchQuery` hook 驱动：监听 `quick-search-opened` 触发重载（Phase 15 起 payload 携带 `selectedText`，非空作为 seed query 经 `activate(seed)` → `setQuery(seed)` 注入；读不到则 `resetQuery()` 清空）；**空 query 走 `searchEmojis({view:"all", sort:"recent"})`（全库最近优先，未用过的新图也可见）**，非空 query 走全库跨字段搜索（支持 `组*标签`）。`requestSeq` ref 保证快速输入 / 库变更时只有最新请求落地。
- 数据变更命令（导入 / 删除 / 收藏 / 分组 / 标签）成功后 `quick_search::notify_library_changed` 向浮层发 `library-changed`，浮层收到后重载当前搜索（不重置输入）。
- Enter / 鼠标点击触发 `copyImageToClipboard`（Rust 命令），成功/失败弹 toast，成功复制后约 500ms 自动隐藏浮层。失败时浮层保持打开，错误内联显示。
- 默认全局快捷键是 `Ctrl+Alt+Space`（不是 `Alt+Space`，Windows 系统窗口菜单保留了它）。`src/config/shortcuts.ts` 导出两个常量以及 `ShortcutEditor` 用的 `shortcutFromKeyboardEvent` 辅助函数。

## Phase 7：自动粘贴到打开浮层前的窗口

用户在输入窗口（微信 / QQ / 飞书 / 任何应用）里按快捷键、选表情，EmoBox 复制到剪贴板、恢复打开浮层前的窗口、合成 `Ctrl+V`。**它绝不发送 Enter。**

流程：`show_quick_search` 捕获前台窗口 → 用户选择 → `copyImageToClipboard` → `hideQuickSearch`（必须*在*粘贴之前隐藏 —— always-on-top 浮层会阻塞 `SetForegroundWindow`）→ 50ms 稳定 → `paste_to_target_window` → toast。

- **`autoPaste` 设置**（默认 `true`，非 Windows 默认空操作）：`ThemeProvider.tsx` 里的 `PersistedSettings.autoPaste`，持久化到 `localStorage: emobox.settings`；开关在 `SettingsMenu.tsx`「常规」。
- **前端调用链** `QuickSearchWindow.tsx::copySelectedImage`：复制 → 500ms 关闭计时 → 复制成功 toast → 若 `autoPaste`：`await hideQuickSearch()`（失败 → 降级 toast，不再粘贴）→ 50ms → `await pasteToTargetWindow()`（IPC 失败 → 降级 toast）。`copyingPath` 在所有路径恢复，避免后续选择被锁死。
- **`PasteResult` 契约**（Rust ↔ TS）：`kind` ∈ `success` / `clipboardOnly` / `disabled`（camelCase）；`reason` ∈ `noTarget` / `targetClosed` / `pidMismatch` / `activationFailed` / `inputFailed` / `invisible` / `ipcFailed` / `hideFailed`；`processName: string | null`。前端把 `reason` 映射为具体的 toast。
- **生命周期**：每次打开先清空再写入（跨会话复用不可能）；`peek`（不消耗）让同一会话可反复粘贴；粘贴失败时命令层 `clear`；**浮层隐藏不 clear**（hide-then-paste 顺序，Phase 15 修复）；60 秒 TTL 兜底。
- **关键 Win32 不变量**：绝不含 `VK_RETURN`；`AttachThreadInput` 所有路径 detach（Drop guard）；`SendInput` 拆成带间隔的逐事件调用；激活前复验 PID 防 HWND 复用；输入不经过 shell/`Command::new`；不用 IM 私有协议 / 不读内容 / 不后台轮询；HWND 绝不持久化。
- **已知缺口（Phase 15 已修复，待真机复验）**：`focus_restore.rs` 曾因 `VARIANT` 嵌套 union 构造在 Rust 2024 下撞 `E0133` 编译损坏，Phase 15 已按文档既定方案重写（`CreateTrueCondition()` + `FindAll` + 遍历 `CurrentControlType() == UIA_EditControlTypeId`）。Windows 构建已恢复，但真机自动粘贴端到端（尤其 Electron 应用 / 原生微信的 UIA 可见性）**尚未复验** —— Electron 应用需 Chromium 无障碍树就绪，原生微信靠 `EnumChildWindows` 回退。完整细节与决策记录：`docs/phase7-chat-paste.md` 与 `docs/phase15-selection-search.md`。

## 关键不变量 / 硬性规则

- 用户的原始图片绝不被 EmoBox 复制、移动、改名或删除，*除了* `import_managed_paths` 和 `import_dynamic_image` / `import_bytes`（剪贴板收藏，Phase 16 起含 GIF 原始字节路径）有意复制进受管素材目录，以及 **`trash_service::soft_delete` / `restore` / `permanently_delete` / `empty_trash` 在 `app_data_dir/assets/trash/` 内外移动文件**（注意 trash 在 `assets/` 下，不是 `app_data_dir/trash/`——`trash_service.rs` 由 `emojis_directory().parent().join("trash")` 推导）。读路径对剪贴板 `CF_HDROP` 指向的外部文件（如 QQ 原图缓存）**只读**、绝不改动。不要加任何其他会改动用户文件的路径。
- 主窗口和快捷搜索窗口都拦截 `CloseRequested` 并隐藏。只有托盘「退出」菜单调用 `app.exit(0)`。
- `copy_image_to_clipboard` 经剪贴板插件写 `tauri::Image`（RGBA），不是文本/`file://` URL。WebP 转成静态图；GIF 缩到首帧，**Phase 16 起** Windows 上随后追加 CF_HDROP 文件列表（主通道，指向受管 `.gif`）+ `"image/gif"` 原始字节（辅通道）——文件列表追加成功 `animationPreserved=Some(true)`（微信/QQ 粘贴为动图），失败降级 `Some(false)`（toast「仅保留首帧」）。同一命令随后调用 `EmojiRepository::record_image_used` 保持 SQLite 同步。
- **回收站（Phase 6）**：`soft_delete` 和 `restore` 遵循 **"先移文件再写 DB"**。主文件用 `fs::rename`（跨卷回退到 `fs::copy + fs::remove_file`）；缩略图只在主文件成功后移动；DB 事务只在两个文件都落地后写 `is_deleted = 1` 和回收站路径。主文件失败把该行 `is_deleted` 回滚为 `0` 并保持原文件原位。缩略图移动失败不致命（记录日志 + 记入 `TrashFailure`）；主文件移动对该行致命。`is_managed_source` 守卫（只有 `managed_import` / `clipboard` 才做文件移动）保留为防御——遗留的 external 行已被 migration 0004 删除。
- **CASCADE 行为（Phase 6）**：`emoji_groups` / `emoji_tags` 上的 `ON DELETE CASCADE` 只在物理 `DELETE FROM emojis` 时触发。`UPDATE emojis SET is_deleted = 1` 是**软删**，*不*触发 CASCADE —— 软删行保留其分组/标签关联，恢复时继续生效。只有 `permanently_delete` 和 `empty_trash` 发出硬 `DELETE`，会原子地级联清掉关联。
- **路径语义（Phase 6）**：`IndexedEmoji.path` 是 SQL `COALESCE` 投影。`list_indexed` / `search` 用 `COALESCE(managed_path, source_path)`（2 参数）；`list_deleted` 用 `COALESCE(trash_path, managed_path, source_path)`（3 参数，`trash_path` 优先）。前端网格直接读 `path`，从不由自己拼。
- 最近列表：最多 50 条，按 `path` 去重，按 `lastUsedAt` 降序。**Phase 6 起 SQLite 是事实源** —— `last_used_at` / `usage_count` 在 `emojis` 上，`RecentImagesState` 是内存缓存，`recent-images.json` 文件只导入。
- 所有应跨重启持久化的 UI 状态都走 `ThemeProvider` / `localStorage: emobox.settings`（主题、侧栏折叠、默认视图、两个全局快捷键、`autoPaste`、`selectionSearch`、`downloadWebGif`）。不要引入其他持久化后端。（分组 / 标签 / 收藏状态**不**走这里 —— 它们经 Phase 6 命令存在 SQLite。Phase 7 的目标窗口**仅内存** —— 绝不持久化其 HWND。）
- **Phase 7 自动粘贴**是"先复制再输入模拟"流程，**不是**窗口消息粘贴。`paste_to_target_window` 从不返回 `Result::Err`；每个失败都是 `PasteResult::clipboardOnly`。目标窗口按会话作用域，在隐藏 / 失败 / TTL 时清空。`windows/` 模块是全 crate 唯一的 `unsafe`，藏在 `#[cfg(windows)]` 后面。UIA 条件查询一律用 `CreateTrueCondition` + `FindAll` + 遍历比对（不要用 `CreatePropertyCondition`/VARIANT —— edition 2024 下 E0133）。
- **选中文字搜索（Phase 15）**：**替换语义** —— 取词即剪切（选中文字从输入框删除，表情粘贴正好落在原文字位置；放弃选择时剪切文字留在剪贴板可手动找回）。选区文字只存在内存（事件 payload）、**绝不持久化**；开关关闭时 Rust 完全跳过（不动用户剪贴板与输入框）；任何读取失败 → 浮层空 query 正常打开，绝不阻塞浮层显示。合成 Ctrl+X 前必须等修饰键物理松开（最多 600ms，超时放弃）—— 不等会发出 Ctrl+Alt+X 或裸按键，裸按键会替换选区误删用户文字（真机复现过）。`send_ctrl_x` 与 `send_ctrl_v` 一样绝不含 `VK_RETURN`。详见 `docs/phase15-selection-search.md`。
- **GIF 动画（Phase 16）**：展示层悬停播放 —— `.gif` 项的 asset URL 走 `emojiAssetUrl`（scope：`$APPDATA/assets/emojis/**` + `$APPDATA/assets/trash/**`），加载失败回落静态缩略图且实例内不重试；受管 GIF 是**原始字节**（未压缩），不要做全量预载。剪贴板两条链路都必须**静默降级**：读路径三条动画通道（`"image/gif"` 字节 → `CF_HDROP` 文件路径 → 网页 URL 联网下载（需 `downloadWebGif` 开关））都读不到（Chrome/Edge 且开关关闭即此情形，剪贴板上只有 DIB+网页 URL）→ RGBA 首帧路径；写路径追加失败 → warn + `Some(false)`，绝不让复制失败。**粘贴端（微信/QQ）不消费 `"image/gif"` 位图格式**——它们粘贴动图靠 **CF_HDROP 文件列表**（资源管理器 Ctrl+C 同款），写路径主通道是 `write_file_drop`（指向受管 `.gif`）。**读端 QQ 复制聊天图片带 CF_HDROP 本地路径**（指向 `nt_qq\...\Ori\*.gif` 原图）——读路径用它免联网拿动图，**只读源文件、绝不改动**。Win32 剪贴板所有权规则承重：`GetClipboardData` 的 HGLOBAL 属系统**绝不 free**；`SetClipboardData` 成功后所有权转移**不得 free**、失败路径才 `GlobalFree`；追加格式**不 `EmptyClipboard`**（保留插件写的 DIB/PNG）。`OpenClipboard` 失败要重试（5×10ms，剪贴板可能被剪贴板工具持续占用——开发机上见过整机会话被占死、连 `Set-Clipboard` 都失败的情形，probe 记录见 phase16 文档）。详见 `docs/phase16-gif-animation.md`。
- **网格多选（Phase 9）**：`selectedIds` 是唯一选中源，由 `useMultiSelection(filteredItems)` 托管；prune 按 id 集合并行（排序变化不清、换视图/搜索收窄跟随可见集收缩）。批量 id 直接用视图项 `IndexedImage.id`（各视图含 recent 都真实）。批删/恢复/彻底删除后要同步剪 `currentEmojis` / `allItems` / `indexedEmojis` / `recentItems` / `favorites` / `favoriteIds` 并 `deselect`。切视图用 `prevViewRef` effect 统一清选区 + 关多选模式，**不要**在视图 effect（deps 含 `debouncedQuery` / `recentItems`）里清。键盘 Ctrl+A / Delete 走 `keyShortcutRef` latest-ref，输入框与模态弹窗打开时豁免。
- **App.tsx 事件监听的闭包陷阱**：`listen(...)` 事件回调注册在 deps 不含 handler 的 `useEffect` 里，会捕获首次挂载时的旧闭包——handler 依赖设置值（如 `downloadWebGif`）时改设置**不生效**（Phase 16 真机踩过：`Ctrl+Alt+S` 走 `clipboard-collect-requested` 监听，开关开了仍走旧值）。解法一律是 latest-ref 转发（`collectFromClipboardRef`，与 `keyShortcutRef` / `clearSelectionRef` 同模式），不要把 handler 塞进该 effect 的 deps（会连带重跑 refreshLibrary 等初始化逻辑）。
- **侧边栏（Phase 13）**：分组列表是侧边栏唯一 `flex:1` 弹性/滚动区（`min-height:0` 必须有，否则 flex 不滚动）；其余固定项保持紧凑，不要再给它们 `flex` 或大留白。置顶排序唯一入口是后端 `list_groups` 的 ORDER BY（`is_pinned DESC, sort_order, id`），前端不重排；`set_group_pinned` 不刷成员 `updated_at`、不发 `notify_library_changed`。搜索框收起后过滤必须失效（`searchOpen` 参与过滤条件）。
- **Fluent `Divider` 陷阱（Phase 14）**：`@fluentui/react-divider@9.7.4` 的 root 默认样式带 `flex-grow: 1`（藏在 `node_modules` 生成的 CSS 里，不读组件库源码察觉不到）。flex column 中放 `<Divider>`，只要容器高度可能大于子内容总和（固定高度 / flex 伸展），就必须显式 `flexGrow: 0`，否则它会与 `flex: 1` 区平分剩余空间（侧栏 `divider` 样式即因此加 `flexGrow: 0` + `flexShrink: 0`）。内容自然高度的容器（如 `TagPickerDialog` / `MoveToGroupDialog`）无此问题。
- Rust 侧把表情元数据持久化在 SQLite（`app_data_dir` 的 `emobox.sqlite3`）。无云端、无账号、无网络同步——**唯一例外**：Phase 16 的「联网下载网页 GIF」设置开关（默认关）会下载用户刚复制的剪贴板 URL（仅 http(s) `.gif`、超时 15s、上限 20 MB、不上传任何数据），见 `clipboard_collect.rs::attempt_web_gif`。
- 支持的图片扩展：`png`、`jpg`、`jpeg`、`gif`、`webp`。检查点集中在 `scanner::supported_extension`（Rust）和 `useLibraryImport.ts` 的 `imageFilters`（TS）。
- 未实现的功能必须在 UI 里可见地 `disabled`，不能静默假装成功。参见 `ImportMenu.tsx` 的模式。
- Rust 单元测试在 `#[cfg(test)]` 模块里（例如 `asset_service.rs`、`import_service.rs`、`scanner.rs`、`recent.rs`、`clipboard.rs`、`clipboard_collect.rs`、`shortcut_registry.rs`、`repositories/emoji_repository.rs`、`repositories/group_repository.rs`、`repositories/tag_repository.rs`、`services/trash_service.rs`、`perceptual_hash.rs`；`platform/windows/clipboard_raw.rs` 的真实剪贴板 roundtrip 测试标 `#[ignore]`，手动 `cargo test -- --ignored` 跑）。JS 层检查是 `npm run build`（tsc --noEmit + vite）+ `npx vitest run`（Phase 8 起浮层 `useQuickSearchQuery` 乱序测试 + Phase 9 起 `useMultiSelection` 多选测试 + Phase 16 起 `useGifPreview` 悬停播放测试）。

### PNG 编码是确定性的 —— 对剪贴板去重承重

`AssetService::encode_image_as_png` 用 `PngEncoder::new_with_quality(CompressionType::Fast, FilterType::Adaptive)` + `ExtendedColorType::Rgba8` —— 全仓库**唯一** PNG 编码点。同样的 RGBA 输入总是产出字节级一致的输出和相同的 SHA-256，由 `deterministic_png_encoding_produces_identical_bytes_and_hash` 锁定。没有这个保证，反复从剪贴板收藏同一张图会撞不上 SHA-256 去重并产生重复文件。压缩级别取 Fast（受管副本已缩到 ≤512px，磁盘膨胀有界），确定性不受影响。

### D2 —— 剪贴板错误分类靠 arboard 错误文本

`tauri-plugin-clipboard-manager` 把 arboard 的类型化错误压平成 `String`，所以没法 `match` 错误变体。`clipboard_collect.rs` 匹配两个子串把"剪贴板没有图片"映射到 `Empty` 结果（info toast「剪贴板中没有图片」）：

- `"clipboard is empty"` —— 剪贴板真的空
- `"not available in the requested format"` —— 剪贴板是文本或其他非图片格式

其余都归 `Unavailable`（红色错误 toast）。这依赖 arboard 0.x 的 Windows 错误文本；升级可能需要重新验证。决策记录见 `docs/phase5-clipboard-probe-results.md`。

### `IMPORT_LOCK` 串行化所有写入

`import_service.rs` 持有 `static IMPORT_LOCK: Mutex<()>`，在 `import_paths`、`import_folder`、`import_dynamic_image` 顶部经 `lock_import()` 获取（`lock_import` 用 `poisoned.into_inner()` 恢复被 panic 毒化的锁，不让一次异常永久阻塞导入）。并发的剪贴板收藏（例如快速按 `Ctrl+Alt+S`）会排队；第二个按 SHA-256 找到第一个的暂存素材并返回 `Duplicate`（info toast，不是错误）。不要加绕过这个锁的写路径。

### `ShortcutRegistry` 状态机

`Unknown`（进程刚启动）→ `lib.rs::setup` 调用 `reconcile` 注销所有残留 OS 级快捷键，然后置 `Synced`。每次 `try_set` 以 `Synced`（成功）或 `RecoveryRequired`（回滚失败）结束。前端通过 `get_*_shortcut_status` 的 `registered` 字段间接读 `sync_state`；`RecoveryRequired` 事件以 `SetOutcome::Failed { requires_recovery: true }` 流回，应该暴露给用户（例如横幅）让他们重启或重新录制。

### `list_indexed` 锁步参数绑定与精确语法

`list_indexed(options, query, tag_ids)`（Phase 8 重写）用**锁步绑定**：SQL 的 `?` 出现顺序与 `params` Vec 完全一致（`build_view_filter` 的 group 参数 → query/精确 → tag_ids → LIMIT/OFFSET），不再手工编号。ORDER BY 由 Rust 按 `view` / `sort` 分支输出字面量（不绑定 view 参数）。视图过滤（`build_view_filter`）用 `e` 表别名 —— 每个片段必须引用 `e.xxx`，绝不 `emojis.xxx`。

查询语法：`组名*标签名` / `组名*` / `*标签名`（全角 `＊` 也支持，`:` / `：` 保留为别名）走**精确 AND**（NOCASE 精确匹配分组/标签名）；精确查询空结果时依次回退「组精确 + 标签 LIKE」→「组名子串（分组名/文件名/标签名任一）+ 标签 LIKE」→ 普通 LIKE（跨字段 OR，query 绑定 3 次）。组名子串回退让**未归组**的表情包也能 `包名*表情` 搜到（分组存在时精确优先）。`ListOptions.sort = Some("recent")` → 最近使用优先、未用过的按导入时间排后。

## 去哪改

- 新增 Tauri 命令？在 `src/lib/tauri.ts` 加包装、`src/types.ts` 加类型、`src-tauri/src/commands.rs` 加处理器、`src-tauri/src/lib.rs::invoke_handler` 注册。长时间工作走 `tauri::async_runtime::spawn_blocking`。对应的仓库方法应落在 `repositories/{emoji,group,tag}_repository.rs`（只有当操作跨界文件系统时才在 `services/` 里加服务 —— 参见 `trash_service`）。受管文件的 asset 协议 URL 出口是 `src/lib/tauri.ts::emojiAssetUrl`（`convertFileSrc`）；scope 配在 `tauri.conf.json` 的 `app.security.assetProtocol`（**不是** capability，且 `tauri` crate 需 `protocol-asset` feature）。
- 新增全局快捷键？在 `shortcut_registry.rs` 加一个 `ShortcutOwner` 变体；注册表处理冲突检测。前端在 `SettingsMenu.tsx` 加一行 `ShortcutterEditor`；除非用户能配置它，否则不需要新 Rust 命令。
- 新增设置？扩展 `ThemeProvider.tsx` 的 `PersistedSettings`；自动持久化到 `localStorage: emobox.settings`。设置对话框是 `src/app/SettingsMenu.tsx` 的 `SettingsDialog`（`TabList` 左导航 + `panel` 右内容，Phase 12 起全留白分组 + `groupTitle` 小标题，内容列滚动由 `panel` 的 `overflowY: auto` 提供）。**坑**：Fluent `DialogContent` 自带 `overflowY: auto`，别在 `content` class 上覆盖成 `overflow: hidden`；`content` 的 grid 必须 `gridTemplateRows: minmax(0, 1fr)` 且 `DialogBody` 挂 `height: 100%`，`panel` 才有界高度、滚动才生效（详见 `docs/phase12-settings-layout.md`）。
- 新增侧栏视图？把新值加进 `App.tsx` 的 `viewTitles`（以及 `SettingsMenu.tsx` 的默认视图下拉），扩展 `types.ts` 的 `LibraryView` 联合，并在 `App.tsx` 的按视图 useEffect 里加一个分支调用对应后端命令。新列表视图用 `searchEmojis({view: "..."})`；保留视图是 `all` / `favorites` / `ungrouped` / `group` / `search-recent` / `trash` —— SQL 由 `build_view_filter` 构建。
- 新增分组 / 标签 / 收藏操作？CRUD 在 `group_repository.rs` / `tag_repository.rs`；关联在 `EmojiRepository::add_to_group` / `remove_from_group` / `add_tags` / `remove_tags`；批量收藏是 `EmojiRepository::set_favorite_for_ids`（单事务，无 N+1）。
- 新增网格选中 / 右键 / 批量操作？选中状态只在 `features/library/useMultiSelection.ts`（`selectedIds` 单一来源）；右键菜单是 `EmojiGrid` 里的共享 `Menu` + `EmojiItemMenu`（`multi` 区分批量）；批量处理器在 `App.tsx`，统一 `(items: IndexedImage[])` 数组签名。后端批量命令（`setEmojisFavorite` / `addEmojisToGroup` / `addTagsToEmojis` / `softDeleteToTrash` 等）已接受 `number[]`，不要再加单个 id 的新命令。
- 新增回收站操作？路由到 `trash_service` —— 永远不要在该模块外改文件。更新 `trash_service::TrashResult` 的消费者（Tauri 命令）和前端回收站操作（`EmojiItemMenu` trash 模式 + 批量条；确认用 `window.confirm`，无 Fluent Dialog）。
- 新增剪贴板*写*行为？`clipboard.rs` 是边界。别忘了 `record_image_used` 回写，让 SQLite 的 `last_used_at` / `usage_count` 保持最新。注册格式（如 `"image/gif"`）的原始字节读写只在 `platform/windows/clipboard_raw.rs`。
- 新增剪贴板*读*行为？`clipboard_collect.rs` 是边界；RGBA 必须经 `AssetService::stage_dynamic_image` 以保持 PNG 编码确定性；原始字节（GIF）路径必须经 `AssetService::stage_bytes` + `ImportService::import_bytes`（原字节保留、SHA 对原始字节算）。
- 新增搜索行为？统一路径是 `EmojiRepository::list_indexed(options, query, tag_ids)` —— 绝不要在别处写平行 SQL 字符串。锁步参数绑定（SQL `?` 与 params Vec 同步 push）+ `parse_exact_query` 精确语法是唯一做这事的地方；你要加新方法就复刻这个模式。
- 改浮层打开 / 选中文字读取？唯一入口是 `quick_search::show_quick_search`（三条路径共用；读取顺序 capture 目标 → 读选中文字 → show）。选中文字编排只在 `selection_capture.rs`，UIA 细节只在 `platform/windows/selection_reader.rs`。
- 实现历史和各阶段设计笔记：`docs/implementation-plan.md`、`docs/windows-image-clipboard.md`、`docs/system-tray-recent-usage.md`、`docs/search-overlay-global-shortcut.md`、`docs/phase5-clipboard-probe-results.md`、`docs/phase6-groups-tags-trash.md`、`docs/phase7-chat-paste.md`、`docs/phase8-import-optimization.md`、`docs/phase9-multiselect-context-menu.md`、`docs/phase10-search-syntax-filename-tags.md`、`docs/phase11-ui-polish-time-sort.md`（主题按钮图标、移除 logo、按添加/修改时间排序、迁移版本复用修复）、`docs/phase12-settings-layout.md`（设置界面布局重构、Fluent 滚动容器坑）、`docs/phase13-sidebar-groups-redesign.md`（侧边栏分组区重设计：搜索按钮收纳、置顶、`flex:1` 布局、空间压缩）、`docs/phase14-sidebar-divider-flex-fix.md`（Fluent Divider 默认 `flex-grow:1` 挤占分组区空间的修复）、`docs/phase15-selection-search.md`（选中文字自动搜索：UIA + Ctrl+C 兜底、focus_restore E0133 修复、快捷键路径漏捕获修复）、`docs/phase16-gif-animation.md`（GIF 动画全链路：assetProtocol 悬停播放、Win32 clipboard_raw 读写 `"image/gif"`、stage_bytes/import_bytes、追加式 SetClipboardData、开发机剪贴板被占的 probe 记录）。README 有产品级概览；AGENTS.md 是本文件的同步副本（更新本文件后整体覆盖它）。

> **注意**：本文件（`CLAUDE.md`）与 `AGENTS.md` 内容保持一致（更新时同步覆盖），README.md 也在 eb05ad2 同步过产品级描述，三者均不再有「Phase 5 前旧描述」问题。历史细节与决策记录以 `docs/` 各 phase 文档为准；commit 遵循 Conventional Commits。
