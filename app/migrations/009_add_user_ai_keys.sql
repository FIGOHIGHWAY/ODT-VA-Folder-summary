CREATE TABLE IF NOT EXISTS user_ai_keys (
	email TEXT PRIMARY KEY,
	api_key TEXT NOT NULL,
	base_url TEXT,
	model TEXT,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
