CREATE TABLE IF NOT EXISTS profit_calc_baselines (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, version)
);

CREATE TABLE IF NOT EXISTS profit_calc_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  inputs TEXT NOT NULL,
  results TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  baseline_version INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profit_calc_snapshots_owner
    ON profit_calc_snapshots(user_id, snapshot_id DESC);

UPDATE _schema_version SET version = 30;
