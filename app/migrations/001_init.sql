CREATE TABLE IF NOT EXISTS reports (
	id BIGSERIAL PRIMARY KEY,
	source_tool TEXT NOT NULL CHECK (source_tool IN ('nessus', 'zap')),
	original_filename TEXT NOT NULL,
	imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS findings (
	id BIGSERIAL PRIMARY KEY,
	report_id BIGINT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
	source_tool TEXT NOT NULL CHECK (source_tool IN ('nessus', 'zap')),
	target TEXT,
	identifier TEXT NOT NULL,
	title TEXT NOT NULL,
	severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
	description TEXT,
	solution TEXT,
	cvss_score NUMERIC,
	cve TEXT,
	affected_url_or_port TEXT,
	confidence TEXT,
	raw_evidence TEXT,
	imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS findings_report_id_idx ON findings (report_id);
CREATE INDEX IF NOT EXISTS findings_severity_idx ON findings (severity);
CREATE INDEX IF NOT EXISTS findings_source_tool_idx ON findings (source_tool);
