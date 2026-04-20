/**
 * Credential handling for the /my portal — PIN and password.
 *
 * The attendance_credentials table stores either a pin_hash (field staff)
 * or a password_hash (office staff), or both for office staff who also
 * clock in via the mobile portal. Lockout is shared: 5 consecutive bad
 * attempts across either credential locks the row for 15 minutes.
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

  const rows = await sql<StaffAuthRow>`
    SELECT
      c.staff_id,
      c.pin_hash,
      c.password_hash,
      c.failed_attempts,
      c.locked_until,
      s.status         AS staff_status,
      TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS staff_name,
      s.phone          AS staff_phone,
      s.email          AS staff_email
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

export async function findAuthRowByEmail(email: string): Promise<StaffAuthRow | null> {
  const rows = await sql<StaffAuthRow>`
    SELECT
      c.staff_id,
      c.pin_hash,
      c.password_hash,
      c.failed_attempts,
      c.locked_until,
      s.status         AS staff_status,
      TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS staff_name,
      s.phone          AS staff_phone,
      s.email          AS staff_email
    FROM staff s
    JOIN attendance_credentials c ON c.staff_id = s.id
    WHERE LOWER(s.status) = 'active'
      AND LOWER(s.email) = LOWER(${email})
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
    await sql`
      UPDATE attendance_credentials
      SET
        failed_attempts = failed_attempts + 1,
        locked_until = CASE
          WHEN failed_attempts + 1 >= ${LOCKOUT_THRESHOLD}
            THEN NOW() + (${LOCKOUT_DURATION_MS} || ' milliseconds')::interval
          ELSE locked_until
        END,
        updated_at = NOW()
      WHERE staff_id = ${staffId}
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
    await sql`
      UPDATE attendance_credentials
      SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
      WHERE staff_id = ${staffId}
    `;
  } catch (err) {
    log.error('[attendance-portal] recordSuccessfulLogin UPDATE failed', {
      staffId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
