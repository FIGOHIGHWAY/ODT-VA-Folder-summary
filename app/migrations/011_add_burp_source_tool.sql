ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_source_tool_check;
ALTER TABLE reports ADD CONSTRAINT reports_source_tool_check
	CHECK (source_tool IN ('nessus', 'zap', 'burp'));

ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_source_tool_check;
ALTER TABLE findings ADD CONSTRAINT findings_source_tool_check
	CHECK (source_tool IN ('nessus', 'zap', 'burp'));
