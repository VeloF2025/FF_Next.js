/**
 * OTP + PIN onboarding for the /my portal.
 *
 * The flow:
 *   1. Staff enters their phone → `POST /api/my/login/request-otp`. We look
 *      up the staff row, generate a 6-digit OTP, bcrypt it, write it into
 *      `attendance_credentials.pending_otp_hash` (creating the row if no
 *      credentials exist yet), and WhatsApp the plaintext OTP to the phone
 *      on file. The handler always returns 200 regardless of whether the
 *      phone mapped to a staff row — unknown numbers cannot be distinguished
 *      from known numbers via the API surface.
 *   2. Staff enters OTP + new PIN → `POST /api/my/login/verify-otp`. We
 *      bcrypt-compare the OTP, check expiry and attempts, set the PIN hash
 *      on success, and clear the pending columns. A session cookie is
 *      issued in the same response so the portal drops straight into the
 *      clock-in screen.
 *
 * Threat model:
 *   - OTP is a short-lived low-entropy secret (10^6). TTL is tight (10 min)
 *     and attempts are hard-capped (5) so brute-force from a compromised
 *     session cookie is economically infeasible.
 *   - Resend cooldown (60s) prevents WA spam against an arbitrary phone.
 *   - Unified 200 response on request-otp closes the enumeration oracle.
 *   - The WA send channel is trusted only as far as the phone on file is
 *     trusted. This is a PIN-reset channel, not an MFA factor.
 *   - There is NO fallback "send via SMS if WA fails" — a silent SMS from a
 *     different sender ID is exactly the phishing vector we want to avoid.
 */

import * as bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';

import { findAuthRowByPhone, normaliseSaPhone } from './credentialUtils';

// =============================================================================
// Tunables
// =============================================================================

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;          // 10 minutes
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;   // 60s between sends per phone
export const OTP_MAX_ATTEMPTS = 5;                 // before the OTP is burned

// Lower bcrypt cost than PIN/password (10 vs 12): OTPs live for 10 min, not
// years, and are compared on every verify request. Cost 10 is still > 50 ms.
const OTP_BCRYPT_ROUNDS = 10;

// The WA bridge on the VPS is the only service that actually exposes a
// working /send-message endpoint. The wa-feedback-service on Velocity:8092
// only proxies a narrow subset (health, digest posts) — not DMs. Env-var
// overrides are preserved for test / future reroute.
//
// Renamed from WA_SENDER_URL: the local const name now matches the
// endpoint it actually hits (the bridge, not a "sender" proxy).
const WA_BRIDGE_URL =
  process.env.WA_BRIDGE_URL ||
  process.env.WA_FEEDBACK_URL ||
  'http://72.61.197.178:8083';

// Allowlist of hosts the OTP sender is permitted to call. A misconfigured
// env var could otherwise exfiltrate the OTP + phone to an arbitrary host
// — this is a defence-in-depth guard, not the primary control.
// Accepts host[:port] form; the resolved URL is rejected if its authority
// isn't in this set.
const WA_BRIDGE_ALLOWLIST = new Set([
  '72.61.197.178:8083',  // VPS wa-bridge (prod primary)
  '100.96.203.105:8092', // Velocity wa-feedback (legacy, retained for fallback)
  '100.96.203.105:8081', // Velocity wa-sender (legacy alias)
  'localhost:8083',
  'localhost:8092',
  'localhost:8081',
  '127.0.0.1:8083',
  '127.0.0.1:8092',
  '127.0.0.1:8081',
]);

function assertAllowlistedBridgeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`WA bridge URL is not a valid URL: ${url}`);
  }
  if (!WA_BRIDGE_ALLOWLIST.has(parsed.host)) {
    throw new Error(
      `WA bridge host ${parsed.host} is not in the allowlist — refusing to send OTP`
    );
  }
}

// =============================================================================
// OTP lifecycle
// =============================================================================

/**
 * Generate a 6-digit OTP using a CSPRNG. `crypto.randomInt` is uniformly
 * distributed across `[min, max)` — no modulo bias. Always 6 characters so
 * leading zeros are preserved (001234, not "1234").
 */
export function generateOtp(): string {
  const n = crypto.randomInt(0, 10 ** OTP_LENGTH);
  return n.toString().padStart(OTP_LENGTH, '0');
}

export async function hashOtp(otp: string): Promise<string> {
  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(otp)) {
    throw new Error(`OTP must be exactly ${OTP_LENGTH} digits`);
  }
  return bcrypt.hash(otp, OTP_BCRYPT_ROUNDS);
}

export async function verifyOtp(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch (err) {
    log.error('[attendance-otp] bcrypt.compare failed — corrupt OTP hash?', {
      hashPrefix: typeof hash === 'string' ? hash.slice(0, 7) : '(non-string)',
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// =============================================================================
// Pending-OTP row mutation
// =============================================================================

/**
 * Upsert the pending OTP into attendance_credentials. If the row doesn't
 * exist yet (first-time onboarding), we INSERT with only the pending fields
 * set — the CHECK constraint allows this since migration 318.
 *
 * Returns `false` when a valid OTP was issued within the cooldown window, to
 * let the caller swallow the resend silently (the user will still be told
 * "an OTP has been sent" to avoid leaking state).
 */
export async function upsertPendingOtp(params: {
  staffId: string;
  otpHash: string;
  now?: Date;
}): Promise<{ sent: boolean; cooldownMs: number }> {
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  const existing = await sql<{
    pending_otp_requested_at: string | null;
    pending_otp_expires_at: string | null;
  }>`
    SELECT pending_otp_requested_at, pending_otp_expires_at
    FROM attendance_credentials
    WHERE staff_id = ${params.staffId}
    LIMIT 1
  `;
  const prior = existing[0];

  // Resend cooldown: if the last request was less than the cooldown ago AND
  // the OTP hasn't expired, reject the resend silently.
  if (prior?.pending_otp_requested_at && prior?.pending_otp_expires_at) {
    const lastMs = new Date(prior.pending_otp_requested_at).getTime();
    const expiryMs = new Date(prior.pending_otp_expires_at).getTime();
    if (!Number.isNaN(lastMs) && !Number.isNaN(expiryMs)) {
      const sinceLast = now.getTime() - lastMs;
      const stillValid = expiryMs > now.getTime();
      if (stillValid && sinceLast < OTP_RESEND_COOLDOWN_MS) {
        return { sent: false, cooldownMs: OTP_RESEND_COOLDOWN_MS - sinceLast };
      }
    }
  }

  await sql`
    INSERT INTO attendance_credentials (
      staff_id,
      pending_otp_hash,
      pending_otp_expires_at,
      pending_otp_requested_at,
      pending_otp_attempts
    ) VALUES (
      ${params.staffId},
      ${params.otpHash},
      ${expiresAt.toISOString()},
      ${now.toISOString()},
      0
    )
    ON CONFLICT (staff_id) DO UPDATE SET
      pending_otp_hash         = EXCLUDED.pending_otp_hash,
      pending_otp_expires_at   = EXCLUDED.pending_otp_expires_at,
      pending_otp_requested_at = EXCLUDED.pending_otp_requested_at,
      pending_otp_attempts     = 0,
      updated_at               = NOW()
  `;

  return { sent: true, cooldownMs: 0 };
}

export interface PendingOtpRow extends Record<string, unknown> {
  staff_id: string;
  staff_name: string;
  pending_otp_hash: string | null;
  pending_otp_expires_at: string | null;
  pending_otp_attempts: number;
  phone_verified_at: string | null;
  pin_hash: string | null;
  // Shared cross-credential lockout — bad OTPs must count against the same
  // 5-strikes counter that login.ts uses, otherwise brute-force attackers
  // could bypass it by cycling OTP attempts.
  failed_attempts: number;
  locked_until: string | null;
}

export async function findPendingOtpByPhone(phone: string): Promise<PendingOtpRow | null> {
  const normalised = normaliseSaPhone(phone);
  if (!normalised) return null;

  const e164Digits = normalised.slice(1);
  const subscriberDigits = normalised.slice(3);
  const localTrunkDigits = '0' + subscriberDigits;

  const rows = await sql<PendingOtpRow>`
    SELECT
      c.staff_id,
      TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS staff_name,
      c.pending_otp_hash,
      c.pending_otp_expires_at,
      c.pending_otp_attempts,
      c.phone_verified_at,
      c.pin_hash,
      c.failed_attempts,
      c.locked_until
    FROM staff s
    JOIN attendance_credentials c ON c.staff_id = s.id
    WHERE LOWER(s.status) = 'active'
      AND regexp_replace(COALESCE(s.phone, ''), '\\D', '', 'g') IN (
        ${e164Digits},
        ${subscriberDigits},
        ${localTrunkDigits}
      )
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function bumpOtpAttempts(staffId: string): Promise<void> {
  try {
    await sql`
      UPDATE attendance_credentials
      SET pending_otp_attempts = pending_otp_attempts + 1,
          updated_at = NOW()
      WHERE staff_id = ${staffId}
    `;
  } catch (err) {
    log.error('[attendance-otp] bumpOtpAttempts UPDATE failed', {
      staffId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function invalidatePendingOtp(staffId: string): Promise<void> {
  try {
    await sql`
      UPDATE attendance_credentials
      SET pending_otp_hash         = NULL,
          pending_otp_expires_at   = NULL,
          pending_otp_requested_at = NULL,
          pending_otp_attempts     = 0,
          updated_at               = NOW()
      WHERE staff_id = ${staffId}
    `;
  } catch (err) {
    log.error('[attendance-otp] invalidatePendingOtp UPDATE failed', {
      staffId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Finalise onboarding: set the new PIN hash, clear pending OTP, mark the
 * phone verified, and (optionally) bind the device fingerprint. All in one
 * UPDATE so we don't leave partially-set rows behind on a crash.
 */
export async function commitPinAndClearOtp(params: {
  staffId: string;
  pinHash: string;
  deviceFingerprint?: string | null;
}): Promise<void> {
  await sql`
    UPDATE attendance_credentials
    SET
      pin_hash                   = ${params.pinHash},
      phone_verified_at          = COALESCE(phone_verified_at, NOW()),
      device_fingerprint_primary = COALESCE(${params.deviceFingerprint ?? null}, device_fingerprint_primary),
      failed_attempts            = 0,
      locked_until               = NULL,
      pending_otp_hash           = NULL,
      pending_otp_expires_at     = NULL,
      pending_otp_requested_at   = NULL,
      pending_otp_attempts       = 0,
      updated_at                 = NOW()
    WHERE staff_id = ${params.staffId}
  `;
}

// =============================================================================
// WhatsApp delivery
// =============================================================================

/**
 * Format a normalised SA phone (+27XXXXXXXXX) into an individual WhatsApp
 * JID. `@s.whatsapp.net` is the direct-user suffix (`@c.us` is WAHA's legacy
 * alias for the same JID; `@g.us` would be a group). OTPs always go direct
 * to the staff member — no groups involved.
 */
function phoneToJid(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

/**
 * Send the OTP via the WA bridge on VPS:8083. Throws on network or non-2xx
 * response so the caller can decide whether to retry; the caller always
 * swallows delivery errors into a generic 200 to preserve the "unknown vs
 * known identifier" symmetry.
 *
 * NOTE: the bridge's POST body key is `group_jid` even for DMs. It's a
 * misnomer from when the bridge only did group broadcasts — it now accepts
 * any JID, including `@s.whatsapp.net` individual chats. Other callers
 * (circuitBreaker alerts, qfield notifications, escalation service) use
 * the same key. See dbCircuitBreaker.ts line 160 for precedent.
 */
export async function sendOtpViaWhatsApp(params: {
  phone: string;        // expected to be already normalised (+27XXXXXXXXX)
  otp: string;
  staffName?: string | null;
}): Promise<void> {
  assertAllowlistedBridgeUrl(WA_BRIDGE_URL);

  const jid = phoneToJid(params.phone);
  const who = params.staffName?.trim() ? `, ${params.staffName.trim()}` : '';
  const message =
    `Hi${who} — your FibreFlow attendance verification code is ${params.otp}.\n` +
    `It expires in ${Math.round(OTP_TTL_MS / 60_000)} minutes. ` +
    `Do not share this code. FibreFlow staff will never ask for it.`;

  // 8s: the bridge's upstream WAHA call typically ACKs in <3s. 15s mostly
  // meant callers waited longer for the generic 200 when the bridge was
  // hung; 8s still comfortably covers p99.
  const response = await fetch(`${WA_BRIDGE_URL}/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_jid: jid, message }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)');
    throw new Error(`WA OTP send failed: HTTP ${response.status} — ${text}`);
  }
}

// Re-export findAuthRowByPhone/normaliseSaPhone for the handlers that consume
// this module so callers don't have to import from two places.
export { findAuthRowByPhone, normaliseSaPhone };
