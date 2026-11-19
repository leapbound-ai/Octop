ALTER TABLE threads ADD COLUMN IF NOT EXISTS artifact_parent_id TEXT NOT NULL DEFAULT '';
ALTER TABLE threads ADD COLUMN IF NOT EXISTS artifact_parent_version INTEGER;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS parent_version INTEGER;

CREATE TABLE IF NOT EXISTS artifact_versions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('text', 'json')),
  content TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (artifact_id, revision)
);

INSERT INTO artifact_versions (artifact_id, revision, content_type, content, created_at)
SELECT artifact_id, 1, 'json', payload, updated_at FROM artifacts WHERE payload <> '{}' ON CONFLICT DO NOTHING;

UPDATE _schema_version SET version = 27;
