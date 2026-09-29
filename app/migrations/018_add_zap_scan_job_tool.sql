ALTER TABLE scan_jobs DROP CONSTRAINT IF EXISTS scan_jobs_tool_check;
ALTER TABLE scan_jobs ADD CONSTRAINT scan_jobs_tool_check
	CHECK (tool IN ('nessus', 'openvas', 'nuclei', 'zap'));
