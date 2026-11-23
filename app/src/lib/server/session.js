import { randomBytes } from 'node:crypto';
import { pool } from './db.js';

export const SESSION_COOKIE = 'session_id';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Create a server-side session row for a logged-in SSO user and return the
 * opaque session id to store in a cookie. The session table (not a signed
 * cookie payload) is the source of truth so a session can be revoked.
 * @param {{ sub: string, name?: string|null, email?: string|null, role: string,
 *   mfaStatus?: 'verified'|'pending_verify'|'pending_enroll' }} user
 * @returns {Promise<{ id: string, expiresAt: Date }>}
 */
export async function createSession(user) {
	const id = randomBytes(24).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	await pool.query(
		`INSERT INTO sessions (id, sub, name, email, role, mfa_status, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[id, user.sub, user.name ?? null, user.email ?? null, user.role, user.mfaStatus ?? 'verified', expiresAt]
	);
	return { id, expiresAt };
}

/**
 * Look up a session by id, returning null if missing or expired.
 * @param {string} sessionId
 */
export async function getSession(sessionId) {
	if (!sessionId) return null;
	const { rows } = await pool.query(
		`SELECT id, sub, name, email, role, mfa_status, webauthn_challenge, expires_at
		 FROM sessions WHERE id = $1 AND expires_at > now()`,
		[sessionId]
	);
	return rows[0] ?? null;
}

/**
 * Store the in-flight WebAuthn challenge for a session (consumed on verify).
 * @param {string} sessionId @param {string|null} challenge
 */
export async function setSessionChallenge(sessionId, challenge) {
	await pool.query(`UPDATE sessions SET webauthn_challenge = $2 WHERE id = $1`, [
		sessionId,
		challenge
	]);
}

/**
 * Mark a session as having cleared MFA, and clear its challenge.
 * @param {string} sessionId
 */
export async function markSessionMfaVerified(sessionId) {
	await pool.query(
		`UPDATE sessions SET mfa_status = 'verified', webauthn_challenge = NULL WHERE id = $1`,
		[sessionId]
	);
}

/** @param {string} sessionId */
export async function deleteSession(sessionId) {
	if (!sessionId) return;
	await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}
