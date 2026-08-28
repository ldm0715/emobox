-- 第七阶段优化：移除外部目录索引，新增感知哈希去重列。
--
-- 1. 删除所有 external_directory 行（用户已确认）。这些行只引用原路径、
--    文件本体不动；DELETE 触发 CASCADE 清空其 group/tag 关联。
--    注意：import_legacy_recent 已同步改写为不再创建 external 行，
--    防止 setup 阶段重建（见 EmojiRepository::import_legacy_recent）。
--
-- 2. 新增 perceptual_hash 列：存 dHash（u64，经 from_ne_bytes / to_ne_bytes
--    位转换后以 i64 存储）。旧受管行此列为 NULL，由导入时的惰性回填补齐
--    （见 ImportService::backfill_perceptual_hashes）。
--
-- 不建 perceptual_hash 的普通 B-tree 索引：去重是"加载候选后 Rust 全表
-- Hamming 距离扫描"，普通索引对 Hamming 距离无加速（见 find_duplicate_content）。

DELETE FROM emojis WHERE source_type = 'external_directory';
ALTER TABLE emojis ADD COLUMN perceptual_hash INTEGER;
