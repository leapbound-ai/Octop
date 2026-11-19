CREATE TABLE IF NOT EXISTS sourcing_rfqs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    plan_price TEXT,
    monthly_qty INTEGER,
    categories TEXT NOT NULL,
    questions TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE (user_id, rfq_id)
);
CREATE INDEX IF NOT EXISTS idx_sourcing_rfqs_owner ON sourcing_rfqs(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sourcing_suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    shop_url TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    UNIQUE (user_id, name_key),
    UNIQUE (user_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS sourcing_rfq_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reply_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    rfq_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    terms TEXT,
    parsed_at BIGINT,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (user_id, rfq_id) REFERENCES sourcing_rfqs(user_id, rfq_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, supplier_id) REFERENCES sourcing_suppliers(user_id, supplier_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sourcing_replies_rfq ON sourcing_rfq_replies(user_id, rfq_id, supplier_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_replies_supplier ON sourcing_rfq_replies(user_id, supplier_id, id DESC);

UPDATE _schema_version SET version = 31;
