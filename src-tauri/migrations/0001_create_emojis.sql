CREATE TABLE emojis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('external_directory', 'managed_import', 'clipboard')
  ),
  source_path TEXT NOT NULL,
  managed_path TEXT,
  original_filename TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  sha256 TEXT,
  width INTEGER NOT NULL CHECK (width >= 0),
  height INTEGER NOT NULL CHECK (height >= 0),
  thumbnail_path TEXT,
  imported_at INTEGER,
  indexed_at INTEGER NOT NULL,
  last_used_at INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  CHECK (
    source_type = 'external_directory'
    OR (managed_path IS NOT NULL AND sha256 IS NOT NULL)
  )
);

CREATE INDEX idx_emojis_source_type ON emojis(source_type);
CREATE UNIQUE INDEX idx_emojis_source_path ON emojis(source_path);
CREATE UNIQUE INDEX idx_emojis_managed_path
  ON emojis(managed_path)
  WHERE managed_path IS NOT NULL;
CREATE UNIQUE INDEX idx_emojis_managed_sha256
  ON emojis(sha256)
  WHERE sha256 IS NOT NULL
    AND source_type IN ('managed_import', 'clipboard');
CREATE INDEX idx_emojis_imported_at ON emojis(imported_at);
CREATE INDEX idx_emojis_last_used_at ON emojis(last_used_at);
CREATE INDEX idx_emojis_is_favorite ON emojis(is_favorite);