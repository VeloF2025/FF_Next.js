/**
 * Credential handling for the /my portal — PIN and password.
 *
 * Two credential flavours, two stores:
 *   - PIN flow:      hash lives in `attendance_credentials.pin_hash` (set via
 *                    the WhatsApp OTP onboarding flow, /api/my/login/*).
 *   - Password flow: hash lives in `users.password` — the SAME password the
 *                    staff member uses for the main FibreFlow web app. This
 *                    avoids forcing every staff member to set up a second
 *                    password just for /my (the previous design left the
 *                    Email+password tab unusable because no one ever set one).
 *
 * Lockout (failed_attempts, locked_until) is keyed by `staff_id` in
 * `attendance_credentials`. Both flows share the counter — 5 consecutive bad
 * attempts across either credential locks the row for 15 minutes. The row is
 * lazy-upserted on the first failed attempt, so staff with no pre-existing
 * credentials row still accumulate lockout state.
 *
 * `attendance_credentials.password_hash` is retained as a column for
 * historical compatibility but is no longer read by the login path.
 */

import * as bcrypt from 'bcryptjs';
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';

const PIN_LENGTH = 6;
const BCRYPT_ROUNDS = 12;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Computed at module load. Used as the `bcrypt.compare` target when no
 * credential row matches the identifier, so response latency is dominated
 * by a real bcrypt compare in both the "registered" and "unknown" paths.
 * Without this, unknown identifiers return in ~0 ms while registered ones
 * take ~200 ms — a trivial enumeration oracle.
 */
const DUMMY_HASH: string = bcrypt.hashSync(
  'attendance-portal-never-matches-timing-padding',
  BCRYPT_ROUNDS
);

/** Exposed only so the login handler can run a dummy compare on the
 *  identifier-not-found path. Not part of the public module API. */
export async function consumeTimingPadding(plain: string): Promise<void> {
  try {
    await bcrypt.compare(plain, DUMMY_HASH);
  } catch {
    // bcrypt shouldn't throw on the constant above; if it ever does, the
    // padding step degrades silently — don't affect the login response.
  }
}

export interface StaffAuthRow extends Record<string, unknown> {
  staff_id: string;
  pin_hash: string | null;
  password_hash: string | null;
  failed_attempts: number;
  locked_until: string | null;
  staff_status: string | null;
  staff_name: string;
  staff_phone: string | null;
  staff_email: string | null;
}

/**
 * Normalise a South African phone number to E.164 `+27XXXXXXXXX`.
 * Accepts `082 123 4567`, `0821234567`, `27821234567`, `+27821234567`,
 * `+27 82 123 4567`, and the same with dashes.
 *
 * Returns null if the input can't be interpreted as a 9-digit SA mobile.
 */
export function normaliseSaPhone(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');

  // +27XXXXXXXXX (E.164, country code + 9 subscriber digits)
  if (digits.length === 11 && digits.startsWith('27')) return `+${digits}`;

  // 0XXXXXXXXX (local 10-digit, leading zero trunk code)
  if (digits.length === 10 && digits.startsWith('0')) return `+27${digits.slice(1)}`;

  // 9 subscriber digits with no prefix — must NOT start with 0 (that would be
  // a too-short local number, not a valid SA subscriber). E.g. '821234567' OK,
  // '082123456' NOT OK.
  if (digits.length === 9 && !digits.startsWith('0')) return `+27${digits}`;

  // Some systems prepend '27' and keep the trunk zero: 270XXXXXXXXX
  if (digits.length === 12 && digits.startsWith('270')) return `+27${digits.slice(3)}`;

  return null;
}

/** Hash a 6-digit PIN. Validates format first. */
export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error(`PIN must be exactly ${PIN_LENGTH} digits`);
  }
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

/** Hash a password — delegates to the shared auth helper's cost factor. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a plaintext credential against a bcrypt hash. Returns false (not
 * an error) when the hash is structurally invalid — a corrupt row in
 * `attendance_credentials` should present to the user as "wrong credential"
 * and trip lockout, not surface as a 500. The underlying error is logged
 * so ops can investigate.
 */
export async function verifyCredential(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch (err) {
    log.error('[attendance-portal] bcrypt.compare failed — likely corrupt hash', {
      hashPrefix: typeof hash === 'string' ? hash.slice(0, 7) : '(non-string)',
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Look up a staff row joined with its credentials by phone (PIN flow) or
 * email (password flow, case-insensitive). Both finders filter to
 * `status='active'` in SQL — non-active staff cannot log in regardless of
 * what the caller does with the row.
 */
export async function findAuthRowByPhone(phone: string): Promise<StaffAuthRow | null> {
  const normalised = normaliseSaPhone(phone);
  if (!normalised) return null;

  // Three forms to match whatever `staff.phone` was stored as historically:
  //   1. E.164 digits only  (e.g. '27821234567')   — preferred
  //   2. Subscriber only     (e.g. '821234567')     — no country code
  //   3. Local trunk form    (e.g. '0821234567')    — leading zero
  const e164Digits = normalised.slice(1);             // '27821234567'
  const subscriberDigits = normalised.slice(3);        // '821234567'
  const localTrunkDigits = '0' + subscriberDigits;     // '0821234567'

  // LEFT JOIN so first-time staff (no credentials row yet) still match and
  // can receive an onboarding OTP. The OTP upsert creates the credentials
  // row on demand. Migration 318 relaxed the CHECK constraint to allow a
  // row with only pending_otp_hash, so this is safe.
  // COALESCE on the auth-state columns so consumers always see concrete
  // values for a brand-new (no-credentials) staff member.
  // Note: `password_hash` from attendance_credentials is intentionally not
  // selected here. The PIN flow only authenticates against `pin_hash`; the
  // password flow uses `findAuthRowByEmail` (which sources from users.password).
  // We still return a `password_hash` field on StaffAuthRow as `null` so the
  // type stays consistent across both finders.
  const rows = await sql<StaffAuthRow>`
    SELECT
      s.id              AS staff_id,
      c.pin_hash,
      NULL::text        AS password_hash,
      COALESCE(c.failed_attempts, 0) AS failed_attempts,
      c.locked_until,
      s.status          AS staff_status,
      TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS staff_name,
      s.phone           AS staff_phone,
      s.email           AS staff_email
    FROM staff s
    LEFT JOIN attendance_credentials c ON c.staff_id = s.id
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

/**
 * Look up the password-flow auth row by email.
 *
 * Source of truth for the password hash is `users.password` (same as the main
 * web app's login). The JOIN goes strictly through `staff.user_id` — staff
 * rows without a `user_id` link cannot use the email+password flow (they
 * still log in via Phone+PIN). Avoiding an OR-branch in the JOIN closes a
 * small timing-oracle asymmetry between FK-index lookups and email-fallback
 * scans. `attendance_credentials` is LEFT-JOINed for lockout state only; a
 * missing row is fine and gets lazy-created on the first failed attempt.
 *
 * `users.email` carries a UNIQUE constraint, but `staff.user_id` does not,
 * so an `ORDER BY s.id` is required for deterministic `LIMIT 1` selection
 * if a single user is ever linked to multiple staff rows.
 *
 * Returned `password_hash` field is aliased from `users.password` so callers
 * (login.ts) don't need to know the source.
 */
export async function findAuthRowByEmail(email: string): Promise<StaffAuthRow | null> {
  const rows = await sql<StaffAuthRow>`
    SELECT
      s.id              AS staff_id,
      c.pin_hash,
      u.password        AS password_hash,
      COALESCE(c.failed_attempts, 0) AS failed_attempts,
      c.locked_until,
      s.status          AS staff_status,
      TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS staff_name,
      s.phone           AS staff_phone,
      s.email           AS staff_email
    FROM users u
    JOIN staff s ON s.user_id = u.id
    LEFT JOIN attendance_credentials c ON c.staff_id = s.id
    WHERE LOWER(u.email) = LOWER(${email})
      AND LOWER(s.status) = 'active'
      AND u.is_active = true
    ORDER BY s.id
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Returns ms remaining on the lock, or 0 if not currently locked.
 *
 * A non-null but unparseable `locked_until` is treated as "locked forever"
 * (Infinity). That's the fail-closed choice — if the column is corrupt, we
 * refuse to authenticate rather than silently letting everything through.
 * Ops will see the log and fix the row.
 */
export function lockoutMsRemaining(row: Pick<StaffAuthRow, 'locked_until'>): number {
  if (!row.locked_until) return 0;
  const t = new Date(row.locked_until).getTime();
  if (Number.isNaN(t)) {
    log.error('[attendance-portal] invalid locked_until value', {
      value: String(row.locked_until),
    });
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, t - Date.now());
}

/**
 * Record a failed attempt. Locks the row once the threshold is reached.
 *
 * NEVER throws. A transient DB failure here must not cause the login
 * endpoint to return 500, because that would (a) leak "account exists" via
 * the error-code difference and (b) leave the lockout counter stuck,
 * allowing unlimited bypass during any DB blip.
 */
export async function recordFailedAttempt(staffId: string): Promise<void> {
  try {
    // UPSERT: a staff member whose only credential is `users.password` has no
    // attendance_credentials row until their first failed /my attempt, and we
    // still need lockout state to accumulate. Migration 333 dropped the
    // CHECK requiring a hash, so a lockout-only row is valid. `created_at` is
    // set explicitly rather than relying on the column DEFAULT — defends
    // against a future DDL change that drops the DEFAULT.
    await sql`
      INSERT INTO attendance_credentials (staff_id, failed_attempts, locked_until, created_at, updated_at)
      VALUES (${staffId}, 1, NULL, NOW(), NOW())
      ON CONFLICT (staff_id) DO UPDATE
      SET
        failed_attempts = attendance_credentials.failed_attempts + 1,
        locked_until = CASE
          WHEN attendance_credentials.failed_attempts + 1 >= ${LOCKOUT_THRESHOLD}
            THEN NOW() + (${LOCKOUT_DURATION_MS} || ' milliseconds')::interval
          ELSE attendance_credentials.locked_until
        END,
        updated_at = NOW()
    `;
  } catch (err) {
    // Lockout is a security control — we must scream when it fails to write.
    // But we do NOT rethrow: the caller (login handler) has already decided
    // this is a bad attempt; turning it into a 500 would be worse than the
    // missed increment.
    log.error('[attendance-portal] recordFailedAttempt UPDATE failed', {
      staffId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Clear failure counters after a successful login. Same fail-safe rule as
 * `recordFailedAttempt`: never throw. Leaving a non-zero counter from an
 * earlier failed attempt is far better than turning a successful login
 * into a 500.
 */
export async function recordSuccessfulLogin(staffId: string): Promise<void> {
  try {
    // UPSERT: same rationale as recordFailedAttempt — a staff member can
    // legitimately have no attendance_credentials row when they authenticate
    // via users.password. Inserting a zeroed row gives subsequent failed
    // attempts something to increment. `created_at` set explicitly for the
    // same reason as recordFailedAttempt.
    await sql`
      INSERT INTO attendance_credentials (staff_id, failed_attempts, locked_until, created_at, updated_at)
      VALUES (${staffId}, 0, NULL, NOW(), NOW())
      ON CONFLICT (staff_id) DO UPDATE
      SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
    `;
  } catch (err) {
    log.error('[attendance-portal] recordSuccessfulLogin UPDATE failed', {
      staffId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
