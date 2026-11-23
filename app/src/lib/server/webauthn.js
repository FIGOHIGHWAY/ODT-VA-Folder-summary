import { createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { pool } from './db.js';

// WebAuthn is bound to an origin. Behind the edge proxy the browser's origin is
// https://<public hostname>, and the RP ID must be that hostname (registrable
// domain). Both are configurable; defaults match the prod hostname. Passkeys
// registered under one RP ID only work on that hostname — if the site is also
// served as odt-stvascan.kku.ac.th, pick one canonical host and redirect the
// other to it.
const DEFAULT_RP_ID = 'odtstvascan.kku.ac.th';

export function rpConfig() {
	const rpID = env.WEBAUTHN_RP_ID || DEFAULT_RP_ID;
	const rpName = env.WEBAUTHN_RP_NAME || 'ODT KKU — VA Scan';
	// Default the origin from the RP ID; override when the port/scheme differ
	// (e.g. WEBAUTHN_ORIGIN=http://localhost:5173 in local dev).
	const origin = env.WEBAUTHN_ORIGIN || `https://${rpID}`;
	return { rpID, rpName, origin };
}

// ---- credential storage (keyed by SSO subject) ----

/** @param {string} sub */
export async function listCredentials(sub) {
	const { rows } = await pool.query(
		`SELECT id, device_name, counter, transports, backed_up, created_at, last_used_at
		 FROM webauthn_credentials WHERE sub = $1 ORDER BY created_at`,
		[sub]
	);
	return rows;
}

/** @param {string} sub */
export async function countCredentials(sub) {
	const { rows } = await pool.query(
		`SELECT COUNT(*)::int AS n FROM webauthn_credentials WHERE sub = $1`,
		[sub]
	);
	return rows[0].n;
}

/**
 * The shape generate/verify options need to exclude or allow a user's existing
 * credentials.
 * @param {string} sub
 */
async function credentialDescriptors(sub) {
	const { rows } = await pool.query(
		`SELECT id, transports FROM webauthn_credentials WHERE sub = $1`,
		[sub]
	);
	return rows.map((r) => ({
		id: r.id,
		transports: r.transports ? JSON.parse(r.transports) : undefined
	}));
}

async function saveCredential(sub, deviceName, cred, backedUp) {
	await pool.query(
		`INSERT INTO webauthn_credentials (id, sub, device_name, public_key, counter, transports, backed_up)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (id) DO NOTHING`,
		[
			cred.id,
			sub,
			deviceName || null,
			isoBase64URL.fromBuffer(cred.publicKey),
			cred.counter ?? 0,
			cred.transports ? JSON.stringify(cred.transports) : null,
			!!backedUp
		]
	);
}

/** @param {string} sub @param {string} credentialId */
export async function deleteCredential(sub, credentialId) {
	const { rowCount } = await pool.query(
		`DELETE FROM webauthn_credentials WHERE sub = $1 AND id = $2`,
		[sub, credentialId]
	);
	return rowCount > 0;
}

/** @param {string} sub @param {string} credentialId @param {string} name */
export async function renameCredential(sub, credentialId, name) {
	const { rowCount } = await pool.query(
		`UPDATE webauthn_credentials SET device_name = $3 WHERE sub = $1 AND id = $2`,
		[sub, credentialId, name.slice(0, 100)]
	);
	return rowCount > 0;
}

// ---- registration (enrolling a new passkey) ----

/**
 * @param {{ sub: string, email?: string|null, name?: string|null }} user
 * @returns {Promise<import('@simplewebauthn/server').PublicKeyCredentialCreationOptionsJSON>}
 */
export async function buildRegistrationOptions(user) {
	const { rpID, rpName } = rpConfig();
	const options = await generateRegistrationOptions({
		rpName,
		rpID,
		userName: user.email || user.sub,
		userDisplayName: user.name || user.email || user.sub,
		userID: new TextEncoder().encode(user.sub),
		attestationType: 'none',
		excludeCredentials: await credentialDescriptors(user.sub),
		// A platform/roaming passkey that stays resident on the authenticator and
		// requires user verification (biometric/PIN) — a true second factor.
		authenticatorSelection: {
			residentKey: 'preferred',
			userVerification: 'preferred'
		}
	});
	return options;
}

/**
 * Verify the browser's registration response against the challenge stored on
 * the session and, on success, persist the new credential.
 * @returns {Promise<{ verified: boolean }>}
 */
export async function verifyRegistration({ sub, deviceName, response, expectedChallenge }) {
	const { rpID, origin } = rpConfig();
	const verification = await verifyRegistrationResponse({
		response,
		expectedChallenge,
		expectedOrigin: origin,
		expectedRPID: rpID,
		requireUserVerification: false
	});
	if (!verification.verified || !verification.registrationInfo) {
		return { verified: false };
	}
	const { credential, credentialBackedUp } = verification.registrationInfo;
	await saveCredential(sub, deviceName, credential, credentialBackedUp);
	return { verified: true };
}

// ---- authentication (asserting an existing passkey) ----

/** @param {string} sub */
export async function buildAuthenticationOptions(sub) {
	const { rpID } = rpConfig();
	return generateAuthenticationOptions({
		rpID,
		allowCredentials: await credentialDescriptors(sub),
		userVerification: 'preferred'
	});
}

/**
 * Verify an authentication response: find the asserted credential, check the
 * signature against its stored public key, and bump the signature counter.
 * @returns {Promise<{ verified: boolean }>}
 */
export async function verifyAuthentication({ sub, response, expectedChallenge }) {
	const { rpID, origin } = rpConfig();
	const credId = response.id;
	const { rows } = await pool.query(
		`SELECT id, public_key, counter, transports FROM webauthn_credentials WHERE sub = $1 AND id = $2`,
		[sub, credId]
	);
	const stored = rows[0];
	if (!stored) return { verified: false };

	const verification = await verifyAuthenticationResponse({
		response,
		expectedChallenge,
		expectedOrigin: origin,
		expectedRPID: rpID,
		requireUserVerification: false,
		credential: {
			id: stored.id,
			publicKey: isoBase64URL.toBuffer(stored.public_key),
			counter: Number(stored.counter),
			transports: stored.transports ? JSON.parse(stored.transports) : undefined
		}
	});
	if (!verification.verified) return { verified: false };

	await pool.query(
		`UPDATE webauthn_credentials SET counter = $3, last_used_at = now() WHERE sub = $1 AND id = $2`,
		[sub, credId, verification.authenticationInfo.newCounter]
	);
	return { verified: true };
}

// ---- recovery codes (backup factor) ----

const RECOVERY_CODE_COUNT = 10;

/** Normalize a code for hashing/compare: drop spacing and case. */
function normalizeCode(code) {
	return String(code).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function hashCode(code) {
	return createHash('sha256').update(normalizeCode(code)).digest('hex');
}

/** A readable high-entropy code like "k7m2-9qx4-ab3n" (~60 bits). */
function makeCode() {
	const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes
	const bytes = randomBytes(12);
	let out = '';
	for (let i = 0; i < 12; i++) {
		if (i > 0 && i % 4 === 0) out += '-';
		out += alphabet[bytes[i] % alphabet.length];
	}
	return out;
}

/**
 * Generate a fresh set of recovery codes, replacing any existing ones for this
 * user. Returns the plaintext codes — shown to the user ONCE; only hashes are
 * stored.
 * @param {string} sub
 * @returns {Promise<string[]>}
 */
export async function regenerateRecoveryCodes(sub) {
	const codes = Array.from({ length: RECOVERY_CODE_COUNT }, makeCode);
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query(`DELETE FROM recovery_codes WHERE sub = $1`, [sub]);
		for (const code of codes) {
			await client.query(`INSERT INTO recovery_codes (sub, code_hash) VALUES ($1, $2)`, [
				sub,
				hashCode(code)
			]);
		}
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
	return codes;
}

/** How many unused recovery codes remain. @param {string} sub */
export async function countUnusedRecoveryCodes(sub) {
	const { rows } = await pool.query(
		`SELECT COUNT(*)::int AS n FROM recovery_codes WHERE sub = $1 AND used_at IS NULL`,
		[sub]
	);
	return rows[0].n;
}

/**
 * Consume one unused recovery code. Returns true if it matched and was spent.
 * @param {string} sub @param {string} code
 */
export async function consumeRecoveryCode(sub, code) {
	const { rowCount } = await pool.query(
		`UPDATE recovery_codes SET used_at = now()
		 WHERE sub = $1 AND code_hash = $2 AND used_at IS NULL`,
		[sub, hashCode(code)]
	);
	return rowCount > 0;
}

export const __test = { normalizeCode, hashCode, makeCode };
