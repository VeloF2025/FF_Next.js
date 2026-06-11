/**
 * staffPhoneDedup — find an existing staff row by phone before creating one.
 *
 * Phone is the identity key for the /my portal (OTP login resolves staff by
 * phone), so two staff rows sharing a phone split a person's identity: custody
 * lands on one row while the portal session resolves the other. Registration
 * endpoints (POST /api/field/users, POST /api/my/stores/technicians) call this
 * before INSERT and return the existing row instead of creating a duplicate.
 *
 * Matching mirrors findAuthRowByPhone in credentialUtils: the input is
 * normalised to E.164 and compared against the three digit forms staff.phone
 * has historically been stored in (27..., 0..., subscriber-only).
 */

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { normaliseSaPhone } from '@/modules/attendance/portal/credentialUtils';

export interface ExistingStaffByPhone {
  id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  account_status: string;
  created_by_staff_id: string | null;
}

/**
 * Returns the existing staff row matching the phone, or null when none exists
 * (or the phone can't be parsed as an SA number — the caller then proceeds
 * with its INSERT exactly as before).
 */
export async function findStaffByPhone(rawPhone: string): Promise<ExistingStaffByPhone | null> {
  const normalised = normaliseSaPhone(rawPhone);
  if (!normalised) return null;

  const e164Digits = normalised.slice(1); // '27821234567'
  const subscriberDigits = normalised.slice(3); // '821234567'
  const localTrunkDigits = '0' + subscriberDigits; // '0821234567'

  const rows = await sql`
    SELECT id, first_name, last_name, role, account_status, created_by_staff_id
    FROM staff
    WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')
          IN (${e164Digits}, ${localTrunkDigits}, ${subscriberDigits})
    ORDER BY (account_status = 'active') DESC, created_at ASC
    LIMIT 1
  `;

  return (rows[0] as ExistingStaffByPhone | undefined) ?? null;
}

/**
 * Dedup check used by the registration endpoints. Returns the existing row
 * when found, logging a warning if the submitted name doesn't match (the
 * caller still gets the existing row — phone is the identity key).
 */
export async function findExistingStaffForRegistration(
  rawPhone: string,
  firstName: string,
  lastName: string,
): Promise<ExistingStaffByPhone | null> {
  const existing = await findStaffByPhone(rawPhone);
  if (!existing) return null;

  const existingName = `${existing.first_name ?? ''} ${existing.last_name ?? ''}`.trim().toLowerCase();
  const submittedName = `${firstName} ${lastName}`.trim().toLowerCase();
  if (existingName && submittedName && existingName !== submittedName) {
    log.warn(
      'staff registration matched existing phone under a different name — returning existing row',
      { staffId: existing.id, existingName, submittedName },
      'staffPhoneDedup',
    );
  }

  return existing;
}
