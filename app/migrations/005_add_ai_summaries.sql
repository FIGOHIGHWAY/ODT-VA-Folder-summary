CREATE TABLE IF NOT EXISTS ai_summaries (
	domain TEXT PRIMARY KEY,
	summary TEXT NOT NULL,
	model TEXT NOT NULL,
	finding_count INT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
