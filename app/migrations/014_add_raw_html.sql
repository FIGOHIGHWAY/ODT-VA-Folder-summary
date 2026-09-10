-- Stores the original uploaded HTML export (gzip-compressed) so it can be
-- downloaded back later, not just the parsed findings. Only populated for
-- uploads from this point forward — the original files behind older
-- reports were never kept, so this column stays NULL for those.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS raw_html BYTEA;
