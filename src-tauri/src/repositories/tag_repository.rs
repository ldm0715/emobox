use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};

pub struct TagRepository;

#[derive(Debug, Clone)]
pub struct TagRow {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

impl TagRepository {
    pub fn list_tags(connection: &Connection) -> Result<Vec<TagRow>, String> {
        let mut statement = connection
            .prepare(
                r#"
                SELECT t.id, t.name,
                       (SELECT COUNT(*) FROM emojis e
                        JOIN emoji_tags et ON et.emoji_id = e.id
                        WHERE et.tag_id = t.id AND e.is_deleted = 0) AS count
                FROM tags t
                ORDER BY t.name COLLATE NOCASE ASC
                "#,
            )
            .map_err(|error| format!("无法准备标签列表查询：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(TagRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    count: row.get(2)?,
                })
            })
            .map_err(|error| format!("无法读取标签列表：{error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析标签列表：{error}"))
    }

    pub fn create_tag(connection: &mut Connection, name: &str) -> Result<TagRow, String> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("标签名称不能为空。".to_string());
        }

        let now = unix_time_millis();
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始新建标签事务：{error}"))?;
        transaction
            .execute(
                "INSERT INTO tags (name, created_at) VALUES (?1, ?2)",
                params![trimmed, now],
            )
            .map_err(|error| {
                let message = error.to_string();
                if message.contains("UNIQUE constraint failed: tags.name") {
                    format!("已存在同名标签：{trimmed}")
                } else {
                    format!("无法新建标签 {trimmed}：{message}")
                }
            })?;
        let id = transaction.last_insert_rowid();
        transaction
            .commit()
            .map_err(|error| format!("无法提交新建标签：{error}"))?;

        Ok(TagRow {
            id,
            name: trimmed.to_string(),
            count: 0,
        })
    }

    /// 按名查找标签 id；不存在则创建。NOCASE 精确匹配，幂等。
    /// 空名 → Err（与 `create_tag` 一致）。
    pub fn find_or_create_id(connection: &mut Connection, name: &str) -> Result<i64, String> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("标签名称不能为空。".to_string());
        }
        let existing = connection
            .query_row(
                "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                [trimmed],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| format!("无法查询标签：{error}"))?;
        match existing {
            Some(id) => Ok(id),
            None => Ok(TagRepository::create_tag(connection, trimmed)?.id),
        }
    }

    pub fn rename_tag(
        connection: &mut Connection,
        id: i64,
        new_name: &str,
    ) -> Result<TagRow, String> {
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err("标签名称不能为空。".to_string());
        }

        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始重命名标签事务：{error}"))?;
        let updated = transaction
            .execute(
                "UPDATE tags SET name = ?1 WHERE id = ?2",
                params![trimmed, id],
            )
            .map_err(|error| {
                let message = error.to_string();
                if message.contains("UNIQUE constraint failed: tags.name") {
                    format!("已存在同名标签：{trimmed}")
                } else {
                    format!("无法重命名标签：{message}")
                }
            })?;
        if updated == 0 {
            return Err(format!("找不到要重命名的标签：{id}"));
        }
        // 重命名标签算"修改"：带该标签的所有表情的修改时间一起刷新。
        transaction
            .execute(
                "UPDATE emojis SET updated_at = ?1 WHERE id IN (SELECT emoji_id FROM emoji_tags WHERE tag_id = ?2)",
                params![unix_time_millis(), id],
            )
            .map_err(|error| format!("无法刷新标签表情的修改时间：{error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("无法提交重命名标签：{error}"))?;

        let row = connection
            .query_row("SELECT id, name FROM tags WHERE id = ?1", [id], |row| {
                Ok(TagRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    count: 0,
                })
            })
            .optional()
            .map_err(|error| format!("无法读取重命名后的标签：{error}"))?
            .ok_or_else(|| format!("找不到标签：{id}"))?;
        Ok(row)
    }

    pub fn delete_tag(connection: &mut Connection, id: i64) -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始删除标签事务：{error}"))?;
        // 删除标签算"修改"：先刷新带该标签表情的修改时间（随后 CASCADE 清掉 emoji_tags）。
        transaction
            .execute(
                "UPDATE emojis SET updated_at = ?1 WHERE id IN (SELECT emoji_id FROM emoji_tags WHERE tag_id = ?2)",
                params![unix_time_millis(), id],
            )
            .map_err(|error| format!("无法刷新标签表情的修改时间：{error}"))?;
        // CASCADE 自动清空 emoji_tags。
        let deleted = transaction
            .execute("DELETE FROM tags WHERE id = ?1", [id])
            .map_err(|error| format!("无法删除标签：{error}"))?;
        if deleted == 0 {
            return Err(format!("找不到要删除的标签：{id}"));
        }
        transaction
            .commit()
            .map_err(|error| format!("无法提交删除标签：{error}"))
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

    use super::TagRepository;
    use crate::database::run_migrations;

    fn fresh() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        connection
    }

    #[test]
    fn create_tag_trims_and_rejects_empty() {
        let mut connection = fresh();
        assert!(TagRepository::create_tag(&mut connection, "  ").is_err());
        let row = TagRepository::create_tag(&mut connection, "  搞笑 ").expect("create");
        assert_eq!(row.name, "搞笑");
    }

    #[test]
    fn create_tag_normalizes_case() {
        let mut connection = fresh();
        TagRepository::create_tag(&mut connection, "Cat").expect("first");
        let err = TagRepository::create_tag(&mut connection, "cat")
            .expect_err("should reject case-insensitive duplicate");
        assert!(err.contains("已存在"));
    }

    #[test]
    fn delete_tag_cascades_emoji_tags() {
        let mut connection = fresh();
        let tag = TagRepository::create_tag(&mut connection, "搞笑").expect("create");
        connection
            .execute(
                "INSERT INTO emojis (source_type, source_path, managed_path, original_filename, file_extension, file_size, sha256, width, height, indexed_at, usage_count, is_favorite, is_deleted) VALUES ('managed_import', '/x.png', '/x.png', 'x.png', 'png', 1, 'sha', 1, 1, 0, 0, 0, 0)",
                [],
            )
            .expect("insert emoji");
        let emoji_id: i64 = connection
            .query_row("SELECT id FROM emojis", [], |row| row.get(0))
            .expect("emoji id");
        connection
            .execute(
                "INSERT INTO emoji_tags (emoji_id, tag_id, added_at) VALUES (?1, ?2, 0)",
                rusqlite::params![emoji_id, tag.id],
            )
            .expect("insert relation");

        TagRepository::delete_tag(&mut connection, tag.id).expect("delete tag");

        let relation_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM emoji_tags", [], |row| row.get(0))
            .expect("count");
        assert_eq!(relation_count, 0, "关联应被 CASCADE 清空");
    }

    fn insert_emoji_with_tag(connection: &mut Connection, tag_id: i64) -> i64 {
        connection
            .execute(
                "INSERT INTO emojis (source_type, source_path, managed_path, original_filename, file_extension, file_size, sha256, width, height, indexed_at, usage_count, is_favorite, is_deleted, updated_at)
                 VALUES ('managed_import', '/x.png', '/x.png', 'x.png', 'png', 1, 'sha', 1, 1, 0, 0, 0, 0, 0)",
                [],
            )
            .expect("insert emoji");
        let emoji_id: i64 = connection
            .query_row("SELECT id FROM emojis", [], |row| row.get(0))
            .expect("emoji id");
        connection
            .execute(
                "INSERT INTO emoji_tags (emoji_id, tag_id, added_at) VALUES (?1, ?2, 0)",
                rusqlite::params![emoji_id, tag_id],
            )
            .expect("insert relation");
        emoji_id
    }

    #[test]
    fn rename_tag_refreshes_tagged_emoji_updated_at() {
        let mut connection = fresh();
        let tag = TagRepository::create_tag(&mut connection, "搞笑").expect("create");
        let emoji_id = insert_emoji_with_tag(&mut connection, tag.id);

        TagRepository::rename_tag(&mut connection, tag.id, "好玩").expect("rename");

        let updated_at: i64 = connection
            .query_row(
                "SELECT updated_at FROM emojis WHERE id = ?1",
                [emoji_id],
                |row| row.get(0),
            )
            .expect("updated_at");
        assert!(updated_at > 0, "重命名标签应刷新带该标签表情的修改时间");
    }

    #[test]
    fn delete_tag_refreshes_tagged_emoji_updated_at() {
        let mut connection = fresh();
        let tag = TagRepository::create_tag(&mut connection, "搞笑").expect("create");
        let emoji_id = insert_emoji_with_tag(&mut connection, tag.id);

        TagRepository::delete_tag(&mut connection, tag.id).expect("delete tag");

        let updated_at: i64 = connection
            .query_row(
                "SELECT updated_at FROM emojis WHERE id = ?1",
                [emoji_id],
                |row| row.get(0),
            )
            .expect("updated_at");
        assert!(updated_at > 0, "删除标签应刷新带该标签表情的修改时间");
    }

    #[test]
    fn list_tags_includes_count() {
        let mut connection = fresh();
        let t1 = TagRepository::create_tag(&mut connection, "A").expect("t1");
        let _t2 = TagRepository::create_tag(&mut connection, "B").expect("t2");
        connection
            .execute(
                "INSERT INTO emojis (source_type, source_path, managed_path, original_filename, file_extension, file_size, sha256, width, height, indexed_at, usage_count, is_favorite, is_deleted) VALUES ('managed_import', '/x.png', '/x.png', 'x.png', 'png', 1, 'sha', 1, 1, 0, 0, 0, 0)",
                [],
            )
            .expect("insert emoji");
        let emoji_id: i64 = connection
            .query_row("SELECT id FROM emojis", [], |row| row.get(0))
            .expect("emoji id");
        connection
            .execute(
                "INSERT INTO emoji_tags (emoji_id, tag_id, added_at) VALUES (?1, ?2, 0)",
                rusqlite::params![emoji_id, t1.id],
            )
            .expect("insert relation");

        let list = TagRepository::list_tags(&connection).expect("list");
        let a = list.iter().find(|row| row.id == t1.id).expect("find A");
        assert_eq!(a.count, 1);
    }
}
