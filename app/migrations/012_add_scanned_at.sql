-- Distinguishes "when the scan actually happened" from "when we imported the
-- file" (imported_at). Batch/catch-up uploads can happen months after the
-- actual scan, which broke "latest round" grouping when it only had
-- imported_at to go on. NULL means we couldn't recover a date from the
-- filename — callers should fall back to imported_at.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS reports_scanned_at_idx ON reports (scanned_at);
