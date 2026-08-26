-- 第六阶段：回收站字段
-- external_directory 的 trash_path 始终为 NULL（不修改原文件）；
-- managed_import / clipboard 软删时把原文件物理移动到 trash_path。

ALTER TABLE emojis ADD COLUMN deleted_at INTEGER;
ALTER TABLE emojis ADD COLUMN trash_path TEXT;
ALTER TABLE emojis ADD COLUMN trash_thumbnail_path TEXT;
CREATE INDEX idx_emojis_is_deleted_deleted_at ON emojis(is_deleted, deleted_at);
