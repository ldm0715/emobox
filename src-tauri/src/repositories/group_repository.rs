use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};

pub struct GroupRepository;

#[derive(Debug, Clone)]
pub struct GroupRow {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub count: i64,
    pub is_pinned: bool,
}

impl GroupRepository {
    pub fn list_groups(connection: &Connection) -> Result<Vec<GroupRow>, String> {
        let mut statement = connection
            .prepare(
                r#"
                SELECT g.id, g.name, g.sort_order,
                       (SELECT COUNT(*) FROM emojis e
                        JOIN emoji_groups eg ON eg.emoji_id = e.id
                        WHERE eg.group_id = g.id AND e.is_deleted = 0) AS count,
                       g.is_pinned
                FROM groups g
                ORDER BY g.is_pinned DESC, g.sort_order ASC, g.id ASC
                "#,
            )
            .map_err(|error| format!("无法准备分组列表查询：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(GroupRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    sort_order: row.get(2)?,
                    count: row.get(3)?,
                    is_pinned: row.get(4)?,
                })
            })
            .map_err(|error| format!("无法读取分组列表：{error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析分组列表：{error}"))
    }

    pub fn create_group(connection: &mut Connection, name: &str) -> Result<GroupRow, String> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("分组名称不能为空。".to_string());
        }

        let now = unix_time_millis();
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始新建分组事务：{error}"))?;
        transaction
            .execute(
                "INSERT INTO groups (name, sort_order, created_at, updated_at) VALUES (?1, 0, ?2, ?2)",
                params![trimmed, now],
            )
            .map_err(|error| {
                let message = error.to_string();
                if message.contains("UNIQUE constraint failed: groups.name") {
                    format!("已存在同名分组：{trimmed}")
                } else {
                    format!("无法新建分组 {trimmed}：{message}")
                }
            })?;
        let id = transaction.last_insert_rowid();
        transaction
            .commit()
            .map_err(|error| format!("无法提交新建分组：{error}"))?;

        Ok(GroupRow {
            id,
            name: trimmed.to_string(),
            sort_order: 0,
            count: 0,
            is_pinned: false,
        })
    }

    pub fn rename_group(
        connection: &mut Connection,
        id: i64,
        new_name: &str,
    ) -> Result<GroupRow, String> {
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err("分组名称不能为空。".to_string());
        }

        let now = unix_time_millis();
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始重命名分组事务：{error}"))?;
        let updated = transaction
            .execute(
                "UPDATE groups SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![trimmed, now, id],
            )
            .map_err(|error| {
                let message = error.to_string();
                if message.contains("UNIQUE constraint failed: groups.name") {
                    format!("已存在同名分组：{trimmed}")
                } else {
                    format!("无法重命名分组：{message}")
                }
            })?;
        if updated == 0 {
            return Err(format!("找不到要重命名的分组：{id}"));
        }
        // 重命名分组算"修改"：组内所有表情的修改时间一起刷新。
        transaction
            .execute(
                "UPDATE emojis SET updated_at = ?1 WHERE id IN (SELECT emoji_id FROM emoji_groups WHERE group_id = ?2)",
                params![now, id],
            )
            .map_err(|error| format!("无法刷新分组成员的修改时间：{error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("无法提交重命名分组：{error}"))?;

        let row = connection
            .query_row(
                "SELECT id, name, sort_order, is_pinned FROM groups WHERE id = ?1",
                [id],
                |row| {
                    Ok(GroupRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        sort_order: row.get(2)?,
                        count: 0,
                        is_pinned: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("无法读取重命名后的分组：{error}"))?
            .ok_or_else(|| format!("找不到分组：{id}"))?;
        Ok(row)
    }

    pub fn delete_group(connection: &mut Connection, id: i64) -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始删除分组事务：{error}"))?;
        // 删除分组算"修改"：先刷新受影响成员的修改时间（随后 CASCADE 会清掉
        // emoji_groups，无法再按成员查询）。
        transaction
            .execute(
                "UPDATE emojis SET updated_at = ?1 WHERE id IN (SELECT emoji_id FROM emoji_groups WHERE group_id = ?2)",
                params![unix_time_millis(), id],
            )
            .map_err(|error| format!("无法刷新分组成员的修改时间：{error}"))?;
        // CASCADE 自动清空 emoji_groups 中匹配行；emoji 行不动。
        let deleted = transaction
            .execute("DELETE FROM groups WHERE id = ?1", [id])
            .map_err(|error| format!("无法删除分组：{error}"))?;
        if deleted == 0 {
            return Err(format!("找不到要删除的分组：{id}"));
        }
        transaction
            .commit()
            .map_err(|error| format!("无法提交删除分组：{error}"))
    }

    /// 置顶/取消置顶分组。只影响侧栏排序，不刷新组内表情的修改时间
    /// （与 `rename_group` / `delete_group` 不同 —— 那两者算"修改内容"）。
    pub fn set_group_pinned(connection: &Connection, id: i64, pinned: bool) -> Result<(), String> {
        let updated = connection
            .execute(
                "UPDATE groups SET is_pinned = ?1, updated_at = ?2 WHERE id = ?3",
                params![pinned, unix_time_millis(), id],
            )
            .map_err(|error| format!("无法更新分组置顶状态：{error}"))?;
        if updated == 0 {
            return Err(format!("找不到要置顶的分组：{id}"));
        }
        Ok(())
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

    use super::GroupRepository;
    use crate::database::run_migrations;

    fn fresh() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        connection
    }

    #[test]
    fn create_group_trims_and_rejects_empty() {
        let mut connection = fresh();
        assert!(GroupRepository::create_group(&mut connection, "  ").is_err());
        let row = GroupRepository::create_group(&mut connection, "  猫猫  ").expect("create");
        assert_eq!(row.name, "猫猫");
    }

    #[test]
    fn create_group_rejects_duplicate_name() {
        let mut connection = fresh();
        GroupRepository::create_group(&mut connection, "猫猫").expect("first");
        let err = GroupRepository::create_group(&mut connection, "猫猫")
            .expect_err("should reject duplicate");
        assert!(err.contains("已存在"));
    }

    #[test]
    fn rename_group_updates_timestamp() {
        let mut connection = fresh();
        let created = GroupRepository::create_group(&mut connection, "猫猫").expect("create");
        let renamed =
            GroupRepository::rename_group(&mut connection, created.id, "狗狗").expect("rename");
        assert_eq!(renamed.name, "狗狗");
    }

    fn insert_emoji_with_group(connection: &mut Connection, group_id: i64) -> i64 {
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
                "INSERT INTO emoji_groups (emoji_id, group_id, added_at) VALUES (?1, ?2, 0)",
                rusqlite::params![emoji_id, group_id],
            )
            .expect("insert relation");
        emoji_id
    }

    #[test]
    fn rename_group_refreshes_member_updated_at() {
        let mut connection = fresh();
        let group = GroupRepository::create_group(&mut connection, "猫猫").expect("create");
        let emoji_id = insert_emoji_with_group(&mut connection, group.id);

        GroupRepository::rename_group(&mut connection, group.id, "狗狗").expect("rename");

        let updated_at: i64 = connection
            .query_row(
                "SELECT updated_at FROM emojis WHERE id = ?1",
                [emoji_id],
                |row| row.get(0),
            )
            .expect("updated_at");
        assert!(updated_at > 0, "重命名分组应刷新成员修改时间");
    }

    #[test]
    fn delete_group_refreshes_member_updated_at() {
        let mut connection = fresh();
        let group = GroupRepository::create_group(&mut connection, "猫猫").expect("create");
        let emoji_id = insert_emoji_with_group(&mut connection, group.id);

        GroupRepository::delete_group(&mut connection, group.id).expect("delete group");

        let updated_at: i64 = connection
            .query_row(
                "SELECT updated_at FROM emojis WHERE id = ?1",
                [emoji_id],
                |row| row.get(0),
            )
            .expect("updated_at");
        assert!(updated_at > 0, "删除分组应刷新成员修改时间");
    }

    #[test]
    fn delete_group_cascades_emoji_groups() {
        let mut connection = fresh();
        let group = GroupRepository::create_group(&mut connection, "猫猫").expect("create");
        // 插入一个 emoji + 关联，验证删除 group 后关联被清空但 emoji 行不动
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
                "INSERT INTO emoji_groups (emoji_id, group_id, added_at) VALUES (?1, ?2, 0)",
                rusqlite::params![emoji_id, group.id],
            )
            .expect("insert relation");

        GroupRepository::delete_group(&mut connection, group.id).expect("delete group");

        let emoji_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM emojis", [], |row| row.get(0))
            .expect("count emojis");
        assert_eq!(emoji_count, 1, "emoji 行不应被删除");

        let relation_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM emoji_groups", [], |row| row.get(0))
            .expect("count relations");
        assert_eq!(relation_count, 0, "关联应被 CASCADE 清空");
    }

    #[test]
    fn list_groups_includes_count() {
        let mut connection = fresh();
        let g1 = GroupRepository::create_group(&mut connection, "A").expect("g1");
        let _g2 = GroupRepository::create_group(&mut connection, "B").expect("g2");
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
                "INSERT INTO emoji_groups (emoji_id, group_id, added_at) VALUES (?1, ?2, 0)",
                rusqlite::params![emoji_id, g1.id],
            )
            .expect("insert relation");

        let list = GroupRepository::list_groups(&connection).expect("list");
        assert_eq!(list.len(), 2);
        let a = list.iter().find(|row| row.id == g1.id).expect("find A");
        assert_eq!(a.count, 1);
        let b = list.iter().find(|row| row.name == "B").expect("find B");
        assert_eq!(b.count, 0);
    }

    #[test]
    fn set_group_pinned_toggles_and_orders() {
        let mut connection = fresh();
        let a = GroupRepository::create_group(&mut connection, "A").expect("create A");
        let b = GroupRepository::create_group(&mut connection, "B").expect("create B");

        // 默认都不置顶，按 id 升序。
        let list = GroupRepository::list_groups(&connection).expect("list");
        assert_eq!(
            list.iter().map(|row| row.id).collect::<Vec<_>>(),
            vec![a.id, b.id]
        );
        assert!(list.iter().all(|row| !row.is_pinned));

        // 置顶 B → B 排到最前。
        GroupRepository::set_group_pinned(&connection, b.id, true).expect("pin B");
        let list = GroupRepository::list_groups(&connection).expect("list after pin");
        assert_eq!(
            list.iter().map(|row| row.id).collect::<Vec<_>>(),
            vec![b.id, a.id]
        );
        assert!(list[0].is_pinned, "置顶的 B 应标记 is_pinned");
        assert!(!list[1].is_pinned);

        // 取消置顶 → 恢复 id 升序。
        GroupRepository::set_group_pinned(&connection, b.id, false).expect("unpin B");
        let list = GroupRepository::list_groups(&connection).expect("list after unpin");
        assert_eq!(
            list.iter().map(|row| row.id).collect::<Vec<_>>(),
            vec![a.id, b.id]
        );

        // 不存在的 id → 报错。
        let err =
            GroupRepository::set_group_pinned(&connection, 9999, true).expect_err("missing id");
        assert!(err.contains("找不到"));
    }
}
