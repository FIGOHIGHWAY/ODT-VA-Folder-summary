-- Multi-factor authentication: WebAuthn passkeys (primary second factor) plus
-- one-time recovery codes (backup when a passkey is lost). SSO stays the first
-- factor; a session is only fully authenticated once it also clears MFA.
--
-- Credentials and recovery codes are keyed by the SSO subject (`sub`), the
-- stable per-user id, so they survive across sessions and re-logins.

CREATE TABLE IF NOT EXISTS webauthn_credentials (
	id TEXT PRIMARY KEY,                       -- credential id (base64url)
	sub TEXT NOT NULL,                         -- SSO subject that owns it
	device_name TEXT,                          -- user-chosen label
	public_key TEXT NOT NULL,                  -- COSE public key (base64url)
	counter BIGINT NOT NULL DEFAULT 0,         -- signature counter (clone detection)
	transports TEXT,                           -- JSON array of transports, if any
	backed_up BOOLEAN NOT NULL DEFAULT false,  -- multi-device (synced) passkey?
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webauthn_credentials_sub_idx ON webauthn_credentials (sub);

CREATE TABLE IF NOT EXISTS recovery_codes (
	sub TEXT NOT NULL,
	code_hash TEXT NOT NULL,                    -- sha256 of the normalized code
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	used_at TIMESTAMPTZ,
	PRIMARY KEY (sub, code_hash)
);
CREATE INDEX IF NOT EXISTS recovery_codes_sub_idx ON recovery_codes (sub);

-- Each session tracks how far it has cleared MFA:
--   verified        - SSO + MFA done, full access
--   pending_verify  - SSO done, user has a passkey, must assert it
--   pending_enroll  - SSO done, user has no passkey yet, must enroll one
-- Existing sessions default to 'verified' so deploying this doesn't log
-- everyone out mid-session; the callback sets the real status on each new login.
ALTER TABLE sessions
	ADD COLUMN IF NOT EXISTS mfa_status TEXT NOT NULL DEFAULT 'verified'
	CHECK (mfa_status IN ('verified', 'pending_verify', 'pending_enroll'));

-- The in-flight WebAuthn challenge for this session (registration or
-- authentication), consumed on verify. Stored server-side, tied to the
-- session, so a challenge can't be replayed from another context.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS webauthn_challenge TEXT;
