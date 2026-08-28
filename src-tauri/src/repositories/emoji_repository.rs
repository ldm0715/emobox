use std::time::Instant;

use rusqlite::{Connection, OptionalExtension, params};

use crate::{
    perceptual_hash::{from_db, hamming_distance},
    recent::RecentImageRecord,
    scanner::IndexedEmoji,
    scanner::IndexedImage,
};

pub struct EmojiRepository;

/// 精确搜索的分支模式。
#[derive(Clone, Copy, Debug)]
enum SearchMode {
    /// `组名*标签名` / `组名:标签名`：组名、标签名都 NOCASE 精确匹配。
    Exact,
    /// 组名保持精确，标签名放宽为子串 LIKE（精确命中为空时的兜底，
    /// 例如用户按网格显示名输入 `组*开心.png`，标签实际存 stem `开心`）。
    Lenient,
    /// 组名精确匹配不到（分组不存在 / 表情未归组）时的兜底：组名子串去命中
    /// 分组名 / 文件名 / 标签名任一，再叠加标签子串。未归组的表情包也能用
    /// `包名*表情` 搜到。
    FuzzyGroup,
    /// 普通跨字段子串 LIKE（文件名 / 标签名 / 分组名 OR）。
    PlainLike,
}

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
    /// 记录最后修改时间（ms）。新表情初始 = 导入时间；元数据被改动时由
    /// `touch_updated_at` / 命令层刷新。
    pub updated_at: i64,
    pub is_favorite: bool,
    /// dHash 的 i64 位保持表示（经 perceptual_hash::to_db）。
    pub perceptual_hash: Option<i64>,
    /// 分组归属。用枚举而非两个可同时为 Some 的 Option，从类型上杜绝歧义。
    pub group: ImportGroup,
}

/// 分组归属（文件夹导入时由顶层子文件夹派生）。
///
/// 解析/创建发生在 `insert_managed` 的**同一事务**内：任何失败都会回滚，
/// 绝不产生空组。
#[derive(Debug, Clone)]
pub enum ImportGroup {
    None,
    Existing(i64),
    ByName(String),
}

/// `insert_managed` 的结果：emoji id + 实际使用的分组（若本次真正 INSERT
/// 了分组行，`group_created` 为 true —— 只有它才计入 `groups_created`）。
#[derive(Debug)]
pub struct InsertResult {
    pub emoji_id: i64,
    pub group_id: Option<i64>,
    pub group_created: bool,
}

/// 列表查询过滤选项。
pub struct ListOptions<'a> {
    pub view: &'a str,
    pub group_id: Option<i64>,
    pub favorite_only: bool,
    /// 排序偏好：`"recent"` → 最近使用优先（未用过的按导入时间排后）。默认空。
    pub sort: Option<String>,
    pub limit: u32,
    pub offset: u32,
}

pub struct EmojiRelations {
    pub group_ids: Vec<i64>,
    pub tag_ids: Vec<i64>,
}

/// 去重命中的种类：SHA-256 字节级相同（直接跳过） vs dHash 感知命中（疑似重复）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DedupHitKind {
    ExactSha,
    Perceptual { hamming: u32 },
}

/// 内容去重命中结果，携带候选行（含可读路径）供调用方检查文件存在性。
pub struct DedupHit {
    pub existing: IndexedImage,
    pub kind: DedupHitKind,
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
        _indexed_at: i64,
    ) -> Result<usize, String> {
        if records.is_empty() {
            return Ok(0);
        }

        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始最近使用数据迁移事务：{error}"))?;
        let mut matched_count = 0usize;

        {
            let mut statement = transaction
                .prepare_cached(
                    r#"
                    UPDATE emojis SET
                        last_used_at = CASE
                            WHEN emojis.last_used_at IS NULL THEN ?1
                            ELSE MAX(emojis.last_used_at, ?1)
                        END,
                        usage_count = MAX(emojis.usage_count, ?2)
                    WHERE is_deleted = 0
                      AND source_type IN ('managed_import', 'clipboard')
                      AND (managed_path = ?3 OR source_path = ?3)
                    "#,
                )
                .map_err(|error| format!("无法准备最近使用数据迁移语句：{error}"))?;

            for record in records {
                let changed = statement
                    .execute(params![
                        to_i64(record.last_used_at),
                        to_i64(record.use_count),
                        record.item.path,
                    ])
                    .map_err(|error| {
                        format!("无法迁移最近使用图片 {}：{error}", record.item.path)
                    })?;
                if changed > 0 {
                    matched_count += 1;
                }
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("无法提交最近使用数据迁移：{error}"))?;
        Ok(matched_count)
    }

    pub fn find_managed_by_sha256(
        connection: &Connection,
        sha256: &str,
    ) -> Result<Option<IndexedImage>, String> {
        connection
            .query_row(
                r#"
                SELECT id, original_filename, source_path, file_extension, width, height, file_size
                FROM emojis
                WHERE sha256 = ?1
                  AND source_type IN ('managed_import', 'clipboard')
                  AND is_deleted = 0
                LIMIT 1
                "#,
                [sha256],
                |row| {
                    Ok(IndexedImage {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        path: row.get(2)?,
                        extension: row.get(3)?,
                        width: row.get::<_, u32>(4)?,
                        height: row.get::<_, u32>(5)?,
                        size_bytes: row.get::<_, u64>(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("无法查询素材哈希：{error}"))
    }

    pub fn find_by_source_path(
        connection: &Connection,
        source_path: &str,
    ) -> Result<Option<IndexedImage>, String> {
        connection
            .query_row(
                r#"
                SELECT id, original_filename, source_path, file_extension, width, height, file_size
                FROM emojis
                WHERE source_path = ?1 AND is_deleted = 0
                LIMIT 1
                "#,
                [source_path],
                |row| {
                    Ok(IndexedImage {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        path: row.get(2)?,
                        extension: row.get(3)?,
                        width: row.get(4)?,
                        height: row.get(5)?,
                        size_bytes: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("无法读取表情记录：{error}"))
    }

    pub fn find_by_id(connection: &Connection, id: i64) -> Result<Option<IndexedImage>, String> {
        connection
            .query_row(
                r#"
                SELECT id, original_filename, source_path, file_extension, width, height, file_size
                FROM emojis
                WHERE id = ?1 AND is_deleted = 0
                LIMIT 1
                "#,
                [id],
                |row| {
                    Ok(IndexedImage {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        path: row.get(2)?,
                        extension: row.get(3)?,
                        width: row.get(4)?,
                        height: row.get(5)?,
                        size_bytes: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("无法读取表情记录：{error}"))
    }

    /// 内容去重：先精确 SHA-256（字节级），未命中且未跳过感知去重时，
    /// 对活跃受管行做 dHash 全表 Hamming 扫描（阈值内稳定候选按
    /// (Hamming, id) 升序取最优）。
    ///
    /// 感知扫描不建 B-tree 索引：普通索引对 Hamming 距离无加速，千级库
    /// 全表扫描毫秒级（见 migration 0004 注释）。
    pub fn find_duplicate_content(
        connection: &Connection,
        sha256: &str,
        perceptual_hash: Option<i64>,
        threshold: u32,
        skip_perceptual_dedup: bool,
    ) -> Result<Option<DedupHit>, String> {
        // 1) SHA-256 字节级命中 → ExactSha，直接判重。
        if let Some(existing) = Self::find_managed_by_sha256(connection, sha256)? {
            return Ok(Some(DedupHit {
                existing,
                kind: DedupHitKind::ExactSha,
            }));
        }
        // 2) 跳过感知去重（强制导入）或没有感知哈希 → 无命中。
        if skip_perceptual_dedup {
            return Ok(None);
        }
        let Some(hash) = perceptual_hash else {
            return Ok(None);
        };
        let hash = from_db(hash);

        // 3) dHash 感知扫描：收集阈值内候选，按 (Hamming, id) 稳定排序。
        let candidates = Self::list_perceptual_candidates(connection)?;
        let mut matches: Vec<(u32, i64)> = candidates
            .into_iter()
            .filter(|(_, candidate_hash)| {
                hamming_distance(hash, from_db(*candidate_hash)) <= threshold
            })
            .map(|(id, candidate_hash)| (hamming_distance(hash, from_db(candidate_hash)), id))
            .collect();
        matches.sort_by_key(|&(distance, id)| (distance, id));

        let Some((distance, candidate_id)) = matches.first().copied() else {
            return Ok(None);
        };
        let existing = Self::find_by_id(connection, candidate_id)?
            .ok_or_else(|| format!("感知重复候选 {candidate_id} 已不存在。"))?;
        Ok(Some(DedupHit {
            existing,
            kind: DedupHitKind::Perceptual { hamming: distance },
        }))
    }

    /// 取活跃受管行中 `perceptual_hash IS NULL` 的记录（供惰性回填）。
    pub fn list_null_perceptual(
        connection: &Connection,
        limit: i64,
    ) -> Result<Vec<(i64, String)>, String> {
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, managed_path FROM emojis
                WHERE perceptual_hash IS NULL
                  AND is_deleted = 0
                  AND managed_path IS NOT NULL
                LIMIT ?1
                "#,
            )
            .map_err(|error| format!("无法准备感知哈希回填查询：{error}"))?;
        let rows = statement
            .query_map([limit], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| format!("无法读取感知哈希回填候选：{error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析感知哈希回填候选：{error}"))
    }

    /// 回填单条感知哈希。`IS NULL` 守卫保证不重复回填 / 覆盖已有值。
    pub fn update_perceptual_hash(
        connection: &mut Connection,
        id: i64,
        hash: i64,
    ) -> Result<(), String> {
        connection
            .execute(
                "UPDATE emojis SET perceptual_hash = ?1
                 WHERE id = ?2 AND perceptual_hash IS NULL",
                params![hash, id],
            )
            .map_err(|error| format!("无法写入感知哈希：{error}"))?;
        Ok(())
    }

    /// 取没有任何标签的活跃受管行（供文件名标签回填）。跳过回收站行。
    pub fn list_untagged_emojis(
        connection: &Connection,
        limit: i64,
    ) -> Result<Vec<(i64, String)>, String> {
        let mut statement = connection
            .prepare(
                r#"
                SELECT e.id, e.original_filename FROM emojis e
                WHERE e.is_deleted = 0
                  AND NOT EXISTS (SELECT 1 FROM emoji_tags et WHERE et.emoji_id = e.id)
                LIMIT ?1
                "#,
            )
            .map_err(|error| format!("无法准备标签回填查询：{error}"))?;
        let rows = statement
            .query_map([limit], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| format!("无法读取标签回填候选：{error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析标签回填候选：{error}"))
    }

    /// 刷新一批表情的"最后修改时间"（updated_at）。元数据被用户改动时调用。
    /// 空列表直接返回。时间戳在方法内取当前毫秒。
    pub fn touch_updated_at(connection: &Connection, emoji_ids: &[i64]) -> Result<(), String> {
        if emoji_ids.is_empty() {
            return Ok(());
        }
        let now = unix_time_millis();
        let placeholders = std::iter::repeat_n("?", emoji_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("UPDATE emojis SET updated_at = ?1 WHERE id IN ({placeholders})");
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(emoji_ids.len() + 1);
        params_vec.push(Box::new(now));
        for id in emoji_ids {
            params_vec.push(Box::new(*id));
        }
        let bound: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
        connection
            .execute(&sql, rusqlite::params_from_iter(bound))
            .map_err(|error| format!("无法刷新修改时间：{error}"))?;
        Ok(())
    }

    /// 加载活跃受管行的 (id, perceptual_hash) 作为感知扫描候选集。
    fn list_perceptual_candidates(connection: &Connection) -> Result<Vec<(i64, i64)>, String> {
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, perceptual_hash FROM emojis
                WHERE perceptual_hash IS NOT NULL
                  AND is_deleted = 0
                  AND source_type IN ('managed_import', 'clipboard')
                "#,
            )
            .map_err(|error| format!("无法准备感知哈希扫描：{error}"))?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| format!("无法读取感知哈希候选：{error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析感知哈希候选：{error}"))
    }

    /// 写入 emoji 记录；若给了分组归属，在**同一事务**内解析/创建分组并写
    /// `emoji_groups` 关联。任何失败整体回滚 —— 分组行随 emoji 一起消失，
    /// 绝不产生空组（重复 / 失败 / 回滚均不建组）。
    pub fn insert_managed(
        connection: &mut Connection,
        emoji: &NewManagedEmoji<'_>,
    ) -> Result<InsertResult, String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始素材记录事务：{error}"))?;

        let (group_id, group_created) = match &emoji.group {
            ImportGroup::None => (None, false),
            ImportGroup::Existing(id) => (Some(*id), false),
            ImportGroup::ByName(name) => {
                let trimmed = name.trim();
                if trimmed.is_empty() {
                    return Err("分组名称不能为空。".to_string());
                }
                let existing = transaction
                    .query_row(
                        "SELECT id FROM groups WHERE name = ?1 COLLATE NOCASE",
                        [trimmed],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()
                    .map_err(|error| format!("无法查询分组：{error}"))?;
                match existing {
                    Some(id) => (Some(id), false),
                    None => {
                        let now = unix_time_millis();
                        transaction
                            .execute(
                                "INSERT INTO groups (name, sort_order, created_at, updated_at)
                                 VALUES (?1, 0, ?2, ?2)",
                                params![trimmed, now],
                            )
                            .map_err(|error| format!("无法新建分组 {trimmed}：{error}"))?;
                        (Some(transaction.last_insert_rowid()), true)
                    }
                }
            }
        };

        transaction
            .execute(
                r#"
                INSERT INTO emojis (
                    source_type, source_path, managed_path, original_filename,
                    file_extension, file_size, sha256, width, height,
                    thumbnail_path, imported_at, indexed_at, last_used_at,
                    usage_count, is_favorite, is_deleted, perceptual_hash, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4,
                    ?5, ?6, ?7, ?8, ?9,
                    ?10, ?11, ?12, NULL,
                    0, ?13, 0, ?14, ?15
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
                    emoji.perceptual_hash,
                    emoji.updated_at,
                ],
            )
            .map_err(|error| format!("无法写入素材记录：{error}"))?;
        let emoji_id = transaction.last_insert_rowid();

        if let Some(group_id) = group_id {
            let now = unix_time_millis();
            transaction
                .execute(
                    "INSERT OR IGNORE INTO emoji_groups (emoji_id, group_id, added_at)
                     VALUES (?1, ?2, ?3)",
                    params![emoji_id, group_id, now],
                )
                .map_err(|error| format!("无法写入分组关联：{error}"))?;
        }

        transaction
            .commit()
            .map_err(|error| format!("无法提交素材记录：{error}"))?;

        Ok(InsertResult {
            emoji_id,
            group_id,
            group_created,
        })
    }

    // ---- 第六阶段新增方法 ----

    /// 列表查询（排除 is_deleted=1）。path 投影 COALESCE(managed_path, source_path)。
    ///
    /// 查询语法：`组名*标签名` / `组名*` / `*标签名` 为主（全角 `＊` 也支持，
    /// `:` / `：` 保留为别名）走**精确 AND**（NOCASE 精确匹配分组名 / 标签名）；
    /// 精确命中为空时依次回退到「组精确 + 标签 LIKE」→「组名子串（分组/文件名/
    /// 标签名任一）+ 标签 LIKE」→ 普通 LIKE（跨字段 OR）。无分隔符 → 直接普通 LIKE。
    pub fn list_indexed(
        connection: &Connection,
        options: &ListOptions<'_>,
        query: &str,
        tag_ids: &[i64],
    ) -> Result<Vec<IndexedEmoji>, String> {
        let trimmed = query.trim();
        let Some((group, tag)) = parse_exact_query(trimmed) else {
            return Self::list_indexed_impl(
                connection,
                options,
                trimmed,
                tag_ids,
                SearchMode::PlainLike,
            );
        };
        let exact =
            Self::list_indexed_impl(connection, options, trimmed, tag_ids, SearchMode::Exact)?;
        if !exact.is_empty() {
            return Ok(exact);
        }
        // 只有标签部分存在时 Lenient 才有意义（组精确 + 标签 LIKE）。
        if tag.is_some() {
            let lenient = Self::list_indexed_impl(
                connection,
                options,
                trimmed,
                tag_ids,
                SearchMode::Lenient,
            )?;
            if !lenient.is_empty() {
                return Ok(lenient);
            }
        }
        // 组名精确匹配不到（分组不存在 / 表情未归组）时，让组名子串去命中
        // 分组名 / 文件名 / 标签名，再叠加标签条件 —— 未归组的包也能 `包名*表情`。
        if group.is_some() {
            let fuzzy = Self::list_indexed_impl(
                connection,
                options,
                trimmed,
                tag_ids,
                SearchMode::FuzzyGroup,
            )?;
            if !fuzzy.is_empty() {
                return Ok(fuzzy);
            }
        }
        log::debug!("精确搜索无结果，回退普通 LIKE：query={trimmed}");
        Self::list_indexed_impl(connection, options, trimmed, tag_ids, SearchMode::PlainLike)
    }

    /// 锁步参数绑定：SQL 的 `?` 出现顺序与 `params` Vec 完全一致，不再用手工编号。
    /// ORDER BY 由 Rust 按 `view` / `sort` 分支输出字面量，不绑定 view 参数。
    fn list_indexed_impl(
        connection: &Connection,
        options: &ListOptions<'_>,
        trimmed: &str,
        tag_ids: &[i64],
        mode: SearchMode,
    ) -> Result<Vec<IndexedEmoji>, String> {
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let mut where_clause = String::from("WHERE is_deleted = 0");
        let view_clause = build_view_filter(options, &mut params);
        if !view_clause.is_empty() {
            where_clause.push(' ');
            where_clause.push_str(&view_clause);
        }

        if !trimmed.is_empty() {
            match mode {
                SearchMode::Exact | SearchMode::Lenient => {
                    let parsed = parse_exact_query(trimmed).expect("精确分支必有语法");
                    // Lenient 只把标签约束放宽为 LIKE，组约束始终精确。
                    let tag_constraint = match mode {
                        SearchMode::Exact => "t.name = ? COLLATE NOCASE",
                        SearchMode::Lenient => "t.name LIKE '%' || ? || '%' COLLATE NOCASE",
                        SearchMode::FuzzyGroup | SearchMode::PlainLike => {
                            unreachable!("非 Exact/Lenient 不进本分支")
                        }
                    };
                    match parsed {
                        (Some(group), Some(tag)) => {
                            where_clause.push_str(
                                " AND EXISTS (SELECT 1 FROM emoji_groups eg JOIN groups g ON g.id = eg.group_id \
                                   WHERE eg.emoji_id = e.id AND g.name = ? COLLATE NOCASE)",
                            );
                            params.push(Box::new(group));
                            where_clause.push_str(&format!(
                                " AND EXISTS (SELECT 1 FROM emoji_tags et JOIN tags t ON t.id = et.tag_id \
                                   WHERE et.emoji_id = e.id AND {tag_constraint})"
                            ));
                            params.push(Box::new(tag));
                        }
                        (Some(group), None) => {
                            where_clause.push_str(
                                " AND EXISTS (SELECT 1 FROM emoji_groups eg JOIN groups g ON g.id = eg.group_id \
                                   WHERE eg.emoji_id = e.id AND g.name = ? COLLATE NOCASE)",
                            );
                            params.push(Box::new(group));
                        }
                        (None, Some(tag)) => {
                            where_clause.push_str(&format!(
                                " AND EXISTS (SELECT 1 FROM emoji_tags et JOIN tags t ON t.id = et.tag_id \
                                   WHERE et.emoji_id = e.id AND {tag_constraint})"
                            ));
                            params.push(Box::new(tag));
                        }
                        (None, None) => {}
                    }
                }
                SearchMode::FuzzyGroup => {
                    let (Some(group_term), tag) =
                        parse_exact_query(trimmed).expect("精确分支必有语法")
                    else {
                        unreachable!("FuzzyGroup 仅当组名部分存在时调用");
                    };
                    // 组名子串命中 分组名 / 文件名 / 标签名 任一（绑定 3 次）。
                    where_clause.push_str(
                        " AND (EXISTS (SELECT 1 FROM emoji_groups eg JOIN groups g ON g.id = eg.group_id \
                                    WHERE eg.emoji_id = e.id AND g.name LIKE '%' || ? || '%' COLLATE NOCASE) \
                            OR LOWER(e.original_filename) LIKE '%' || LOWER(?) || '%' COLLATE NOCASE \
                            OR EXISTS (SELECT 1 FROM emoji_tags et JOIN tags t ON t.id = et.tag_id \
                                       WHERE et.emoji_id = e.id AND t.name LIKE '%' || ? || '%' COLLATE NOCASE))",
                    );
                    params.push(Box::new(group_term.clone()));
                    params.push(Box::new(group_term.clone()));
                    params.push(Box::new(group_term));
                    if let Some(tag) = tag {
                        where_clause.push_str(
                            " AND EXISTS (SELECT 1 FROM emoji_tags et JOIN tags t ON t.id = et.tag_id \
                               WHERE et.emoji_id = e.id AND t.name LIKE '%' || ? || '%' COLLATE NOCASE)",
                        );
                        params.push(Box::new(tag));
                    }
                }
                SearchMode::PlainLike => {
                    // 普通 LIKE：跨字段 OR（文件名 / 标签名 / 分组名），绑定 3 次。
                    where_clause.push_str(
                        " AND (LOWER(e.original_filename) LIKE '%' || LOWER(?) || '%' COLLATE NOCASE \
                            OR EXISTS (SELECT 1 FROM emoji_tags et JOIN tags t ON t.id = et.tag_id \
                                       WHERE et.emoji_id = e.id AND LOWER(t.name) LIKE '%' || LOWER(?) || '%' COLLATE NOCASE) \
                            OR EXISTS (SELECT 1 FROM emoji_groups eg JOIN groups g ON g.id = eg.group_id \
                                       WHERE eg.emoji_id = e.id AND LOWER(g.name) LIKE '%' || LOWER(?) || '%' COLLATE NOCASE))",
                    );
                    params.push(Box::new(trimmed.to_string()));
                    params.push(Box::new(trimmed.to_string()));
                    params.push(Box::new(trimmed.to_string()));
                }
            }
        }

        // tag_ids AND 过滤（除法语义：emoji 必须同时拥有所有给定标签）。
        if !tag_ids.is_empty() {
            let placeholders = std::iter::repeat_n("?", tag_ids.len())
                .collect::<Vec<_>>()
                .join(",");
            where_clause.push_str(&format!(
                " AND NOT EXISTS ( \
                    SELECT 1 FROM (SELECT {placeholders} AS tag_id) required \
                    WHERE required.tag_id IS NOT NULL \
                      AND NOT EXISTS (SELECT 1 FROM emoji_tags et \
                                      WHERE et.emoji_id = e.id AND et.tag_id = required.tag_id) \
                  )"
            ));
            for id in tag_ids {
                params.push(Box::new(*id));
            }
        }

        // ORDER BY：view / sort 是自家常量，直接分支输出字面量，无注入面。
        let order_by = match options.sort.as_deref() {
            Some("recent") => {
                "(e.last_used_at IS NULL) ASC, e.last_used_at DESC, \
                 COALESCE(e.imported_at, e.indexed_at) DESC"
            }
            _ if options.view == "search-recent" => "e.last_used_at DESC",
            _ => {
                "e.is_favorite DESC, COALESCE(e.imported_at, e.indexed_at) DESC, \
                  e.original_filename COLLATE NOCASE ASC"
            }
        };

        let sql = format!(
            "SELECT id, original_filename, \
                    COALESCE(managed_path, source_path) AS current_path, \
                    thumbnail_path, file_extension, width, height, file_size, \
                    source_type, is_favorite, last_used_at, usage_count, \
                    imported_at, updated_at \
             FROM emojis e {where_clause} \
             ORDER BY {order_by} \
             LIMIT ? OFFSET ?"
        );
        params.push(Box::new(options.limit as i64));
        params.push(Box::new(options.offset as i64));

        let started = Instant::now();
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("无法准备表情列表查询：{error}"))?;
        let bound_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();
        let mut items: Vec<IndexedEmoji> = statement
            .query_map(rusqlite::params_from_iter(bound_refs), row_to_indexed_emoji)
            .map_err(|error| format!("无法读取表情列表：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析表情列表：{error}"))?;
        log::debug!(
            "list_indexed(view={}, query={trimmed:?}, mode={mode:?}) 命中 {} 条，耗时 {:?}",
            options.view,
            items.len(),
            started.elapsed()
        );
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
                       source_type, is_favorite, last_used_at, usage_count,
                       imported_at, updated_at
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
                       source_type, is_favorite, last_used_at, usage_count,
                       imported_at, updated_at
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
                        id: item.id,
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
        result.sort_by_key(|a| std::cmp::Reverse(a.last_used_at));
        Ok(result)
    }

    /// 给 recent 列表填充关联字段。
    pub fn fill_relations_for_recent(
        connection: &Connection,
        records: &mut [crate::recent::RecentImageRecord],
    ) -> Result<(), String> {
        if records.is_empty() {
            return Ok(());
        }
        let paths: Vec<String> = records.iter().map(|r| r.item.path.clone()).collect();
        let placeholders = std::iter::repeat_n("?", paths.len())
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
            if let Some(&id) = path_to_id.get(&record.item.path)
                && let Some(r) = relations.get(&id)
            {
                record.group_ids = r.group_ids.clone();
                record.tag_ids = r.tag_ids.clone();
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
        let placeholders = std::iter::repeat_n("?", ids.len())
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
        let placeholders = std::iter::repeat_n("?", ids.len())
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
        for item in bound_all.iter().skip(1) {
            bound_select.push(*item);
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
        let bound_update: Vec<&dyn rusqlite::ToSql> =
            bound_all.iter().take(1 + ids.len()).copied().collect();
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
        let placeholders = std::iter::repeat_n("?", ids.len())
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
        let placeholders = std::iter::repeat_n("?", ids.len())
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

        let delete_sql =
            format!("DELETE FROM emojis WHERE id IN ({placeholders}) AND is_deleted = 1");
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
        let placeholders = std::iter::repeat_n("?", emoji_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "DELETE FROM emoji_groups WHERE group_id = ?1 AND emoji_id IN ({placeholders})"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(emoji_ids.len() + 1);
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
        let placeholders_emoji = std::iter::repeat_n("?", emoji_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let placeholders_tag = std::iter::repeat_n("?", tag_ids.len())
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
        items: &mut [IndexedEmoji],
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
        let placeholders = std::iter::repeat_n("?", emoji_ids.len())
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

        let tag_sql =
            format!("SELECT emoji_id, tag_id FROM emoji_tags WHERE emoji_id IN ({placeholders})");
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
        imported_at: row.get(12)?,
        modified_at: row.get(13)?,
        group_ids: Vec::new(),
        tag_ids: Vec::new(),
    })
}

/// 解析精确语法：`组名*标签名` 为主（全角 `＊` 归一化），`组名:标签名`
/// 保留为别名（全角 `：` 归一化）。在最早出现的 `*` 或 `:` 处切分成两部分。
/// 返回 `(组名, 标签名)`；无分隔符或两侧都为空 → `None`（走普通 LIKE）。
fn parse_exact_query(query: &str) -> Option<(Option<String>, Option<String>)> {
    let normalized = query.replace('：', ":").replace('＊', "*");
    let star = normalized.find('*');
    let colon = normalized.find(':');
    let sep = match (star, colon) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    };
    let sep_pos = sep?;
    let left = normalized[..sep_pos].trim();
    let right = normalized[sep_pos + 1..].trim();
    if left.is_empty() && right.is_empty() {
        return None;
    }
    Some((
        (!left.is_empty()).then(|| left.to_string()),
        (!right.is_empty()).then(|| right.to_string()),
    ))
}

fn build_view_filter(
    options: &ListOptions<'_>,
    params: &mut Vec<Box<dyn rusqlite::ToSql>>,
) -> String {
    let mut fragments: Vec<String> = Vec::new();
    match options.view {
        "favorites" => fragments.push("e.is_favorite = 1".to_string()),
        "ungrouped" => fragments.push(
            "NOT EXISTS (SELECT 1 FROM emoji_groups eg WHERE eg.emoji_id = e.id)".to_string(),
        ),
        "search-recent" => fragments.push("e.last_used_at IS NOT NULL".to_string()),
        "group" => {
            if let Some(gid) = options.group_id {
                fragments.push(
                    "EXISTS (SELECT 1 FROM emoji_groups eg WHERE eg.emoji_id = e.id \
                     AND eg.group_id = ?)"
                        .to_string(),
                );
                params.push(Box::new(gid));
            }
        }
        _ => {}
    }
    if options.favorite_only {
        fragments.push("e.is_favorite = 1".to_string());
    }
    if fragments.is_empty() {
        String::new()
    } else {
        format!("AND {}", fragments.join(" AND "))
    }
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
    use rusqlite::{Connection, OptionalExtension};

    use super::{DedupHitKind, EmojiRepository, ImportGroup, ListOptions, NewManagedEmoji};
    use crate::{
        database::run_migrations,
        perceptual_hash::{from_db, to_db},
        recent::RecentImageRecord,
        scanner::IndexedImage,
    };

    fn image(path: &str) -> IndexedImage {
        IndexedImage {
            id: 0,
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
            group_ids: Vec::new(),
            tag_ids: Vec::new(),
        }
    }

    #[test]
    fn legacy_recent_import_updates_existing_managed_rows_only() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        // 先造一条受管行（source_path == managed_path == 记录路径）。
        insert_managed(
            &mut connection,
            "C:\\emoji.png",
            "sha1",
            Some(to_db(1)),
            false,
        );

        let matched = EmojiRepository::import_legacy_recent(
            &mut connection,
            &[recent("C:\\emoji.png", 100, 2)],
            10,
        )
        .expect("first migrate");
        assert_eq!(matched, 1);
        EmojiRepository::import_legacy_recent(
            &mut connection,
            &[recent("C:\\emoji.png", 90, 1)],
            20,
        )
        .expect("second migrate");

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
        assert_eq!(row, (1, 100, 2), "MAX 保留最新值，且不新增行");

        // 外部索引路径（不存在于受管行）→ 跳过，绝不创建 external 行。
        let matched_external = EmojiRepository::import_legacy_recent(
            &mut connection,
            &[recent("D:\\old-external\\x.png", 50, 1)],
            30,
        )
        .expect("external migrate");
        assert_eq!(matched_external, 0);
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM emojis", [], |row| row.get(0))
            .expect("count");
        assert_eq!(count, 1, "不应为外部路径创建 external 行");
    }

    fn managed_emoji(
        path: &'static str,
        sha256: &'static str,
        group: ImportGroup,
    ) -> NewManagedEmoji<'static> {
        NewManagedEmoji {
            source_type: "managed_import",
            source_path: path,
            managed_path: path,
            original_filename: "m.png",
            file_extension: "png",
            file_size: 1,
            sha256,
            width: 1,
            height: 1,
            thumbnail_path: "/t.png",
            imported_at: 0,
            indexed_at: 0,
            updated_at: 0,
            is_favorite: false,
            perceptual_hash: None,
            group,
        }
    }

    /// 插入带分组/标签的 emoji，返回 id。
    fn insert_indexed_emoji(
        connection: &mut Connection,
        name: &str,
        group_name: Option<&str>,
        tag_names: &[&str],
        last_used_at: Option<i64>,
    ) -> i64 {
        connection
            .execute(
                "INSERT INTO emojis (source_type, source_path, managed_path, original_filename, file_extension, file_size, sha256, width, height, thumbnail_path, imported_at, indexed_at, last_used_at, usage_count, is_favorite, is_deleted)
                 VALUES ('managed_import', ?1, ?1, ?2, 'png', 1, ?1, 1, 1, NULL, 0, 0, ?3, 0, 0, 0)",
                rusqlite::params![format!("/{name}.png"), name, last_used_at],
            )
            .expect("insert emoji");
        let id = connection.last_insert_rowid();

        if let Some(group) = group_name {
            let group_id = get_or_insert_name(connection, "groups", group);
            connection
                .execute(
                    "INSERT INTO emoji_groups (emoji_id, group_id, added_at) VALUES (?1, ?2, 0)",
                    rusqlite::params![id, group_id],
                )
                .expect("insert relation");
        }
        for tag in tag_names {
            let tag_id = get_or_insert_name(connection, "tags", tag);
            connection
                .execute(
                    "INSERT INTO emoji_tags (emoji_id, tag_id, added_at) VALUES (?1, ?2, 0)",
                    rusqlite::params![id, tag_id],
                )
                .expect("insert emoji_tag");
        }
        id
    }

    fn get_or_insert_name(connection: &mut Connection, table: &str, name: &str) -> i64 {
        let existing: Option<i64> = connection
            .query_row(
                &format!("SELECT id FROM {table} WHERE name = ?1 COLLATE NOCASE"),
                [name],
                |row| row.get(0),
            )
            .optional()
            .expect("query name");
        match existing {
            Some(id) => id,
            None => {
                let sql = match table {
                    "groups" => {
                        "INSERT INTO groups (name, sort_order, created_at, updated_at)
                         VALUES (?1, 0, 0, 0)"
                    }
                    _ => "INSERT INTO tags (name, created_at) VALUES (?1, 0)",
                };
                connection.execute(sql, [name]).expect("insert name");
                connection.last_insert_rowid()
            }
        }
    }

    fn list_opts<'a>(
        view: &'a str,
        group_id: Option<i64>,
        sort: Option<&'a str>,
    ) -> ListOptions<'a> {
        ListOptions {
            view,
            group_id,
            favorite_only: false,
            sort: sort.map(str::to_string),
            limit: 50,
            offset: 0,
        }
    }

    #[test]
    fn list_indexed_binding_matrix_combines_query_tags_group_view() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_indexed_emoji(&mut connection, "a.png", Some("猫猫"), &["表情"], None);
        insert_indexed_emoji(&mut connection, "b.png", Some("狗狗"), &["表情"], None);

        let tag_id: i64 = connection
            .query_row("SELECT id FROM tags WHERE name = '表情'", [], |row| {
                row.get(0)
            })
            .expect("tag id");
        let group_id: i64 = connection
            .query_row("SELECT id FROM groups WHERE name = '猫猫'", [], |row| {
                row.get(0)
            })
            .expect("group id");

        // query + tag_ids + view(group) + limit/offset 全部同时存在。
        let items = EmojiRepository::list_indexed(
            &connection,
            &list_opts("group", Some(group_id), None),
            "a",
            &[tag_id],
        )
        .expect("query");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "a.png");

        // 全视图 + query + tag_ids。
        let items = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, None),
            "a",
            &[tag_id],
        )
        .expect("query all");
        assert_eq!(items.len(), 1);

        // limit=1 截断。
        let mut opts = list_opts("all", None, None);
        opts.limit = 1;
        let items = EmojiRepository::list_indexed(&connection, &opts, "", &[]).expect("limit");
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn list_indexed_exact_group_tag_nocase() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_indexed_emoji(&mut connection, "a.png", Some("Cat"), &["Cool"], None);
        insert_indexed_emoji(&mut connection, "b.png", Some("Cat"), &["Warm"], None);

        // NOCASE 精确匹配：小写 query 命中大写名。
        let items = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, None),
            "cat:cool",
            &[],
        )
        .expect("exact");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "a.png");
    }

    #[test]
    fn list_indexed_group_only_and_tag_only() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_indexed_emoji(&mut connection, "a.png", Some("猫猫"), &["表情"], None);
        insert_indexed_emoji(&mut connection, "b.png", Some("狗狗"), &["表情"], None);

        // 组名:（仅分组）。
        let items =
            EmojiRepository::list_indexed(&connection, &list_opts("all", None, None), "猫猫:", &[])
                .expect("group only");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "a.png");

        // :标签（仅标签）。
        let items =
            EmojiRepository::list_indexed(&connection, &list_opts("all", None, None), ":表情", &[])
                .expect("tag only");
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn list_indexed_exact_falls_back_to_like_on_empty() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        // 文件名含字面 "foo:bar"，但精确语法组="foo" 标签="bar" 查不到。
        insert_indexed_emoji(&mut connection, "foo:bar.png", Some("猫猫"), &[], None);

        // 精确 AND 空 → 回退普通 LIKE → 命中含 "foo:bar" 的名字。
        let items = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, None),
            "foo:bar",
            &[],
        )
        .expect("fallback");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "foo:bar.png");
    }

    #[test]
    fn list_indexed_full_width_colon() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_indexed_emoji(&mut connection, "a.png", Some("猫猫"), &["表情"], None);

        let items = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, None),
            "猫猫：表情",
            &[],
        )
        .expect("full-width colon");
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn list_indexed_exact_group_tag_star() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_indexed_emoji(&mut connection, "a.png", Some("Cat"), &["Cool"], None);
        insert_indexed_emoji(&mut connection, "b.png", Some("Cat"), &["Warm"], None);

        // NOCASE 精确匹配，`*` 分隔符。
        let items = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, None),
            "cat*cool",
            &[],
        )
        .expect("exact");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "a.png");
    }

    #[test]
    fn list_indexed_star_group_only_and_tag_only() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_indexed_emoji(&mut connection, "a.png", Some("猫猫"), &["表情"], None);
        insert_indexed_emoji(&mut connection, "b.png", Some("狗狗"), &["表情"], None);

        // 组名*（仅分组）。
        let items =
            EmojiRepository::list_indexed(&connection, &list_opts("all", None, None), "猫猫*", &[])
                .expect("group only");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "a.png");

        // *标签（仅标签）。
        let items =
            EmojiRepository::list_indexed(&connection, &list_opts("all", None, None), "*表情", &[])
                .expect("tag only");
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn list_indexed_full_width_star() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_indexed_emoji(&mut connection, "a.png", Some("猫猫"), &["表情"], None);

        let items = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, None),
            "猫猫＊表情",
            &[],
        )
        .expect("full-width star");
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn list_indexed_star_lenient_fallback_matches_tag_stem() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        // 标签存的是完整文件名 "开心.png"（导入自动打标签），查询只输 stem "开心"。
        insert_indexed_emoji(
            &mut connection,
            "开心.png",
            Some("猫猫"),
            &["开心.png"],
            None,
        );
        insert_indexed_emoji(
            &mut connection,
            "难过.png",
            Some("猫猫"),
            &["难过.png"],
            None,
        );

        // 精确命中：组*完整文件名（与网格显示名一致）。
        let exact = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, None),
            "猫猫*开心.png",
            &[],
        )
        .expect("exact full");
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].name, "开心.png");

        // 精确 miss（只输 stem）→ 宽松回退（组精确 + 标签 LIKE）仍命中。
        let lenient = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, None),
            "猫猫*开心",
            &[],
        )
        .expect("lenient stem");
        assert_eq!(lenient.len(), 1);
        assert_eq!(lenient[0].name, "开心.png");
    }

    #[test]
    fn list_indexed_star_lenient_fallback_matches_partial_tag() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_indexed_emoji(&mut connection, "a.png", Some("猫猫"), &["开心大笑"], None);

        // 精确标签 "开心" 不存在 → 宽松回退按子串命中 "开心大笑"。
        let items = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, None),
            "猫猫*开心",
            &[],
        )
        .expect("lenient partial");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "a.png");
    }

    #[test]
    fn list_indexed_star_fuzzy_group_matches_ungrouped_pack() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        // 未归组的表情包：无 `2233` 分组，表情文件名含 `2233`，手动打了 `来吗` 标签。
        insert_indexed_emoji(
            &mut connection,
            "[2233绘梦酱_吹哨子].png",
            None,
            &["来吗"],
            None,
        );
        insert_indexed_emoji(&mut connection, "别包.png", None, &["来吗"], None);

        // 组名精确不存在 → FuzzyGroup：文件名含 2233 且标签含 来吗。
        let items = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, None),
            "2233*来吗",
            &[],
        )
        .expect("fuzzy group");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "[2233绘梦酱_吹哨子].png");

        // 只搜标签仍精确命中两个。
        let items =
            EmojiRepository::list_indexed(&connection, &list_opts("all", None, None), "*来吗", &[])
                .expect("tag only");
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn list_indexed_star_fuzzy_group_only_matches_filename_contains() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_indexed_emoji(&mut connection, "[2233绘梦酱_A].png", None, &[], None);
        insert_indexed_emoji(&mut connection, "[2233绘梦酱_B].png", None, &[], None);
        insert_indexed_emoji(&mut connection, "其他.png", None, &[], None);

        // 组名部分单独存在、精确组不存在 → FuzzyGroup 按文件名子串命中。
        let items =
            EmojiRepository::list_indexed(&connection, &list_opts("all", None, None), "2233*", &[])
                .expect("fuzzy group only");
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn list_indexed_sort_recent_orders_used_first_and_includes_unused() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_indexed_emoji(&mut connection, "unused.png", None, &[], None);
        insert_indexed_emoji(&mut connection, "used.png", None, &[], Some(100));

        let items = EmojiRepository::list_indexed(
            &connection,
            &list_opts("all", None, Some("recent")),
            "",
            &[],
        )
        .expect("sort recent");
        assert_eq!(items[0].name, "used.png", "用过的最前");
        assert_eq!(items.len(), 2, "未用过的也包含（全库）");
    }

    #[test]
    fn insert_managed_group_by_name_creates_then_reuses() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");

        let first = EmojiRepository::insert_managed(
            &mut connection,
            &managed_emoji("/a.png", "sha-a", ImportGroup::ByName("猫猫".to_string())),
        )
        .expect("first insert");
        assert!(first.group_created, "首次 ByName 应真正建组");

        let second = EmojiRepository::insert_managed(
            &mut connection,
            &managed_emoji("/b.png", "sha-b", ImportGroup::ByName(" 猫猫 ".to_string())),
        )
        .expect("second insert");
        assert!(!second.group_created, "复用既有组，不算 groups_created");
        assert_eq!(second.group_id, first.group_id);

        let group_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM groups", [], |row| row.get(0))
            .expect("count groups");
        assert_eq!(group_count, 1);
    }

    #[test]
    fn insert_managed_group_rolls_back_on_emoji_failure() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        connection
            .execute_batch(
                "CREATE TRIGGER reject_emoji_insert
                 BEFORE INSERT ON emojis
                 BEGIN SELECT RAISE(ABORT, 'forced emoji failure'); END;",
            )
            .expect("create trigger");

        let error = EmojiRepository::insert_managed(
            &mut connection,
            &managed_emoji("/a.png", "sha-a", ImportGroup::ByName("猫猫".to_string())),
        )
        .expect_err("should fail");
        assert!(error.contains("forced emoji failure"));
        let group_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM groups", [], |row| row.get(0))
            .expect("count groups");
        assert_eq!(
            group_count, 0,
            "emoji 插入失败 → 分组必须随事务回滚，不产生空组"
        );
    }

    fn insert_managed(
        connection: &mut Connection,
        path: &str,
        sha256: &str,
        perceptual: Option<i64>,
        is_deleted: bool,
    ) -> i64 {
        connection
            .execute(
                "INSERT INTO emojis (
                    source_type, source_path, managed_path, original_filename, file_extension,
                    file_size, sha256, width, height, thumbnail_path, imported_at, indexed_at,
                    usage_count, is_favorite, is_deleted, perceptual_hash
                 ) VALUES (
                    'managed_import', ?1, ?1, 'name.png', 'png',
                    1, ?2, 1, 1, NULL, 0, 0,
                    0, 0, ?3, ?4
                 )",
                rusqlite::params![path, sha256, is_deleted as i64, perceptual],
            )
            .expect("insert managed row");
        connection.last_insert_rowid()
    }

    #[test]
    fn touch_updated_at_refreshes_selected_rows_only() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        let id1 = insert_managed(&mut connection, "/a.png", "sha-a", None, false);
        let id2 = insert_managed(&mut connection, "/b.png", "sha-b", None, false);

        EmojiRepository::touch_updated_at(&connection, &[id1]).expect("touch");

        let (u1, u2): (Option<i64>, Option<i64>) = connection
            .query_row(
                "SELECT (SELECT updated_at FROM emojis WHERE id = ?1),
                        (SELECT updated_at FROM emojis WHERE id = ?2)",
                rusqlite::params![id1, id2],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read updated_at");
        assert!(u1.unwrap_or(0) > 0, "被 touch 的行应刷新 updated_at");
        assert_eq!(u2, None, "未被 touch 的行保持 NULL");
    }

    #[test]
    fn find_duplicate_content_exact_sha_hit() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_managed(&mut connection, "/a.png", "abc", Some(to_db(0x1234)), false);

        let hit = EmojiRepository::find_duplicate_content(&connection, "abc", None, 4, false)
            .expect("query")
            .expect("should hit");
        assert_eq!(hit.kind, DedupHitKind::ExactSha);
        assert_eq!(hit.existing.id, 1);
    }

    #[test]
    fn find_duplicate_content_perceptual_hit_stable_ordering() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        let query_hash = 0u64;
        // 距离 3（远）、距离 2、距离 2（后插，id 更大）。应选距离 2 中 id 更小的。
        let far = insert_managed(
            &mut connection,
            "/far.png",
            "s1",
            Some(to_db(0b111u64)),
            false,
        );
        let near_a = insert_managed(
            &mut connection,
            "/near-a.png",
            "s2",
            Some(to_db(0b11u64)),
            false,
        );
        let near_b = insert_managed(
            &mut connection,
            "/near-b.png",
            "s3",
            Some(to_db(0b11u64)),
            false,
        );
        assert!(far < near_a && near_a < near_b);

        let hit = EmojiRepository::find_duplicate_content(
            &connection,
            "not-sha",
            Some(to_db(query_hash)),
            4,
            false,
        )
        .expect("query")
        .expect("should hit");
        assert_eq!(hit.existing.id, near_a, "距离相同取 id 较小者");
        assert_eq!(hit.kind, DedupHitKind::Perceptual { hamming: 2 });
    }

    #[test]
    fn find_duplicate_content_perceptual_skipped_when_flag() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_managed(&mut connection, "/a.png", "s1", Some(to_db(0b11u64)), false);

        let hit =
            EmojiRepository::find_duplicate_content(&connection, "other", Some(to_db(0)), 4, true)
                .expect("query");
        assert!(hit.is_none(), "skip_perceptual_dedup=true 时不做感知扫描");
    }

    #[test]
    fn find_duplicate_content_no_hit() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        // 距离 10 > 阈值 4。
        insert_managed(
            &mut connection,
            "/far.png",
            "s1",
            Some(to_db(0x3ffu64)),
            false,
        );

        let hit =
            EmojiRepository::find_duplicate_content(&connection, "other", Some(to_db(0)), 4, false)
                .expect("query");
        assert!(hit.is_none());
    }

    #[test]
    fn find_duplicate_content_skips_deleted_and_null() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        // 已删除行不进候选。
        insert_managed(
            &mut connection,
            "/deleted.png",
            "s1",
            Some(to_db(0b11u64)),
            true,
        );
        // NULL 感知哈希行不是候选。
        insert_managed(&mut connection, "/null.png", "s2", None, false);

        let hit =
            EmojiRepository::find_duplicate_content(&connection, "other", Some(to_db(0)), 4, false)
                .expect("query");
        assert!(hit.is_none());
    }

    #[test]
    fn backfill_updates_null_only_and_never_overwrites() {
        let mut connection = Connection::open_in_memory().expect("open sqlite");
        run_migrations(&mut connection).expect("run migrations");
        insert_managed(&mut connection, "/null-1.png", "s1", None, false);
        insert_managed(&mut connection, "/null-2.png", "s2", None, false);
        let filled = insert_managed(
            &mut connection,
            "/filled.png",
            "s3",
            Some(to_db(0xabcd)),
            false,
        );

        let nulls = EmojiRepository::list_null_perceptual(&connection, 10).expect("list nulls");
        assert_eq!(nulls.len(), 2, "只有 NULL 行待回填");

        for (id, _path) in &nulls {
            EmojiRepository::update_perceptual_hash(&mut connection, *id, to_db(0x1234))
                .expect("backfill");
        }
        let remaining = EmojiRepository::list_null_perceptual(&connection, 10).expect("list again");
        assert!(remaining.is_empty(), "回填后不应再有 NULL");

        // 已有值的行不会被覆盖（IS NULL 守卫）。
        EmojiRepository::update_perceptual_hash(&mut connection, filled, to_db(0x9999))
            .expect("attempt overwrite");
        let stored: i64 = connection
            .query_row(
                "SELECT perceptual_hash FROM emojis WHERE id = ?1",
                [filled],
                |row| row.get(0),
            )
            .expect("read hash");
        assert_eq!(from_db(stored), 0xabcd, "不得覆盖已有感知哈希");
    }
}
