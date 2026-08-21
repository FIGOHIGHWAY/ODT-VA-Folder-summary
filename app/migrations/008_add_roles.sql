ALTER TABLE allowed_users
	ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
	CHECK (role IN ('admin', 'soc', 'user'));

ALTER TABLE sessions
	ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
	CHECK (role IN ('admin', 'soc', 'user'));
