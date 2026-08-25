use rusqlite::{Connection, OptionalExtension, params};

use crate::{recent::RecentImageRecord, scanner::IndexedImage};

pub struct EmojiRepository;

pub struct NewManagedEmoji<'a> {
    pub source_type: &'a str,
    pub source_path: &'a str,
    pub managed_path: &'a str,
    pub original_filename: &'a str,
    pub file_extension: &'a str,
    pub file_size: u64,
    pub sha256: &'a str,
    pub width: u32,
    pub height: u32,
    pub thumbnail_path: &'a str,
    pub imported_at: i64,
    pub indexed_at: i64,
    pub is_favorite: bool,
}

impl EmojiRepository {
    pub fn import_legacy_recent(
        connection: &mut Connection,
        records: &[RecentImageRecord],
        indexed_at: i64,
    ) -> Result<usize, String> {
        if records.is_empty() {
            return Ok(0);
        }

        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始最近使用数据迁移事务：{error}"))?;
        let mut imported_count = 0usize;

        {
            let mut statement = transaction
                .prepare_cached(
                    r#"
                    INSERT INTO emojis (
                        source_type, source_path, managed_path, original_filename,
                        file_extension, file_size, sha256, width, height,
                        thumbnail_path, imported_at, indexed_at, last_used_at,
                        usage_count, is_favorite, is_deleted
                    ) VALUES (
                        'external_directory', ?1, NULL, ?2,
                        ?3, ?4, NULL, ?5, ?6,
                        NULL, NULL, ?7, ?8,
                        ?9, 0, 0
                    )
                    ON CONFLICT(source_path) DO UPDATE SET
                        original_filename = excluded.original_filename,
                        file_extension = excluded.file_extension,
                        file_size = excluded.file_size,
                        width = excluded.width,
                        height = excluded.height,
                        indexed_at = MAX(emojis.indexed_at, excluded.indexed_at),
                        last_used_at = CASE
                            WHEN emojis.last_used_at IS NULL THEN excluded.last_used_at
                            ELSE MAX(emojis.last_used_at, excluded.last_used_at)
                        END,
                        usage_count = MAX(emojis.usage_count, excluded.usage_count),
                        is_deleted = 0
                    "#,
                )
                .map_err(|error| format!("无法准备最近使用数据迁移语句：{error}"))?;

            for record in records {
                statement
                    .execute(params![
                        record.item.path,
                        record.item.name,
                        record.item.extension,
                        to_i64(record.item.size_bytes),
                        i64::from(record.item.width),
                        i64::from(record.item.height),
                        indexed_at,
                        to_i64(record.last_used_at),
                        to_i64(record.use_count),
                    ])
                    .map_err(|error| {
                        format!("无法迁移最近使用图片 {}：{error}", record.item.path)
                    })?;
                imported_count += 1;
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("无法提交最近使用数据迁移：{error}"))?;
        Ok(imported_count)
    }

    pub fn upsert_external_scan(
        connection: &mut Connection,
        items: &[IndexedImage],
        indexed_at: i64,
    ) -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始外部目录索引事务：{error}"))?;

        {
            let mut statement = transaction
                .prepare_cached(
                    r#"
                    INSERT INTO emojis (
                        source_type, source_path, managed_path, original_filename,
                        file_extension, file_size, sha256, width, height,
                        thumbnail_path, imported_at, indexed_at, last_used_at,
                        usage_count, is_favorite, is_deleted
                    ) VALUES (
                        'external_directory', ?1, NULL, ?2,
                        ?3, ?4, NULL, ?5, ?6,
                        NULL, NULL, ?7, NULL,
                        0, 0, 0
                    )
                    ON CONFLICT(source_path) DO UPDATE SET
                        original_filename = excluded.original_filename,
                        file_extension = excluded.file_extension,
                        file_size = excluded.file_size,
                        width = excluded.width,
                        height = excluded.height,
                        indexed_at = excluded.indexed_at,
                        is_deleted = 0
                    "#,
                )
                .map_err(|error| format!("无法准备外部目录索引语句：{error}"))?;

            for item in items {
                statement
                    .execute(params![
                        item.path,
                        item.name,
                        item.extension,
                        to_i64(item.size_bytes),
                        i64::from(item.width),
                        i64::from(item.height),
                        indexed_at,
                    ])
                    .map_err(|error| format!("无法保存外部图片索引 {}：{error}", item.path))?;
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("无法提交外部目录索引：{error}"))
    }

    pub fn find_managed_by_sha256(
        connection: &Connection,
        sha256: &str,
    ) -> Result<Option<IndexedImage>, String> {
        connection
            .query_row(
                r#"
                SELECT original_filename, source_path, file_extension, width, height, file_size
                FROM emojis
                WHERE sha256 = ?1
                  AND source_type IN ('managed_import', 'clipboard')
                  AND is_deleted = 0
                LIMIT 1
                "#,
                [sha256],
                |row| {
                    Ok(IndexedImage {
                        name: row.get(0)?,
                        path: row.get(1)?,
                        extension: row.get(2)?,
                        width: row.get::<_, u32>(3)?,
                        height: row.get::<_, u32>(4)?,
                        size_bytes: row.get::<_, u64>(5)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("无法查询素材哈希：{error}"))
    }

    pub fn list_available(connection: &Connection) -> Result<Vec<IndexedImage>, String> {
        let mut statement = connection
            .prepare(
                r#"
                SELECT original_filename, source_path, file_extension, width, height, file_size
                FROM emojis
                WHERE is_deleted = 0
                ORDER BY COALESCE(imported_at, indexed_at) DESC,
                         original_filename COLLATE NOCASE ASC
                "#,
            )
            .map_err(|error| format!("无法准备表情列表查询：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(IndexedImage {
                    name: row.get(0)?,
                    path: row.get(1)?,
                    extension: row.get(2)?,
                    width: row.get(3)?,
                    height: row.get(4)?,
                    size_bytes: row.get(5)?,
                })
            })
            .map_err(|error| format!("无法读取表情列表：{error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析表情列表：{error}"))
    }

    pub fn find_by_source_path(
        connection: &Connection,
        source_path: &str,
    ) -> Result<Option<IndexedImage>, String> {
        connection
            .query_row(
                r#"
                SELECT original_filename, source_path, file_extension, width, height, file_size
                FROM emojis
                WHERE source_path = ?1 AND is_deleted = 0
                LIMIT 1
                "#,
                [source_path],
                |row| {
                    Ok(IndexedImage {
                        name: row.get(0)?,
                        path: row.get(1)?,
                        extension: row.get(2)?,
                        width: row.get(3)?,
                        height: row.get(4)?,
                        size_bytes: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("无法读取表情记录：{error}"))
    }

    pub fn insert_managed(
        connection: &mut Connection,
        emoji: &NewManagedEmoji<'_>,
    ) -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始素材记录事务：{error}"))?;
        transaction
            .execute(
                r#"
                INSERT INTO emojis (
                    source_type, source_path, managed_path, original_filename,
                    file_extension, file_size, sha256, width, height,
                    thumbnail_path, imported_at, indexed_at, last_used_at,
                    usage_count, is_favorite, is_deleted
                ) VALUES (
                    ?1, ?2, ?3, ?4,
                    ?5, ?6, ?7, ?8, ?9,
                    ?10, ?11, ?12, NULL,
                    0, ?13, 0
                )
                "#,
                params![
                    emoji.source_type,
                    emoji.source_path,
                    emoji.managed_path,
                    emoji.original_filename,
                    emoji.file_extension,
                    to_i64(emoji.file_size),
                    emoji.sha256,
                    i64::from(emoji.width),
                    i64::from(emoji.height),
                    emoji.thumbnail_path,
                    emoji.imported_at,
                    emoji.indexed_at,
                    emoji.is_favorite,
                ],
            )
            .map_err(|error| format!("无法写入素材记录：{error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("无法提交素材记录：{error}"))
    }
}

fn to_i64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::EmojiRepository;
    use crate::{database::run_migrations, recent::RecentImageRecord, scanner::IndexedImage};

    fn image(path: &str) -> IndexedImage {
        IndexedImage {
            name: "emoji.png".to_string(),
            path: path.to_string(),
            extension: "png".to_string(),
            width: 32,
            height: 24,
            size_bytes: 128,
        }
    }

    fn recent(path: &str, last_used_at: u64, use_count: u64) -> RecentImageRecord {
        RecentImageRecord {
            item: image(path),
            last_used_at,
            use_count,
        }
    }

    #[test]
    fn legacy_recent_import_is_idempotent_and_preserves_latest_usage() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");

        EmojiRepository::import_legacy_recent(
            &mut connection,
            &[recent("C:\\emoji.png", 100, 2)],
            10,
        )
        .expect("first import");
        EmojiRepository::import_legacy_recent(
            &mut connection,
            &[recent("C:\\emoji.png", 90, 1)],
            20,
        )
        .expect("second import");

        let row = connection
            .query_row(
                "SELECT COUNT(*), last_used_at, usage_count FROM emojis WHERE source_path = ?1",
                ["C:\\emoji.png"],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("query imported emoji");
        assert_eq!(row, (1, 100, 2));
    }

    #[test]
    fn repeated_external_scan_updates_without_duplicates() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        let first = image("C:\\external\\emoji.png");
        let mut updated = first.clone();
        updated.size_bytes = 256;

        EmojiRepository::upsert_external_scan(&mut connection, &[first], 10).expect("first scan");
        EmojiRepository::upsert_external_scan(&mut connection, &[updated], 20)
            .expect("second scan");

        let row: (i64, i64, i64) = connection
            .query_row(
                "SELECT COUNT(*), file_size, indexed_at FROM emojis",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("query external emoji");
        assert_eq!(row, (1, 256, 20));
    }
}
