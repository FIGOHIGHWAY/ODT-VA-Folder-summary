CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	sub TEXT NOT NULL,
	name TEXT,
	email TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
