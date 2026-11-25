-- Per-minute disk / RAM / CPU samples for each scanner VM and the prod host,
-- collected by lib/server/monitor.js for the /monitor page. Kept 30 days.
CREATE TABLE IF NOT EXISTS vm_metrics (
	vm TEXT NOT NULL,
	ts TIMESTAMPTZ NOT NULL DEFAULT now(),
	ok BOOLEAN NOT NULL DEFAULT true,
	cpu_pct REAL,
	mem_pct REAL,
	mem_used_mb INTEGER,
	mem_total_mb INTEGER,
	disk_pct REAL,
	disk_used_gb REAL,
	disk_total_gb REAL,
	error TEXT,
	PRIMARY KEY (vm, ts)
);

CREATE INDEX IF NOT EXISTS vm_metrics_ts_idx ON vm_metrics (ts);
