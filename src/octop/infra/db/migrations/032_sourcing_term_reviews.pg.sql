ALTER TABLE sourcing_rfq_replies ADD COLUMN IF NOT EXISTS manual_terms TEXT NOT NULL DEFAULT '{}';

UPDATE _schema_version SET version = 32;
