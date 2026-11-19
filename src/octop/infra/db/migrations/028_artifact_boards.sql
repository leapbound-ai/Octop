CREATE TABLE IF NOT EXISTS artifact_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifact_boards_user ON artifact_boards(user_id);
CREATE TABLE IF NOT EXISTS artifact_board_items (
  board_id TEXT NOT NULL REFERENCES artifact_boards(board_id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (board_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_artifact_board_items_artifact ON artifact_board_items(artifact_id);
CREATE TABLE IF NOT EXISTS artifact_references (
  source_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, target_id),
  CHECK (source_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_artifact_references_target ON artifact_references(target_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_parent ON artifacts(parent_id);
UPDATE _schema_version SET version = 28;
