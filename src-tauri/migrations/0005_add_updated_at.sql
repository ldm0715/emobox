-- 表情记录的"最后修改时间"（updated_at）：元数据被用户改动时刷新
-- （增删改标签 / 分组、收藏、移入或收回回收站）。存量行初始化为导入时间。
ALTER TABLE emojis ADD COLUMN updated_at INTEGER;
UPDATE emojis SET updated_at = COALESCE(imported_at, indexed_at);
