ALTER TABLE reports ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE INDEX IF NOT EXISTS reports_content_hash_idx ON reports (content_hash);
