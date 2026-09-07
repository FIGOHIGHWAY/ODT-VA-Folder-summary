-- NULL means "all rounds" (the pre-existing behavior) — a share link can
-- now also be scoped to one specific scan round (COALESCE(scanned_at,
-- imported_at)::date) so a domain can have several links, each covering a
-- different date, active at once.
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS round_date DATE;
