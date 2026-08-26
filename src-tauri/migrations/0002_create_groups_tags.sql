-- 第六阶段：分组与标签基础表
-- 注意：关联表使用 ON DELETE CASCADE，但 CASCADE 只在物理 DELETE 行时触发；
-- 软删 emoji（UPDATE is_deleted=1）不会清空关联，关联在恢复后仍可用。

CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_groups_name ON groups(name COLLATE NOCASE);
CREATE INDEX idx_groups_sort_order ON groups(sort_order, id);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_tags_name ON tags(name COLLATE NOCASE);

CREATE TABLE emoji_groups (
  emoji_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (emoji_id, group_id),
  FOREIGN KEY (emoji_id) REFERENCES emojis(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);
CREATE INDEX idx_emoji_groups_group_id ON emoji_groups(group_id);

CREATE TABLE emoji_tags (
  emoji_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (emoji_id, tag_id),
  FOREIGN KEY (emoji_id) REFERENCES emojis(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX idx_emoji_tags_tag_id ON emoji_tags(tag_id);
