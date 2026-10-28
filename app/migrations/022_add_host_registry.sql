-- A manually-maintained registry that identifies which actual server/website
-- an IP (or hostname) is, so findings can be annotated with a human label.
-- One hostname may serve several physical hosts behind a shared name; each
-- host gets its own row (keyed by ip) with a friendly label telling them apart.
CREATE TABLE IF NOT EXISTS host_registry (
	id SERIAL PRIMARY KEY,
	ip TEXT NOT NULL UNIQUE,
	hostname TEXT,
	label TEXT NOT NULL,
	note TEXT,
	created_by TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_registry_hostname_idx ON host_registry (lower(hostname));
