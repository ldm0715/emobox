use std::path::{Path, PathBuf};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::{
    clipboard, clipboard_collect, database, quick_search,
    repositories::{
        emoji_repository::{EmojiRepository, ListOptions, SearchPage},
        group_repository::{GroupRepository, GroupRow},
        tag_repository::{TagRepository, TagRow},
    },
    scanner,
    services::trash_service::{TrashResult, TrashService},
    shortcut_registry::{
        SetOutcome, ShortcutOwner, ShortcutRegistrationStatus, ShortcutRegistry, ShortcutSyncState,
    },
    target_window, thumbnail,
};

const IMAGE_COPIED_EVENT: &str = "image-copied";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageCopiedPayload {
    item: scanner::IndexedImage,
    outcome: clipboard::ClipboardCopyOutcome,
    recent: crate::recent::RecentImageRecord,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    assets_directory: String,
    emojis_directory: String,
    thumbnails_directory: String,
    supported_formats: Vec<&'static str>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GroupDto {
    pub id: i64,
    pub name: String,
    pub count: i64,
    pub sort_order: i64,
    pub is_pinned: bool,
    pub icon: Option<String>,
}

impl From<GroupRow> for GroupDto {
    fn from(row: GroupRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            count: row.count,
            sort_order: row.sort_order,
            is_pinned: row.is_pinned,
            icon: row.icon,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TagDto {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

impl From<TagRow> for TagDto {
    fn from(row: TagRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            count: row.count,
        }
    }
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub view: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub group_id: Option<i64>,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    #[serde(default)]
    pub favorite_only: bool,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

const DEFAULT_SEARCH_LIMIT: u32 = 200;

#[tauri::command]
pub async fn import_folder(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    path: String,
    skip_perceptual_dedup: Option<bool>,
    target_group_id: Option<i64>,
) -> Result<crate::services::import_service::FolderImportSummary, String> {
    use crate::services::import_service::{ImportContext, ImportService};
    let context = ImportContext {
        database_path: database_state.database_path().to_path_buf(),
        emojis_directory: database_state.emojis_directory().to_path_buf(),
        thumbnails_directory: database_state.thumbnails_directory().to_path_buf(),
    };
    let root = PathBuf::from(path);
    let skip = skip_perceptual_dedup.unwrap_or(false);
    // Phase 22：前端在分组视图内发起导入时携带当前分组 id，全部图片归入。
    let target_group_id = target_group_id.filter(|id| *id > 0);

    let result = tauri::async_runtime::spawn_blocking(move || {
        ImportService::import_folder(&context, &root, skip, target_group_id)
    })
    .await
    .map_err(|error| format!("文件夹导入任务意外中止：{error}"))?;
    quick_search::notify_library_changed(&app);
    result
}

#[tauri::command]
pub async fn import_managed_paths(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    paths: Vec<String>,
    skip_perceptual_dedup: Option<bool>,
    target_group_id: Option<i64>,
) -> Result<crate::services::import_service::ManagedImportSummary, String> {
    use crate::services::import_service::{ImportContext, ImportService};
    let context = ImportContext {
        database_path: database_state.database_path().to_path_buf(),
        emojis_directory: database_state.emojis_directory().to_path_buf(),
        thumbnails_directory: database_state.thumbnails_directory().to_path_buf(),
    };
    let requested_paths = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
    let skip = skip_perceptual_dedup.unwrap_or(false);
    // Phase 22：前端在分组视图内发起导入（文件选择/拖放）时携带当前分组 id。
    let target_group_id = target_group_id.filter(|id| *id > 0);

    let result = tauri::async_runtime::spawn_blocking(move || {
        ImportService::import_paths(&context, &requested_paths, skip, target_group_id)
    })
    .await
    .map_err(|error| format!("图片导入任务意外中止：{error}"))?;
    quick_search::notify_library_changed(&app);
    result
}

#[tauri::command]
pub async fn load_thumbnail(
    database_state: State<'_, database::DatabaseState>,
    emoji_id: i64,
    max_size: Option<u32>,
) -> Result<String, String> {
    let db_state = database_state.inner().clone();
    let requested_size = max_size.unwrap_or(240).clamp(64, 512);

    tauri::async_runtime::spawn_blocking(move || {
        let connection = db_state.connect()?;
        // 按 id 查 DB 里的完整 thumbnail_path，不通过图片路径反查，避免
        // 路径规范化 / Windows 大小写 / 重复路径歧义。
        let row: Option<(Option<String>, String)> = connection
            .query_row(
                // 回收站感知：软删行文件已移到 trash/，thumbnail_path /
                // managed_path 指向旧位置（悬空），要按 list_deleted 同款
                // COALESCE 顺序优先取 trash 路径，否则重启后网格缩略图
                // 报「预览不可用」（运行期被前端内存缓存掩盖）。
                "SELECT COALESCE(trash_thumbnail_path, thumbnail_path),
                        COALESCE(trash_path, managed_path, source_path)
                 FROM emojis WHERE id = ?1",
                [emoji_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| format!("无法查询缩略图路径：{error}"))?;
        let Some((thumbnail_path, original_path)) = row else {
            return Err(format!("找不到表情 id={emoji_id}"));
        };
        thumbnail::load_thumbnail_data_url(
            Path::new(&original_path),
            thumbnail_path.as_deref().map(Path::new),
            requested_size,
        )
    })
    .await
    .map_err(|error| format!("缩略图任务意外中止：{error}"))?
}

#[tauri::command]
pub fn get_storage_info(
    database_state: State<'_, database::DatabaseState>,
) -> Result<StorageInfo, String> {
    let emojis_directory = database_state.emojis_directory();
    let assets_directory = emojis_directory
        .parent()
        .ok_or_else(|| "素材库目录无效。".to_string())?;
    Ok(StorageInfo {
        assets_directory: assets_directory.to_string_lossy().into_owned(),
        emojis_directory: emojis_directory.to_string_lossy().into_owned(),
        thumbnails_directory: database_state
            .thumbnails_directory()
            .to_string_lossy()
            .into_owned(),
        supported_formats: vec!["PNG", "JPG", "JPEG", "GIF", "WebP"],
    })
}

#[tauri::command]
pub fn open_assets_directory(
    database_state: State<'_, database::DatabaseState>,
) -> Result<(), String> {
    crate::services::asset_service::AssetService::open_in_explorer(
        database_state.emojis_directory(),
    )
}

#[tauri::command]
pub fn copy_image_to_clipboard(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    recent_state: State<'_, crate::recent::RecentImagesState>,
    path: String,
) -> Result<clipboard::ClipboardCopyOutcome, String> {
    let mut connection = database_state.connect()?;
    // 先用 path 查 emoji id（用于 SQLite 主源回写 last_used_at / usage_count）
    let indexed_item = EmojiRepository::find_by_source_path(&connection, &path)?;
    let item = match indexed_item {
        Some(item) => item,
        None => recent_state.find_item(&path)?.ok_or_else(|| {
            "这张图片不在当前索引或最近使用记录中，请重新导入后再试。".to_string()
        })?,
    };

    // 通过 path 反查 id
    let emoji_id: Option<i64> = connection
        .query_row(
            "SELECT id FROM emojis WHERE source_path = ?1 AND is_deleted = 0 LIMIT 1",
            [&path],
            |row| row.get(0),
        )
        .ok();

    let outcome = clipboard::copy_image(&app, Path::new(&item.path))?;

    // 写入 SQLite 主源（用户要求统一）
    if let Some(id) = emoji_id {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
            .unwrap_or_default();
        EmojiRepository::record_image_used(&mut connection, id, now_ms)
            .unwrap_or_else(|e| log::warn!("写入最近使用计数失败：{e}"));
    }

    // 保留 JSON 同步（兼容旧逻辑，但不作为主源）
    let recent = recent_state.record(item.clone()).unwrap_or_else(|e| {
        log::warn!("JSON 最近使用记录失败：{e}");
        crate::recent::RecentImageRecord {
            item: item.clone(),
            last_used_at: 0,
            use_count: 0,
            group_ids: Vec::new(),
            tag_ids: Vec::new(),
        }
    });

    let payload = ImageCopiedPayload {
        item,
        outcome: outcome.clone(),
        recent,
    };
    if let Err(error) = app.emit_to("main", IMAGE_COPIED_EVENT, payload) {
        log::warn!("图片已复制，但无法通知主窗口更新最近使用：{error}");
    }

    Ok(outcome)
}

#[tauri::command]
pub fn get_recent_images(
    database_state: State<'_, database::DatabaseState>,
) -> Result<Vec<crate::recent::RecentImageRecord>, String> {
    // 走 SQLite 主源（用户要求）
    let connection = database_state.connect()?;
    let mut records = EmojiRepository::search_recent(&connection, 50)?;
    EmojiRepository::fill_relations_for_recent(&connection, &mut records)?;
    Ok(records)
}

#[tauri::command]
pub fn update_quick_search_shortcut(
    app: AppHandle,
    registry: State<'_, ShortcutRegistry>,
    shortcut: String,
) -> Result<SetOutcome, String> {
    Ok(registry.try_set(&app, ShortcutOwner::QuickSearch, &shortcut))
}

#[tauri::command]
pub fn get_quick_search_shortcut_status(
    registry: State<'_, ShortcutRegistry>,
) -> Result<ShortcutRegistrationStatus, String> {
    let display = registry.current_display(ShortcutOwner::QuickSearch);
    let state = registry.sync_state();
    Ok(ShortcutRegistrationStatus {
        shortcut: display,
        registered: matches!(state, ShortcutSyncState::Synced),
    })
}

#[tauri::command]
pub fn update_clipboard_collect_shortcut(
    app: AppHandle,
    registry: State<'_, ShortcutRegistry>,
    shortcut: String,
) -> Result<SetOutcome, String> {
    Ok(registry.try_set(&app, ShortcutOwner::ClipboardCollect, &shortcut))
}

#[tauri::command]
pub fn get_clipboard_collect_shortcut_status(
    registry: State<'_, ShortcutRegistry>,
) -> Result<ShortcutRegistrationStatus, String> {
    let display = registry.current_display(ShortcutOwner::ClipboardCollect);
    let state = registry.sync_state();
    Ok(ShortcutRegistrationStatus {
        shortcut: display,
        registered: matches!(state, ShortcutSyncState::Synced),
    })
}

#[tauri::command]
pub fn show_quick_search(app: AppHandle) -> Result<(), String> {
    quick_search::show_quick_search(&app)
}

#[tauri::command]
pub fn hide_quick_search(app: AppHandle) -> Result<(), String> {
    quick_search::hide_quick_search(&app)
}

/// Phase 15：前端把「选中文字自动搜索」开关推送到 Rust（localStorage 是
/// 事实源，Rust 侧只做内存镜像）。启动竞态：前端尚未推送时按默认 true。
#[tauri::command]
pub fn set_selection_search_enabled(
    state: State<'_, crate::selection_capture::SelectionSearchState>,
    enabled: bool,
) -> Result<(), String> {
    state.set_enabled(enabled);
    Ok(())
}

#[tauri::command]
pub async fn collect_image_from_clipboard(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    skip_perceptual_dedup: Option<bool>,
    download_web_gif: Option<bool>,
    target_group_id: Option<i64>,
) -> Result<clipboard_collect::ClipboardCollectOutcome, String> {
    let db_state = database_state.inner().clone();
    let skip = skip_perceptual_dedup.unwrap_or(false);
    let download_web_gif = download_web_gif.unwrap_or(false);
    // Phase 22：前端在分组视图内收藏时携带当前分组 id（发起那一刻的视图）。
    let target_group_id = target_group_id.filter(|id| *id > 0);
    let app_for_task = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        clipboard_collect::collect_image_from_clipboard(
            &app_for_task,
            &db_state,
            skip,
            download_web_gif,
            target_group_id,
        )
    })
    .await
    .map_err(|error| format!("剪贴板收藏任务意外中止：{error}"))?;
    // 只有真正落库（导入或重复）才通知浮层刷新。
    match &outcome {
        clipboard_collect::ClipboardCollectOutcome::Imported { .. }
        | clipboard_collect::ClipboardCollectOutcome::Duplicate { .. } => {
            quick_search::notify_library_changed(&app);
        }
        _ => {}
    }
    Ok(outcome)
}

// ---- 第六阶段 commands ----

#[tauri::command]
pub fn list_groups(
    database_state: State<'_, database::DatabaseState>,
) -> Result<Vec<GroupDto>, String> {
    let connection = database_state.connect()?;
    let groups = GroupRepository::list_groups(&connection)?;
    Ok(groups.into_iter().map(GroupDto::from).collect())
}

#[tauri::command]
pub fn create_group(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    name: String,
) -> Result<GroupDto, String> {
    let mut connection = database_state.connect()?;
    let row = GroupRepository::create_group(&mut connection, &name)?;
    quick_search::notify_library_changed(&app);
    Ok(GroupDto::from(row))
}

#[tauri::command]
pub fn rename_group(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    id: i64,
    name: String,
) -> Result<GroupDto, String> {
    let mut connection = database_state.connect()?;
    let row = GroupRepository::rename_group(&mut connection, id, &name)?;
    quick_search::notify_library_changed(&app);
    Ok(GroupDto::from(row))
}

#[tauri::command]
pub fn delete_group(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    id: i64,
) -> Result<(), String> {
    let mut connection = database_state.connect()?;
    GroupRepository::delete_group(&mut connection, id)?;
    quick_search::notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn set_group_pinned(
    database_state: State<'_, database::DatabaseState>,
    id: i64,
    pinned: bool,
) -> Result<(), String> {
    let connection = database_state.connect()?;
    GroupRepository::set_group_pinned(&connection, id, pinned)?;
    Ok(())
}

#[tauri::command]
pub fn set_group_icon(
    database_state: State<'_, database::DatabaseState>,
    id: i64,
    icon: Option<String>,
) -> Result<(), String> {
    let connection = database_state.connect()?;
    GroupRepository::set_group_icon(&connection, id, icon.as_deref())?;
    Ok(())
}

#[tauri::command]
pub fn list_tags(
    database_state: State<'_, database::DatabaseState>,
) -> Result<Vec<TagDto>, String> {
    let connection = database_state.connect()?;
    let tags = TagRepository::list_tags(&connection)?;
    Ok(tags.into_iter().map(TagDto::from).collect())
}

#[tauri::command]
pub fn create_tag(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    name: String,
) -> Result<TagDto, String> {
    let mut connection = database_state.connect()?;
    let row = TagRepository::create_tag(&mut connection, &name)?;
    quick_search::notify_library_changed(&app);
    Ok(TagDto::from(row))
}

#[tauri::command]
pub fn rename_tag(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    id: i64,
    name: String,
) -> Result<TagDto, String> {
    let mut connection = database_state.connect()?;
    let row = TagRepository::rename_tag(&mut connection, id, &name)?;
    quick_search::notify_library_changed(&app);
    Ok(TagDto::from(row))
}

#[tauri::command]
pub fn delete_tag(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    id: i64,
) -> Result<(), String> {
    let mut connection = database_state.connect()?;
    TagRepository::delete_tag(&mut connection, id)?;
    quick_search::notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn add_emojis_to_group(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    group_id: i64,
    emoji_ids: Vec<i64>,
) -> Result<(), String> {
    let mut connection = database_state.connect()?;
    EmojiRepository::add_to_group(&mut connection, group_id, &emoji_ids)?;
    EmojiRepository::touch_updated_at(&connection, &emoji_ids)?;
    quick_search::notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn remove_emojis_from_group(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    group_id: i64,
    emoji_ids: Vec<i64>,
) -> Result<(), String> {
    let mut connection = database_state.connect()?;
    EmojiRepository::remove_from_group(&mut connection, group_id, &emoji_ids)?;
    EmojiRepository::touch_updated_at(&connection, &emoji_ids)?;
    quick_search::notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn add_tags_to_emojis(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    tag_ids: Vec<i64>,
    emoji_ids: Vec<i64>,
) -> Result<(), String> {
    let mut connection = database_state.connect()?;
    EmojiRepository::add_tags(&mut connection, &tag_ids, &emoji_ids)?;
    // 标签操作只在用户命令层刷新（导入自动打标签 / 启动回填走内部路径，不刷新）。
    EmojiRepository::touch_updated_at(&connection, &emoji_ids)?;
    quick_search::notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn remove_tags_from_emojis(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    tag_ids: Vec<i64>,
    emoji_ids: Vec<i64>,
) -> Result<(), String> {
    let mut connection = database_state.connect()?;
    EmojiRepository::remove_tags(&mut connection, &tag_ids, &emoji_ids)?;
    EmojiRepository::touch_updated_at(&connection, &emoji_ids)?;
    quick_search::notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn set_emojis_favorite(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    ids: Vec<i64>,
    is_favorite: bool,
) -> Result<(), String> {
    let mut connection = database_state.connect()?;
    EmojiRepository::set_favorite_for_ids(&mut connection, &ids, is_favorite)?;
    EmojiRepository::touch_updated_at(&connection, &ids)?;
    quick_search::notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn search_emojis(
    database_state: State<'_, database::DatabaseState>,
    options: SearchOptions,
) -> Result<SearchPage, String> {
    let connection = database_state.connect()?;
    let limit = options.limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    let offset = options.offset.unwrap_or(0);
    let list_options = ListOptions {
        view: &options.view,
        group_id: options.group_id,
        favorite_only: options.favorite_only,
        sort: options.sort,
        limit,
        offset,
    };
    EmojiRepository::list_indexed(&connection, &list_options, &options.query, &options.tag_ids)
}

#[tauri::command]
pub async fn soft_delete_to_trash(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    ids: Vec<i64>,
) -> Result<TrashResult, String> {
    let state = database_state.inner().clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || TrashService::soft_delete(&state, &ids))
            .await
            .map_err(|error| format!("软删任务意外中止：{error}"))?;
    quick_search::notify_library_changed(&app);
    result
}

#[tauri::command]
pub async fn restore_from_trash(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    ids: Vec<i64>,
) -> Result<TrashResult, String> {
    let state = database_state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || TrashService::restore(&state, &ids))
        .await
        .map_err(|error| format!("恢复任务意外中止：{error}"))?;
    quick_search::notify_library_changed(&app);
    result
}

#[tauri::command]
pub async fn permanently_delete_emojis(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    ids: Vec<i64>,
) -> Result<TrashResult, String> {
    let state = database_state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        TrashService::permanently_delete(&state, &ids)
    })
    .await
    .map_err(|error| format!("永久删除任务意外中止：{error}"))?;
    quick_search::notify_library_changed(&app);
    result
}

#[tauri::command]
pub async fn empty_trash(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
) -> Result<TrashResult, String> {
    let state = database_state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || TrashService::empty_trash(&state))
        .await
        .map_err(|error| format!("清空回收站任务意外中止：{error}"))?;
    quick_search::notify_library_changed(&app);
    result
}

#[tauri::command]
pub fn list_deleted_emojis(
    database_state: State<'_, database::DatabaseState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<SearchPage, String> {
    let connection = database_state.connect()?;
    EmojiRepository::list_deleted(
        &connection,
        limit.unwrap_or(DEFAULT_SEARCH_LIMIT),
        offset.unwrap_or(0),
    )
}

#[tauri::command]
pub fn show_in_explorer(_app: AppHandle, path: String) -> Result<(), String> {
    show_path_in_explorer(Path::new(&path))
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    open_url_in_browser(&url)
}

#[tauri::command]
pub fn set_close_to_tray(
    state: State<'_, crate::close_behavior::CloseBehaviorState>,
    minimize_to_tray: Option<bool>,
) -> Result<(), String> {
    // None = 未选择（点关闭按钮时前端弹询问窗）；Some(true/false) = 已记住的选择。
    state.set(minimize_to_tray);
    Ok(())
}

#[tauri::command]
pub fn exit_application(app: AppHandle) -> Result<(), String> {
    // 与托盘「退出」同语义：整进程退出，隐藏的 quick-search 窗口一并销毁。
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn paste_to_target_window(
    state: State<'_, target_window::TargetWindowState>,
) -> crate::services::chat_paste_service::PasteResult {
    // 非 Windows 平台直接返回 disabled 走 "clipboard only" 路径，
    // 保持前端调用形态不变。
    #[cfg(not(windows))]
    {
        return crate::services::chat_paste_service::PasteResult::disabled();
    }

    #[cfg(windows)]
    {
        let Some(target) = state.peek() else {
            return crate::services::chat_paste_service::PasteResult::clipboard_only(
                "noTarget", None,
            );
        };
        let result = crate::services::chat_paste_service::ChatPasteService::paste(&target);
        // 会话内连续选择：成功时保留目标。失败时清空，避免下一次选择
        // 反复尝试同一个已失效的 HWND。
        if result.kind != crate::services::chat_paste_service::PasteKind::Success {
            log::debug!("自动粘贴降级为仅复制：{}", result.reason);
            state.clear();
        }
        result
    }
}

fn show_path_in_explorer(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("路径不存在：{}", path.display()));
    }
    #[cfg(target_os = "windows")]
    {
        let arg = if path.is_file() {
            format!("/select,{}", path.display())
        } else {
            path.display().to_string()
        };
        std::process::Command::new("explorer.exe")
            .arg(arg)
            .spawn()
            .map_err(|error| format!("无法打开资源管理器：{error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let target = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|error| format!("无法打开路径：{error}"))?;
        Ok(())
    }
}

/// 仅放行 https + 白名单主机：关于页的依赖外链是唯一调用方，
/// 不把任意 URL 交给系统浏览器。
fn open_url_in_browser(url: &str) -> Result<(), String> {
    const ALLOWED_HOSTS: [&str; 1] = ["github.com"];
    let rest = url
        .strip_prefix("https://")
        .ok_or_else(|| format!("仅支持 https 链接：{url}"))?;
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    // 去掉可能存在的 userinfo 与端口，只比对主机名。
    let host = authority
        .rsplit('@')
        .next()
        .unwrap_or(authority)
        .split(':')
        .next()
        .unwrap_or(authority);
    if !ALLOWED_HOSTS.contains(&host) {
        return Err(format!("不允许打开的主机：{host}"));
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(url)
            .spawn()
            .map_err(|error| format!("无法打开浏览器：{error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|error| format!("无法打开浏览器：{error}"))?;
        Ok(())
    }
}
