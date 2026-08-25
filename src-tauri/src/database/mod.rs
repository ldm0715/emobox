use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use tauri::{AppHandle, Manager};

use crate::{recent::RecentImageRecord, repositories::emoji_repository::EmojiRepository};

const DATABASE_FILE_NAME: &str = "emobox.sqlite3";
const LEGACY_RECENT_FILE_NAME: &str = "recent-images.json";
const ASSETS_DIRECTORY_NAME: &str = "assets";
const EMOJIS_DIRECTORY_NAME: &str = "emojis";
const THUMBNAILS_DIRECTORY_NAME: &str = "thumbnails";

const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("../../migrations/0001_create_emojis.sql"))];

#[derive(Clone)]
pub struct DatabaseState {
    database_path: PathBuf,
    emojis_directory: PathBuf,
    thumbnails_directory: PathBuf,
}

impl DatabaseState {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        let app_data_directory = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
        Self::initialize_at(&app_data_directory)
    }

    fn initialize_at(app_data_directory: &Path) -> Result<Self, String> {
        let assets_directory = app_data_directory.join(ASSETS_DIRECTORY_NAME);
        let emojis_directory = assets_directory.join(EMOJIS_DIRECTORY_NAME);
        let thumbnails_directory = assets_directory.join(THUMBNAILS_DIRECTORY_NAME);
        fs::create_dir_all(&emojis_directory)
            .map_err(|error| format!("无法创建表情素材目录：{error}"))?;
        fs::create_dir_all(&thumbnails_directory)
            .map_err(|error| format!("无法创建缩略图目录：{error}"))?;

        let database_path = app_data_directory.join(DATABASE_FILE_NAME);
        let mut connection = open_connection(&database_path)?;
        run_migrations(&mut connection)?;
        import_legacy_recent_if_present(
            &mut connection,
            &app_data_directory.join(LEGACY_RECENT_FILE_NAME),
        );

        let state = Self {
            database_path,
            emojis_directory,
            thumbnails_directory,
        };
        log::info!(
            "本地数据层已初始化：database={}, emojis={}, thumbnails={}",
            state.database_path.display(),
            state.emojis_directory.display(),
            state.thumbnails_directory.display()
        );
        Ok(state)
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn emojis_directory(&self) -> &Path {
        &self.emojis_directory
    }

    pub fn thumbnails_directory(&self) -> &Path {
        &self.thumbnails_directory
    }

    pub fn connect(&self) -> Result<Connection, String> {
        open_connection(&self.database_path)
    }
}

pub(crate) fn open_connection(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("无法打开本地数据库 {}：{error}", path.display()))?;
    configure_connection(&connection)?;
    Ok(connection)
}

fn configure_connection(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("无法设置数据库等待时间：{error}"))?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|error| format!("无法启用数据库外键约束：{error}"))?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("无法启用数据库 WAL：{error}"))?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| format!("无法设置数据库同步模式：{error}"))?;
    Ok(())
}

pub(crate) fn run_migrations(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );",
        )
        .map_err(|error| format!("无法初始化 migration 记录表：{error}"))?;

    for (version, sql) in MIGRATIONS {
        let applied = connection
            .query_row(
                "SELECT 1 FROM schema_migrations WHERE version = ?1",
                params![version],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| format!("无法读取 migration {version} 状态：{error}"))?
            .is_some();
        if applied {
            continue;
        }

        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始 migration {version}：{error}"))?;
        transaction
            .execute_batch(sql)
            .map_err(|error| format!("执行 migration {version} 失败：{error}"))?;
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, unix_time_millis()],
            )
            .map_err(|error| format!("无法记录 migration {version}：{error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("无法提交 migration {version}：{error}"))?;
        log::info!("已应用数据库 migration {version}");
    }

    Ok(())
}

fn import_legacy_recent_if_present(connection: &mut Connection, path: &Path) {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            log::warn!("无法读取旧最近使用数据 {}：{error}", path.display());
            return;
        }
    };
    let records = match serde_json::from_slice::<Vec<RecentImageRecord>>(&bytes) {
        Ok(records) => records,
        Err(error) => {
            log::warn!("旧最近使用数据格式无效 {}：{error}", path.display());
            return;
        }
    };

    match EmojiRepository::import_legacy_recent(connection, &records, unix_time_millis()) {
        Ok(count) if count > 0 => {
            log::info!("已将 {count} 条旧最近使用记录同步到 SQLite，原 JSON 保留不变");
        }
        Ok(_) => {}
        Err(error) => {
            log::warn!("旧最近使用数据迁移失败，原 JSON 保留不变：{error}");
        }
    }
}

fn unix_time_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::run_migrations;

    #[test]
    fn migrations_are_idempotent_and_create_required_schema() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("first migration run");
        run_migrations(&mut connection).expect("second migration run");

        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("count migrations");
        assert_eq!(migration_count, 1);

        let columns = connection
            .prepare("PRAGMA table_info(emojis)")
            .expect("prepare table info")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("query table info")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect columns");

        for required in [
            "id",
            "source_type",
            "source_path",
            "managed_path",
            "original_filename",
            "file_extension",
            "file_size",
            "sha256",
            "width",
            "height",
            "thumbnail_path",
            "imported_at",
            "indexed_at",
            "last_used_at",
            "usage_count",
            "is_favorite",
            "is_deleted",
        ] {
            assert!(columns.iter().any(|column| column == required));
        }
    }
}
