/**
 * SA ID guard for the staff write endpoints.
 *
 * The staff edit form mirrors one value into two columns of different widths:
 * `sa_id_number` (varchar 20) and `id_number` (varchar 13). A value longer than
 * 13 characters therefore reaches Postgres and fails with 22001, which the UI
 * used to surface as a bare "HTTP 500" with no indication of the faulty field.
 *
 * Both submitted fields are checked independently against their own stored
 * column: the two travel together in the browser, but nothing stops another
 * client sending them out of step, and validating only one would let the value
 * that actually breaks the write through.
 *
 * A value is validated in its RAW form — exactly 13 digits, nothing else.
 * validateSaId strips whitespace before checking length, so validating its
 * cleaned form would accept "780 2035087081" and then persist the 14-character
 * original into a varchar(13).
 *
 * Only a value that DIFFERS from what is stored is validated. Several legacy
 * rows hold an SA ID that fails validation and cannot be corrected without the
 * physical document — validating unconditionally would lock those staff out of
 * every edit, which is the same failure this guard exists to remove.
 */

import { getSql } from '@/lib/neon-sql';
import { validateSaId } from '@/lib/saIdValidation';

export interface SaIdRejection {
  field: 'saIdNumber' | 'idNumber';
  message: string;
}

type Body = Record<string, unknown> | undefined | null;

/** A stored SA ID as held by the two columns that carry it. */
interface StoredIds {
  sa_id_number: string | null;
  id_number: string | null;
}

const THIRTEEN_DIGITS = /^\d{13}$/;

const ADVICE =
  'A South African ID is exactly 13 digits. For a foreign national, leave the SA ID blank and capture the passport details instead.';

/**
 * Read a submitted value under either casing, unmodified — the raw value is
 * both what gets validated and what gets written. Returns undefined when the
 * field was not submitted at all.
 */
function submitted(body: Body, camel: string, snake: string): unknown {
  const raw = body?.[camel] ?? body?.[snake];
  return raw === null ? undefined : raw;
}

const FIELD_LABEL: Record<SaIdRejection['field'], string> = {
  saIdNumber: 'SA ID Number',
  idNumber: 'SA ID Number (for Tax)',
};

function reject(field: SaIdRejection['field'], reason: string): SaIdRejection {
  // Name the field the user is looking at — the two live on different tabs.
  return { field, message: `${FIELD_LABEL[field]}: ${reason}. ${ADVICE}` };
}

function checkOne(
  field: SaIdRejection['field'],
  value: unknown,
  storedValue: string | null
): SaIdRejection | null {
  // A number is accepted as text; anything else (array, object) is not a
  // plausible ID and must not be coerced into one — String(['7802035087081'])
  // would read as valid and then reach the column as an array.
  if (typeof value !== 'string' && typeof value !== 'number') {
    return reject(field, 'the value must be a 13-digit number');
  }
  const text = String(value);
  // Unchanged — leave a legacy-bad value alone so the row stays editable.
  if (text === (storedValue ?? '')) return null;
  if (!THIRTEEN_DIGITS.test(text)) {
    return reject(field, 'the value must be exactly 13 digits with no spaces or letters');
  }
  const result = validateSaId(text);
  if (result.isValid) return null;
  return reject(field, result.errors.join('; '));
}

/**
 * Validate the SA ID fields on a staff write.
 * `staffId` is null for a create, where there is nothing stored to compare against.
 * Returns null when the write may proceed.
 */
export async function checkStaffSaId(staffId: string | null, body: Body): Promise<SaIdRejection | null> {
  const saId = submitted(body, 'saIdNumber', 'sa_id_number');
  const idNum = submitted(body, 'idNumber', 'id_number');

  // Clearing either field is always allowed — foreign nationals carry a
  // passport, and an SA ID captured in error must be removable.
  const pending: [SaIdRejection['field'], unknown][] = [];
  if (saId !== undefined && saId !== '') pending.push(['saIdNumber', saId]);
  if (idNum !== undefined && idNum !== '') pending.push(['idNumber', idNum]);
  if (pending.length === 0) return null;

  let stored: StoredIds | undefined;
  if (staffId) {
    const sql = getSql();
    const rows = (await sql`
      SELECT sa_id_number, id_number FROM staff WHERE id = ${staffId}
    `) as StoredIds[];
    stored = rows[0];
  }

  for (const [field, value] of pending) {
    const storedValue = field === 'saIdNumber' ? stored?.sa_id_number : stored?.id_number;
    const rejection = checkOne(field, value, storedValue ?? null);
    if (rejection) return rejection;
  }
  return null;
}
