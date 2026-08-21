ALTER TABLE reports ADD COLUMN IF NOT EXISTS domain TEXT;

CREATE INDEX IF NOT EXISTS reports_domain_idx ON reports (domain);
