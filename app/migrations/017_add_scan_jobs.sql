CREATE TABLE IF NOT EXISTS scan_jobs (
	id SERIAL PRIMARY KEY,
	tool TEXT NOT NULL CHECK (tool IN ('nessus', 'openvas', 'nuclei')),
	target TEXT NOT NULL,
	external_id TEXT NOT NULL,
	extra TEXT,
	status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'error')),
	report_id INTEGER REFERENCES reports (id) ON DELETE SET NULL,
	error_message TEXT,
	created_by TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scan_jobs_created_at_idx ON scan_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS scan_jobs_tool_external_id_idx ON scan_jobs (tool, external_id);
