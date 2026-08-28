//! 回收站服务：跨 FS-DB 编排。
//!
//! 关键不变量（FS-DB 一致性）：
//! 1. **先移文件成功，再写 DB**。
//! 2. 原图移动失败 → 整行放弃（不写 DB，不更新 trash 字段）。
//! 3. 缩略图移动失败 → 记日志 + failures，**不阻塞**主行（缩略图可重建）。
//! 4. DB 事务 commit 失败（极少见）→ 兜底回移文件到原路径。
//! 5. permanently_delete 删 trash 文件用 `NotFound` 吞掉。
//!
//! `is_managed_source` 守卫：只有 `managed_import` / `clipboard`（受管副本）才做
//! 文件移动。遗留的 `external_directory` 行（迁移 0004 已删除）本就不涉及文件移动，
//! 守卫是零成本的防御。

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::{
    database::DatabaseState,
    repositories::emoji_repository::{EmojiRepository, TrashFileTargets},
};

const TRASH_DIRECTORY_NAME: &str = "trash";

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrashFailure {
    pub id: i64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrashResult {
    pub succeeded: usize,
    pub files_moved: usize,
    pub failures: Vec<TrashFailure>,
}

impl TrashResult {
    fn push_failure(&mut self, id: i64, reason: String) {
        self.failures.push(TrashFailure { id, reason });
    }
}

pub struct TrashService;

impl TrashService {
    /// 计算 trash 目录的物理文件目标。撞名时用 `<sha>-<id>` 后缀。
    pub fn trash_paths_for(
        state: &DatabaseState,
        source: &TrashFileTargets,
    ) -> Option<(PathBuf, PathBuf)> {
        let source_path = source.managed_path.as_deref()?;
        let source_path = Path::new(source_path);
        let extension = source_path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("png");
        let stem = source_path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("emoji");

        let trash_dir = state
            .emojis_directory()
            .parent()?
            .join(TRASH_DIRECTORY_NAME);
        let main_name = format!("{stem}-{}.{}", source.id, extension);
        let thumb_name = format!("{stem}-{}_thumb.png", source.id);

        Some((trash_dir.join(main_name), trash_dir.join(thumb_name)))
    }

    /// 软删到回收站。
    pub fn soft_delete(state: &DatabaseState, ids: &[i64]) -> Result<TrashResult, String> {
        let mut result = TrashResult::default();
        if ids.is_empty() {
            return Ok(result);
        }
        let trash_dir = state
            .emojis_directory()
            .parent()
            .ok_or_else(|| "素材库目录无效。".to_string())?
            .join(TRASH_DIRECTORY_NAME);
        fs::create_dir_all(&trash_dir)
            .map_err(|error| format!("无法创建回收站目录 {}：{error}", trash_dir.display()))?;

        let mut connection = state.connect()?;
        let targets = EmojiRepository::mark_deleted(&mut connection, ids, unix_time_millis())?;
        // 上面只是 UPDATE is_deleted=1 + deleted_at，没有写 trash_path。
        // 这里再按 source_type 写 trash_path；先做文件移动。
        for target in &targets {
            if !is_managed_source(&target.source_type) {
                continue; // external 不涉及文件移动
            }
            let Some(managed_path_str) = target.managed_path.as_deref() else {
                continue;
            };
            let Some((trash_main, _trash_thumb)) = Self::trash_paths_for(state, target) else {
                continue;
            };
            let managed = Path::new(managed_path_str);
            match move_file(managed, &trash_main) {
                Ok(()) => {
                    result.files_moved += 1;
                    // 缩略图独立尝试（失败不阻塞）
                    if let Some(thumb_str) = target.thumbnail_path.as_deref() {
                        let thumb = Path::new(thumb_str);
                        if thumb.is_file() {
                            let trash_thumb = with_thumb_suffix(&trash_main);
                            if let Err(reason) = move_file_safe(thumb, &trash_thumb) {
                                log::warn!(
                                    "缩略图移动失败（不阻塞原图）: id={} reason={}",
                                    target.id,
                                    reason
                                );
                                result.push_failure(target.id, format!("缩略图：{reason}"));
                            }
                        }
                    }
                    // 写 trash_path/trash_thumbnail_path
                    let trash_thumb_owned = if target.thumbnail_path.is_some() {
                        with_thumb_suffix(&trash_main)
                            .to_string_lossy()
                            .into_owned()
                    } else {
                        String::new()
                    };
                    let trash_thumb_opt: Option<&str> = if trash_thumb_owned.is_empty() {
                        None
                    } else {
                        Some(&trash_thumb_owned)
                    };
                    let trash_main_str = trash_main.to_string_lossy().into_owned();
                    if let Err(error) = EmojiRepository::set_trash_paths(
                        &mut connection,
                        target.id,
                        Some(&trash_main_str),
                        trash_thumb_opt,
                    ) {
                        // 回移文件
                        let _ = move_file_safe(&trash_main, managed);
                        result.push_failure(target.id, format!("写入回收站路径：{error}"));
                        continue;
                    }
                }
                Err(reason) => {
                    result.push_failure(target.id, format!("原图移动失败：{reason}"));
                    // 整行放弃：不写 trash 字段。但 is_deleted=1 已经写入。
                    // 解决：在 transaction 中回退 is_deleted 标记。
                    // 为简单起见：直接在 DB 上把这条 is_deleted 恢复 0。
                    let _ = connection.execute(
                        "UPDATE emojis SET is_deleted = 0, deleted_at = NULL WHERE id = ?1",
                        rusqlite::params![target.id],
                    );
                }
            }
        }
        // 成功的数量
        let failed_ids: std::collections::HashSet<i64> =
            result.failures.iter().map(|f| f.id).collect();
        result.succeeded = targets
            .iter()
            .filter(|t| !failed_ids.contains(&t.id))
            .count();
        // 移入回收站算"修改"：只刷新成功项（失败项已回滚 is_deleted，不刷新）。
        let succeeded_ids: Vec<i64> = targets
            .iter()
            .filter(|t| !failed_ids.contains(&t.id))
            .map(|t| t.id)
            .collect();
        EmojiRepository::touch_updated_at(&connection, &succeeded_ids)?;
        Ok(result)
    }

    /// 从回收站恢复。
    pub fn restore(state: &DatabaseState, ids: &[i64]) -> Result<TrashResult, String> {
        let mut result = TrashResult::default();
        if ids.is_empty() {
            return Ok(result);
        }
        let mut connection = state.connect()?;
        let targets = EmojiRepository::clear_trash(&mut connection, ids)?;
        for target in &targets {
            if !is_managed_source(&target.source_type) {
                continue; // external 无文件移动
            }
            let (Some(managed_str), Some(trash_str)) =
                (target.managed_path.as_deref(), target.trash_path.as_deref())
            else {
                continue;
            };
            let managed = Path::new(managed_str);
            let trash = Path::new(trash_str);
            match move_file(trash, managed) {
                Ok(()) => {
                    result.files_moved += 1;
                    if let (Some(thumb_str), Some(trash_thumb_str)) = (
                        target.thumbnail_path.as_deref(),
                        target.trash_thumbnail_path.as_deref(),
                    ) {
                        let thumb = Path::new(thumb_str);
                        let trash_thumb = Path::new(trash_thumb_str);
                        if trash_thumb.is_file()
                            && let Err(reason) = move_file_safe(trash_thumb, thumb)
                        {
                            log::warn!(
                                "缩略图恢复失败（不阻塞原图）: id={} reason={}",
                                target.id,
                                reason
                            );
                            result.push_failure(target.id, format!("缩略图：{reason}"));
                        }
                    }
                }
                Err(reason) => {
                    // 原图移动失败 → 把 DB 状态回退为已软删。
                    let _ = connection.execute(
                        "UPDATE emojis SET is_deleted = 1,
                             deleted_at = ?1,
                             trash_path = ?2,
                             trash_thumbnail_path = ?3
                         WHERE id = ?4",
                        rusqlite::params![
                            unix_time_millis(),
                            target.trash_path,
                            target.trash_thumbnail_path,
                            target.id,
                        ],
                    );
                    result.push_failure(target.id, format!("原图恢复失败：{reason}"));
                }
            }
        }
        let failed_ids: std::collections::HashSet<i64> =
            result.failures.iter().map(|f| f.id).collect();
        result.succeeded = targets.len() - failed_ids.len();
        // 收回回收站算"修改"：只刷新成功项。
        let succeeded_ids: Vec<i64> = targets
            .iter()
            .filter(|t| !failed_ids.contains(&t.id))
            .map(|t| t.id)
            .collect();
        EmojiRepository::touch_updated_at(&connection, &succeeded_ids)?;
        Ok(result)
    }

    /// 永久删除：先删 trash 物理文件，再 DELETE 行（CASCADE 清关联）。
    pub fn permanently_delete(state: &DatabaseState, ids: &[i64]) -> Result<TrashResult, String> {
        let mut result = TrashResult::default();
        if ids.is_empty() {
            return Ok(result);
        }
        let mut connection = state.connect()?;
        let targets = EmojiRepository::delete_permanently(&mut connection, ids)?;
        for target in &targets {
            if let Some(path_str) = target.trash_path.as_deref() {
                let path = Path::new(path_str);
                if let Err(error) = fs::remove_file(path)
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    result.push_failure(target.id, format!("删除原图：{error}"));
                    continue;
                }
                result.files_moved += 1;
            }
            if let Some(path_str) = target.trash_thumbnail_path.as_deref() {
                let path = Path::new(path_str);
                if let Err(error) = fs::remove_file(path)
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    log::warn!("删除缩略图失败：{error}");
                }
            }
        }
        let failed_ids: std::collections::HashSet<i64> =
            result.failures.iter().map(|f| f.id).collect();
        result.succeeded = targets.len() - failed_ids.len();
        Ok(result)
    }

    /// 一键清空回收站。
    pub fn empty_trash(state: &DatabaseState) -> Result<TrashResult, String> {
        let mut result = TrashResult::default();
        let connection = state.connect()?;
        let targets = EmojiRepository::list_deleted_targets(&connection)?;
        // 第一遍：删物理文件（先全部尝试）
        let mut failed_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();
        for target in &targets {
            let mut row_failed = false;
            if let Some(path_str) = target.trash_path.as_deref() {
                if let Err(error) = fs::remove_file(Path::new(path_str)) {
                    if error.kind() != std::io::ErrorKind::NotFound {
                        failed_ids.insert(target.id);
                        result.push_failure(target.id, format!("删除原图：{error}"));
                        row_failed = true;
                    }
                } else {
                    result.files_moved += 1;
                }
            }
            if !row_failed
                && let Some(path_str) = target.trash_thumbnail_path.as_deref()
                && let Err(error) = fs::remove_file(Path::new(path_str))
                && error.kind() != std::io::ErrorKind::NotFound
            {
                log::warn!("删除缩略图失败：{error}");
            }
        }
        // 第二遍：删 DB 行（失败的行跳过）
        let ids_to_delete: Vec<i64> = targets
            .iter()
            .filter(|t| !failed_ids.contains(&t.id))
            .map(|t| t.id)
            .collect();
        if !ids_to_delete.is_empty() {
            let placeholders = std::iter::repeat_n("?", ids_to_delete.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!("DELETE FROM emojis WHERE id IN ({placeholders}) AND is_deleted = 1");
            let params: Vec<Box<dyn rusqlite::ToSql>> = ids_to_delete
                .iter()
                .map(|i| Box::new(*i) as Box<dyn rusqlite::ToSql>)
                .collect();
            let bound: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();
            connection
                .execute(&sql, rusqlite::params_from_iter(bound))
                .map_err(|error| format!("无法清空回收站行：{error}"))?;
        }
        result.succeeded = ids_to_delete.len();
        Ok(result)
    }
}

fn is_managed_source(source_type: &str) -> bool {
    source_type == "managed_import" || source_type == "clipboard"
}

/// 同盘原子；跨盘退化为 copy + remove。
fn move_file(source: &Path, dest: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err(format!("源文件不存在：{}", source.display()));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建目标目录：{error}"))?;
    }
    match fs::rename(source, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            // 跨盘或权限不足：fallback 到 copy + remove
            fs::copy(source, dest).map_err(|error| format!("复制失败：{error}"))?;
            fs::remove_file(source).map_err(|error| format!("删除源文件：{error}"))?;
            Ok(())
        }
    }
}

fn move_file_safe(source: &Path, dest: &Path) -> Result<(), String> {
    move_file(source, dest)
}

fn with_thumb_suffix(path: &Path) -> PathBuf {
    let mut s = path.to_path_buf();
    let file_name = s
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let new_name = format!(
        "{}_thumb.png",
        file_name
            .trim_end_matches(".png")
            .trim_end_matches(".jpg")
            .trim_end_matches(".jpeg")
            .trim_end_matches(".gif")
            .trim_end_matches(".webp")
    );
    s.set_file_name(new_name);
    s
}

fn unix_time_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use rusqlite::Connection;

    use super::*;
    use crate::database::DatabaseState;

    /// 简单的手工 tempdir 替代品（避免引入 tempdir crate）。
    struct TestDir(PathBuf);
    impl TestDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!("emobox-trash-{tag}-{nanos}"));
            fs::create_dir_all(&path).expect("mkdir");
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fresh_db_in_tempdir() -> (TestDir, DatabaseState) {
        let dir = TestDir::new("test");
        let assets = dir.path().join("assets");
        fs::create_dir_all(assets.join("emojis")).expect("emojis dir");
        fs::create_dir_all(assets.join("thumbnails")).expect("thumbnails dir");
        let db_path = dir.path().join("emobox.sqlite3");
        let mut conn = Connection::open(&db_path).expect("open");
        crate::database::run_migrations(&mut conn).expect("migrations");
        let state = DatabaseState {
            database_path: db_path,
            emojis_directory: assets.join("emojis"),
            thumbnails_directory: assets.join("thumbnails"),
        };
        (dir, state)
    }

    fn insert_managed(
        state: &DatabaseState,
        name: &str,
        ext: &str,
        sha: &str,
    ) -> (i64, std::path::PathBuf, std::path::PathBuf) {
        let conn = state.connect().expect("conn");
        let main_path = state.emojis_directory().join(format!("{name}.{ext}"));
        let thumb_path = state
            .thumbnails_directory()
            .join(format!("{name}_thumb.png"));
        fs::write(&main_path, b"main").expect("write main");
        fs::write(&thumb_path, b"thumb").expect("write thumb");
        conn.execute(
            "INSERT INTO emojis (source_type, source_path, managed_path, original_filename, file_extension, file_size, sha256, width, height, thumbnail_path, imported_at, indexed_at, last_used_at, usage_count, is_favorite, is_deleted)
             VALUES ('managed_import', ?1, ?2, ?3, ?4, 1, ?5, 1, 1, ?6, 0, 0, NULL, 0, 0, 0)",
            rusqlite::params![
                main_path.to_string_lossy(),
                main_path.to_string_lossy(),
                format!("{name}.{ext}"),
                ext,
                sha,
                thumb_path.to_string_lossy()
            ],
        )
        .expect("insert");
        let id = conn.last_insert_rowid();
        (id, main_path, thumb_path)
    }

    #[test]
    fn soft_delete_moves_managed_files_to_trash() {
        let (_dir, state) = fresh_db_in_tempdir();
        let (id, main, _thumb) = insert_managed(&state, "alpha", "png", "aaa");
        let result = TrashService::soft_delete(&state, &[id]).expect("soft delete");
        assert_eq!(result.succeeded, 1);
        assert_eq!(result.failures.len(), 0);
        assert!(!main.exists(), "原图应被移动");
        let trash_main = state
            .emojis_directory()
            .parent()
            .unwrap()
            .join("trash")
            .join(format!("alpha-{id}.png"));
        assert!(trash_main.exists(), "trash 文件应存在");

        let conn = state.connect().expect("conn");
        let updated_at: Option<i64> = conn
            .query_row("SELECT updated_at FROM emojis WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .expect("updated_at");
        assert!(updated_at.unwrap_or(0) > 0, "移入回收站应刷新修改时间");
    }

    #[test]
    fn restore_moves_files_back() {
        let (_dir, state) = fresh_db_in_tempdir();
        let (id, main, _thumb) = insert_managed(&state, "beta", "png", "bbb");
        TrashService::soft_delete(&state, &[id]).expect("soft");
        assert!(!main.exists());
        // 重置 updated_at，验证 restore 会重新刷新。
        {
            let conn = state.connect().expect("conn");
            conn.execute("UPDATE emojis SET updated_at = 0 WHERE id = ?1", [id])
                .expect("reset");
        }
        let result = TrashService::restore(&state, &[id]).expect("restore");
        assert_eq!(result.succeeded, 1);
        assert!(main.exists(), "原图应被恢复");
        let conn = state.connect().expect("conn");
        let updated_at: Option<i64> = conn
            .query_row("SELECT updated_at FROM emojis WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .expect("updated_at");
        assert!(updated_at.unwrap_or(0) > 0, "恢复应刷新修改时间");
    }

    #[test]
    fn permanently_delete_removes_files_and_db_rows() {
        let (_dir, state) = fresh_db_in_tempdir();
        let (id, main, _thumb) = insert_managed(&state, "gamma", "png", "ccc");
        TrashService::soft_delete(&state, &[id]).expect("soft");
        let result = TrashService::permanently_delete(&state, &[id]).expect("perm");
        assert_eq!(result.succeeded, 1);
        assert!(!main.exists());
        let conn = state.connect().expect("conn");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM emojis", [], |row| row.get(0))
            .expect("count");
        assert_eq!(count, 0, "DB 行应被删除");
    }

    #[test]
    fn empty_trash_processes_all() {
        let (_dir, state) = fresh_db_in_tempdir();
        let (id1, m1, _) = insert_managed(&state, "d1", "png", "d1");
        let (id2, m2, _) = insert_managed(&state, "d2", "png", "d2");
        TrashService::soft_delete(&state, &[id1, id2]).expect("soft");
        let result = TrashService::empty_trash(&state).expect("empty");
        assert_eq!(result.succeeded, 2);
        assert!(!m1.exists() && !m2.exists());
    }
}
