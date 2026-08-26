use rusqlite::{Connection, OptionalExtension, params};

use crate::{recent::RecentImageRecord, scanner::IndexedEmoji, scanner::IndexedImage};

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

/// 列表查询过滤选项。
pub struct ListOptions<'a> {
    pub view: &'a str,
    pub group_id: Option<i64>,
    pub favorite_only: bool,
    pub limit: u32,
    pub offset: u32,
}

pub struct EmojiRelations {
    pub group_ids: Vec<i64>,
    pub tag_ids: Vec<i64>,
}

pub struct TrashFileTargets {
    pub id: i64,
    pub source_type: String,
    pub managed_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub trash_path: Option<String>,
    pub trash_thumbnail_path: Option<String>,
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

    // ---- 第六阶段新增方法 ----

    /// 列表查询（排除 is_deleted=1）。path 投影 COALESCE(managed_path, source_path)。
    /// query / tag_ids 由 `search_emojis` command 传入；空 query + 空 tag_ids 时退化为纯视图过滤。
    pub fn list_indexed(
        connection: &Connection,
        options: &ListOptions<'_>,
        query: &str,
        tag_ids: &[i64],
    ) -> Result<Vec<IndexedEmoji>, String> {
        let (view_clause, mut params) = build_view_filter(options);
        let mut query_clause = String::new();
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            // 跨字段 OR：filename / tag name / group name
            query_clause.push_str(
                " AND (?Q = '' \
                    OR LOWER(e.original_filename) LIKE '%' || LOWER(?Q) || '%' COLLATE NOCASE \
                    OR EXISTS (SELECT 1 FROM emoji_tags et JOIN tags t ON t.id = et.tag_id \
                               WHERE et.emoji_id = e.id AND LOWER(t.name) LIKE '%' || LOWER(?Q) || '%' COLLATE NOCASE) \
                    OR EXISTS (SELECT 1 FROM emoji_groups eg JOIN groups g ON g.id = eg.group_id \
                               WHERE eg.emoji_id = e.id AND LOWER(g.name) LIKE '%' || LOWER(?Q) || '%' COLLATE NOCASE))",
            );
            params.push(Box::new(trimmed.to_string()));
        }
        // tag_ids AND 过滤
        if !tag_ids.is_empty() {
            let tag_placeholders: Vec<String> = (0..tag_ids.len()).map(|i| format!("?T{i}")).collect();
            let tag_list = tag_placeholders.join(",");
            query_clause.push_str(&format!(
                " AND NOT EXISTS ( \
                    SELECT 1 FROM (SELECT {tag_list} AS tag_id) required \
                    WHERE required.tag_id IS NOT NULL \
                      AND NOT EXISTS (SELECT 1 FROM emoji_tags et \
                                      WHERE et.emoji_id = e.id AND et.tag_id = required.tag_id) \
                  )"
            ));
            for id in tag_ids {
                params.push(Box::new(*id));
            }
        }

        let view_param_index = params.len() + 1;
        let limit_param_index = view_param_index + 1;
        let offset_param_index = limit_param_index + 1;
        let sql = format!(
            r#"
            SELECT id, original_filename,
                   COALESCE(managed_path, source_path) AS current_path,
                   thumbnail_path, file_extension, width, height, file_size,
                   source_type, is_favorite, last_used_at, usage_count
            FROM emojis e
            WHERE is_deleted = 0 {view_clause} {query_clause}
            ORDER BY
                CASE WHEN ?{view_param_index} = 'search-recent' THEN last_used_at END DESC,
                is_favorite DESC,
                COALESCE(imported_at, indexed_at) DESC,
                original_filename COLLATE NOCASE ASC
            LIMIT ?{limit_param_index} OFFSET ?{offset_param_index}
            "#
        );
        // 把 ?Q / ?TN 占位符替换为正确编号
        let mut sql = sql;
        let view_count = params.len()
            - if trimmed.is_empty() { 0 } else { 1 }
            - tag_ids.len();
        if !trimmed.is_empty() {
            let q_index = view_count + 1;
            sql = sql.replace("?Q", &format!("?{q_index}"));
        }
        for i in 0..tag_ids.len() {
            let t_index = view_count + 1 + if trimmed.is_empty() { 0 } else { 1 } + i;
            sql = sql.replace(&format!("?T{i}"), &format!("?{t_index}"));
        }
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("无法准备表情列表查询：{error}"))?;
        let mut bound_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        for p in params {
            bound_params.push(p);
        }
        bound_params.push(Box::new(options.view.to_string()));
        bound_params.push(Box::new(options.limit as i64));
        bound_params.push(Box::new(options.offset as i64));
        let bound_refs: Vec<&dyn rusqlite::ToSql> =
            bound_params.iter().map(|b| b.as_ref()).collect();
        let mut items: Vec<IndexedEmoji> = statement
            .query_map(rusqlite::params_from_iter(bound_refs), row_to_indexed_emoji)
            .map_err(|error| format!("无法读取表情列表：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析表情列表：{error}"))?;
        Self::fill_relations(connection, &mut items)?;
        Ok(items)
    }

    /// 回收站列表。path 投影 COALESCE 三参数：trash_path 优先，managed_path 次之，source_path 兜底。
    pub fn list_deleted(connection: &Connection) -> Result<Vec<IndexedEmoji>, String> {
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, original_filename,
                       COALESCE(trash_path, managed_path, source_path) AS path,
                       COALESCE(trash_thumbnail_path, thumbnail_path) AS thumb,
                       file_extension, width, height, file_size,
                       source_type, is_favorite, last_used_at, usage_count
                FROM emojis
                WHERE is_deleted = 1
                ORDER BY deleted_at DESC, id DESC
                "#,
            )
            .map_err(|error| format!("无法准备回收站列表查询：{error}"))?;
        let rows = statement
            .query_map([], row_to_indexed_emoji)
            .map_err(|error| format!("无法读取回收站列表：{error}"))?;
        let mut items: Vec<IndexedEmoji> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析回收站列表：{error}"))?;
        Self::fill_relations(connection, &mut items)?;
        Ok(items)
    }

    /// 复制使用回写：更新 last_used_at + usage_count。
    pub fn record_image_used(
        connection: &mut Connection,
        emoji_id: i64,
        at_ms: i64,
    ) -> Result<(), String> {
        connection
            .execute(
                "UPDATE emojis SET last_used_at = ?1, usage_count = usage_count + 1
                 WHERE id = ?2 AND is_deleted = 0",
                params![at_ms, emoji_id],
            )
            .map_err(|error| format!("无法更新最近使用计数：{error}"))?;
        Ok(())
    }

    /// 搜索最近使用：直接从 SQLite 查（用户要求 SQLite 主源）。
    pub fn search_recent(
        connection: &Connection,
        limit: u32,
    ) -> Result<Vec<RecentImageRecord>, String> {
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, original_filename,
                       COALESCE(managed_path, source_path) AS path,
                       thumbnail_path, file_extension, width, height, file_size,
                       source_type, is_favorite, last_used_at, usage_count
                FROM emojis
                WHERE is_deleted = 0 AND last_used_at IS NOT NULL
                ORDER BY last_used_at DESC
                LIMIT ?1
                "#,
            )
            .map_err(|error| format!("无法准备最近使用查询：{error}"))?;
        let rows = statement
            .query_map(params![limit as i64], |row| {
                let item = row_to_indexed_emoji(row)?;
                let last_used_at: Option<i64> = row.get(10)?;
                let usage_count: i64 = row.get(11)?;
                Ok(RecentImageRecord {
                    item: IndexedImage {
                        name: item.name,
                        path: item.path,
                        extension: item.extension,
                        width: item.width,
                        height: item.height,
                        size_bytes: item.size_bytes,
                    },
                    last_used_at: last_used_at.unwrap_or(0).max(0) as u64,
                    use_count: usage_count.max(0) as u64,
                    group_ids: Vec::new(),
                    tag_ids: Vec::new(),
                })
            })
            .map_err(|error| format!("无法读取最近使用：{error}"))?;
        let mut result: Vec<RecentImageRecord> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析最近使用：{error}"))?;
        result.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at));
        Ok(result)
    }

    /// 给 recent 列表填充关联字段。
    pub fn fill_relations_for_recent(
        connection: &Connection,
        records: &mut Vec<crate::recent::RecentImageRecord>,
    ) -> Result<(), String> {
        if records.is_empty() {
            return Ok(());
        }
        let paths: Vec<String> = records.iter().map(|r| r.item.path.clone()).collect();
        let placeholders = std::iter::repeat("?")
            .take(paths.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT id, source_path FROM emojis WHERE source_path IN ({placeholders}) AND is_deleted = 0"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(paths.len());
        for p in &paths {
            params_vec.push(Box::new(p.clone()));
        }
        let bound: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
        let path_to_id: std::collections::HashMap<String, i64> = connection
            .prepare(&sql)
            .map_err(|error| format!("无法准备 id 反查：{error}"))?
            .query_map(rusqlite::params_from_iter(bound), |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, i64>(0)?))
            })
            .map_err(|error| format!("无法读取 id 反查：{error}"))?
            .collect::<Result<std::collections::HashMap<_, _>, _>>()
            .map_err(|error| format!("无法解析 id 反查：{error}"))?;
        let ids: Vec<i64> = path_to_id.values().copied().collect();
        let relations = Self::get_relations_for_ids(connection, &ids)?;
        for record in records.iter_mut() {
            if let Some(&id) = path_to_id.get(&record.item.path) {
                if let Some(r) = relations.get(&id) {
                    record.group_ids = r.group_ids.clone();
                    record.tag_ids = r.tag_ids.clone();
                }
            }
        }
        Ok(())
    }

    /// 批量设置收藏。
    pub fn set_favorite_for_ids(
        connection: &mut Connection,
        ids: &[i64],
        is_favorite: bool,
    ) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "UPDATE emojis SET is_favorite = ?1 WHERE id IN ({placeholders}) AND is_deleted = 0"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(ids.len() + 1);
        params_vec.push(Box::new(is_favorite));
        for id in ids {
            params_vec.push(Box::new(*id));
        }
        let bound: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
        connection
            .execute(&sql, rusqlite::params_from_iter(bound))
            .map_err(|error| format!("无法批量设置收藏：{error}"))?;
        Ok(())
    }

    /// 软删：标记 is_deleted=1 + deleted_at。返回待处理的物理文件目标。
    pub fn mark_deleted(
        connection: &mut Connection,
        ids: &[i64],
        deleted_at: i64,
    ) -> Result<Vec<TrashFileTargets>, String> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(",");

        // 先 SELECT 待处理行
        let select_sql = format!(
            "SELECT id, source_type, managed_path, thumbnail_path, trash_path, trash_thumbnail_path
             FROM emojis WHERE id IN ({placeholders}) AND is_deleted = 0"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(ids.len() + 1);
        params_vec.push(Box::new(deleted_at));
        for id in ids {
            params_vec.push(Box::new(*id));
        }
        let bound_all: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
        let mut bound_select: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len());
        for i in 1..params_vec.len() {
            bound_select.push(bound_all[i]);
        }
        let targets: Vec<TrashFileTargets> = connection
            .prepare(&select_sql)
            .map_err(|error| format!("无法准备软删查询：{error}"))?
            .query_map(rusqlite::params_from_iter(bound_select), |row| {
                Ok(TrashFileTargets {
                    id: row.get(0)?,
                    source_type: row.get(1)?,
                    managed_path: row.get(2)?,
                    thumbnail_path: row.get(3)?,
                    trash_path: row.get(4)?,
                    trash_thumbnail_path: row.get(5)?,
                })
            })
            .map_err(|error| format!("无法读取待软删行：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析待软删行：{error}"))?;

        let update_sql = format!(
            "UPDATE emojis SET is_deleted = 1, deleted_at = ?1
             WHERE id IN ({placeholders}) AND is_deleted = 0"
        );
        let bound_update: Vec<&dyn rusqlite::ToSql> = bound_all.iter().take(1 + ids.len()).copied().collect();
        connection
            .execute(&update_sql, rusqlite::params_from_iter(bound_update))
            .map_err(|error| format!("无法标记软删：{error}"))?;
        Ok(targets)
    }

    /// 写入 trash 路径字段（由 trash_service 在移动文件成功后调用）。
    pub fn set_trash_paths(
        connection: &mut Connection,
        id: i64,
        trash_path: Option<&str>,
        trash_thumbnail_path: Option<&str>,
    ) -> Result<(), String> {
        connection
            .execute(
                "UPDATE emojis SET trash_path = ?1, trash_thumbnail_path = ?2
                 WHERE id = ?3",
                params![trash_path, trash_thumbnail_path, id],
            )
            .map_err(|error| format!("无法写入回收站路径：{error}"))?;
        Ok(())
    }

    /// 恢复：清 trash 字段 + 解除软删。返回待移回的物理文件目标。
    pub fn clear_trash(
        connection: &mut Connection,
        ids: &[i64],
    ) -> Result<Vec<TrashFileTargets>, String> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let select_sql = format!(
            "SELECT id, source_type, managed_path, thumbnail_path, trash_path, trash_thumbnail_path
             FROM emojis WHERE id IN ({placeholders}) AND is_deleted = 1"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(ids.len());
        for id in ids {
            params_vec.push(Box::new(*id));
        }
        let bound: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
        let targets: Vec<TrashFileTargets> = connection
            .prepare(&select_sql)
            .map_err(|error| format!("无法准备恢复查询：{error}"))?
            .query_map(rusqlite::params_from_iter(bound.iter().copied()), |row| {
                Ok(TrashFileTargets {
                    id: row.get(0)?,
                    source_type: row.get(1)?,
                    managed_path: row.get(2)?,
                    thumbnail_path: row.get(3)?,
                    trash_path: row.get(4)?,
                    trash_thumbnail_path: row.get(5)?,
                })
            })
            .map_err(|error| format!("无法读取待恢复行：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析待恢复行：{error}"))?;

        let update_sql = format!(
            "UPDATE emojis SET is_deleted = 0, deleted_at = NULL,
                 trash_path = NULL, trash_thumbnail_path = NULL
             WHERE id IN ({placeholders}) AND is_deleted = 1"
        );
        connection
            .execute(&update_sql, rusqlite::params_from_iter(bound))
            .map_err(|error| format!("无法清空回收站字段：{error}"))?;
        Ok(targets)
    }

    /// 永久删除：DELETE 行（CASCADE 清关联）。返回待删物理文件目标。
    pub fn delete_permanently(
        connection: &mut Connection,
        ids: &[i64],
    ) -> Result<Vec<TrashFileTargets>, String> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let select_sql = format!(
            "SELECT id, source_type, managed_path, thumbnail_path, trash_path, trash_thumbnail_path
             FROM emojis WHERE id IN ({placeholders}) AND is_deleted = 1"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(ids.len());
        for id in ids {
            params_vec.push(Box::new(*id));
        }
        let bound: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
        let targets: Vec<TrashFileTargets> = connection
            .prepare(&select_sql)
            .map_err(|error| format!("无法准备永久删除查询：{error}"))?
            .query_map(rusqlite::params_from_iter(bound.iter().copied()), |row| {
                Ok(TrashFileTargets {
                    id: row.get(0)?,
                    source_type: row.get(1)?,
                    managed_path: row.get(2)?,
                    thumbnail_path: row.get(3)?,
                    trash_path: row.get(4)?,
                    trash_thumbnail_path: row.get(5)?,
                })
            })
            .map_err(|error| format!("无法读取待永久删除行：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析待永久删除行：{error}"))?;

        let delete_sql = format!("DELETE FROM emojis WHERE id IN ({placeholders}) AND is_deleted = 1");
        connection
            .execute(&delete_sql, rusqlite::params_from_iter(bound))
            .map_err(|error| format!("无法永久删除表情：{error}"))?;
        Ok(targets)
    }

    /// 列出所有 is_deleted=1 行的物理文件目标（empty_trash 用）。
    pub fn list_deleted_targets(connection: &Connection) -> Result<Vec<TrashFileTargets>, String> {
        let mut statement = connection
            .prepare(
                "SELECT id, source_type, managed_path, thumbnail_path,
                        trash_path, trash_thumbnail_path
                 FROM emojis WHERE is_deleted = 1",
            )
            .map_err(|error| format!("无法读取回收站目标：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(TrashFileTargets {
                    id: row.get(0)?,
                    source_type: row.get(1)?,
                    managed_path: row.get(2)?,
                    thumbnail_path: row.get(3)?,
                    trash_path: row.get(4)?,
                    trash_thumbnail_path: row.get(5)?,
                })
            })
            .map_err(|error| format!("无法读取回收站行：{error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析回收站行：{error}"))
    }

    /// 加入分组：矩阵写入。
    pub fn add_to_group(
        connection: &mut Connection,
        group_id: i64,
        emoji_ids: &[i64],
    ) -> Result<(), String> {
        if emoji_ids.is_empty() {
            return Ok(());
        }
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始加入分组事务：{error}"))?;
        let now = unix_time_millis();
        {
            let mut statement = transaction
                .prepare_cached(
                    "INSERT OR IGNORE INTO emoji_groups (emoji_id, group_id, added_at)
                     VALUES (?1, ?2, ?3)",
                )
                .map_err(|error| format!("无法准备加入分组语句：{error}"))?;
            for id in emoji_ids {
                statement
                    .execute(params![id, group_id, now])
                    .map_err(|error| format!("无法加入分组 {group_id}：{error}"))?;
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("无法提交加入分组：{error}"))?;
        Ok(())
    }

    /// 移出分组。
    pub fn remove_from_group(
        connection: &mut Connection,
        group_id: i64,
        emoji_ids: &[i64],
    ) -> Result<(), String> {
        if emoji_ids.is_empty() {
            return Ok(());
        }
        let placeholders = std::iter::repeat("?")
            .take(emoji_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "DELETE FROM emoji_groups WHERE group_id = ?1 AND emoji_id IN ({placeholders})"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> =
            Vec::with_capacity(emoji_ids.len() + 1);
        params_vec.push(Box::new(group_id));
        for id in emoji_ids {
            params_vec.push(Box::new(*id));
        }
        let bound: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
        connection
            .execute(&sql, rusqlite::params_from_iter(bound))
            .map_err(|error| format!("无法移出分组：{error}"))?;
        Ok(())
    }

    /// 矩阵批量加标签：tag_ids × emoji_ids。已存在自动忽略。
    pub fn add_tags(
        connection: &mut Connection,
        tag_ids: &[i64],
        emoji_ids: &[i64],
    ) -> Result<(), String> {
        if tag_ids.is_empty() || emoji_ids.is_empty() {
            return Ok(());
        }
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始批量加标签事务：{error}"))?;
        let now = unix_time_millis();
        {
            let mut statement = transaction
                .prepare_cached(
                    "INSERT OR IGNORE INTO emoji_tags (emoji_id, tag_id, added_at)
                     VALUES (?1, ?2, ?3)",
                )
                .map_err(|error| format!("无法准备批量加标签语句：{error}"))?;
            for emoji_id in emoji_ids {
                for tag_id in tag_ids {
                    statement
                        .execute(params![emoji_id, tag_id, now])
                        .map_err(|error| format!("无法加标签 {tag_id}：{error}"))?;
                }
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("无法提交批量加标签：{error}"))?;
        Ok(())
    }

    /// 矩阵批量删标签。
    pub fn remove_tags(
        connection: &mut Connection,
        tag_ids: &[i64],
        emoji_ids: &[i64],
    ) -> Result<(), String> {
        if tag_ids.is_empty() || emoji_ids.is_empty() {
            return Ok(());
        }
        let placeholders_emoji = std::iter::repeat("?")
            .take(emoji_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let placeholders_tag = std::iter::repeat("?")
            .take(tag_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "DELETE FROM emoji_tags
             WHERE emoji_id IN ({placeholders_emoji}) AND tag_id IN ({placeholders_tag})"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> =
            Vec::with_capacity(emoji_ids.len() + tag_ids.len());
        for id in emoji_ids {
            params_vec.push(Box::new(*id));
        }
        for id in tag_ids {
            params_vec.push(Box::new(*id));
        }
        let bound: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
        connection
            .execute(&sql, rusqlite::params_from_iter(bound))
            .map_err(|error| format!("无法批量删除标签：{error}"))?;
        Ok(())
    }

    /// 给已有 IndexedEmoji 列表填充 group_ids / tag_ids（2 次 SQL，避免 N+1）。
    pub fn fill_relations(
        connection: &Connection,
        items: &mut Vec<IndexedEmoji>,
    ) -> Result<(), String> {
        if items.is_empty() {
            return Ok(());
        }
        let ids: Vec<i64> = items.iter().map(|e| e.id).collect();
        let relations = Self::get_relations_for_ids(connection, &ids)?;
        for item in items.iter_mut() {
            if let Some(r) = relations.get(&item.id) {
                item.group_ids = r.group_ids.clone();
                item.tag_ids = r.tag_ids.clone();
            }
        }
        Ok(())
    }

    /// 关系查询：批量拿 emoji_ids 的 (group_ids[], tag_ids[])。
    pub fn get_relations_for_ids(
        connection: &Connection,
        emoji_ids: &[i64],
    ) -> Result<std::collections::BTreeMap<i64, EmojiRelations>, String> {
        let mut result: std::collections::BTreeMap<i64, EmojiRelations> =
            std::collections::BTreeMap::new();
        if emoji_ids.is_empty() {
            return Ok(result);
        }
        for id in emoji_ids {
            result.insert(
                *id,
                EmojiRelations {
                    group_ids: Vec::new(),
                    tag_ids: Vec::new(),
                },
            );
        }
        let placeholders = std::iter::repeat("?")
            .take(emoji_ids.len())
            .collect::<Vec<_>>()
            .join(",");

        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(emoji_ids.len());
        for id in emoji_ids {
            params_vec.push(Box::new(*id));
        }
        let bound: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

        let group_sql = format!(
            "SELECT emoji_id, group_id FROM emoji_groups WHERE emoji_id IN ({placeholders})"
        );
        let mut statement = connection
            .prepare(&group_sql)
            .map_err(|error| format!("无法准备分组关联查询：{error}"))?;
        let group_rows = statement
            .query_map(rusqlite::params_from_iter(bound.iter().copied()), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|error| format!("无法读取分组关联：{error}"))?;
        for entry in group_rows {
            let (emoji_id, group_id) =
                entry.map_err(|error| format!("无法解析分组关联：{error}"))?;
            if let Some(rel) = result.get_mut(&emoji_id) {
                rel.group_ids.push(group_id);
            }
        }

        let tag_sql = format!(
            "SELECT emoji_id, tag_id FROM emoji_tags WHERE emoji_id IN ({placeholders})"
        );
        let mut statement = connection
            .prepare(&tag_sql)
            .map_err(|error| format!("无法准备标签关联查询：{error}"))?;
        let tag_rows = statement
            .query_map(rusqlite::params_from_iter(bound.iter().copied()), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|error| format!("无法读取标签关联：{error}"))?;
        for entry in tag_rows {
            let (emoji_id, tag_id) = entry.map_err(|error| format!("无法解析标签关联：{error}"))?;
            if let Some(rel) = result.get_mut(&emoji_id) {
                rel.tag_ids.push(tag_id);
            }
        }
        Ok(result)
    }
}

fn row_to_indexed_emoji(row: &rusqlite::Row<'_>) -> rusqlite::Result<IndexedEmoji> {
    Ok(IndexedEmoji {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        thumbnail_path: row.get(3)?,
        extension: row.get(4)?,
        width: row.get::<_, u32>(5)?,
        height: row.get::<_, u32>(6)?,
        size_bytes: row.get::<_, u64>(7)?,
        source_type: row.get(8)?,
        is_favorite: row.get::<_, i64>(9)? != 0,
        last_used_at: row.get(10)?,
        usage_count: row.get(11)?,
        group_ids: Vec::new(),
        tag_ids: Vec::new(),
    })
}

fn build_view_filter(options: &ListOptions<'_>) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut fragments: Vec<&'static str> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    match options.view {
        "favorites" => fragments.push("AND e.is_favorite = 1"),
        "ungrouped" => fragments.push(
            "AND NOT EXISTS (SELECT 1 FROM emoji_groups eg WHERE eg.emoji_id = e.id)",
        ),
        "search-recent" => fragments.push("AND e.last_used_at IS NOT NULL"),
        "group" => {
            if let Some(gid) = options.group_id {
                fragments.push(
                    "AND EXISTS (SELECT 1 FROM emoji_groups eg WHERE eg.emoji_id = e.id AND eg.group_id = ?1)",
                );
                params.push(Box::new(gid));
            }
        }
        _ => {}
    }
    if options.favorite_only {
        fragments.push("AND e.is_favorite = 1");
    }
    (fragments.join(" "), params)
}

fn to_i64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

fn unix_time_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
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
