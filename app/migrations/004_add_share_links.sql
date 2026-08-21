CREATE TABLE IF NOT EXISTS share_links (
	id BIGSERIAL PRIMARY KEY,
	token TEXT NOT NULL UNIQUE,
	domain TEXT NOT NULL,
	created_by TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS share_links_domain_idx ON share_links (domain);
CREATE INDEX IF NOT EXISTS share_links_token_idx ON share_links (token);
