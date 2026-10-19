-- Triage decisions (confirmed / false positive / accepted risk), keyed by
-- domain + normalized finding title rather than finding id, so a decision
-- made once carries over to every later scan round of the same domain.

-- Same normalization the dashboard's Top 10 groups by: case and punctuation
-- ignored, so "Cross-site scripting" and "Cross Site Scripting" are one key.
ALTER TABLE findings ADD COLUMN IF NOT EXISTS title_key TEXT
	GENERATED ALWAYS AS (TRIM(REGEXP_REPLACE(LOWER(title), '[[:space:][:punct:]]+', ' ', 'g'))) STORED;

CREATE INDEX IF NOT EXISTS findings_title_key_idx ON findings (title_key);

CREATE TABLE IF NOT EXISTS finding_triage (
	domain TEXT NOT NULL,
	title_key TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('confirmed', 'false_positive', 'accepted_risk')),
	reason TEXT,
	decided_by TEXT,
	decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (domain, title_key)
);

-- Live ZAP scans used to drop the alert's confidence; recover it from the
-- raw alert JSON kept in raw_evidence. Rows that aren't valid JSON are skipped.
DO $$
DECLARE r RECORD;
BEGIN
	FOR r IN SELECT id, raw_evidence FROM findings
	         WHERE source_tool = 'zap' AND confidence IS NULL AND raw_evidence LIKE '{%'
	LOOP
		BEGIN
			UPDATE findings SET confidence = r.raw_evidence::json->>'confidence' WHERE id = r.id;
		EXCEPTION WHEN others THEN NULL;
		END;
	END LOOP;
END $$;
