CREATE TABLE IF NOT EXISTS allowed_users (
	email TEXT PRIMARY KEY,
	note TEXT,
	added_by TEXT,
	added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
