/**
 * Unit tests for checkStaffSaId.
 *
 * The guard exists because the staff edit form mirrors one value into
 * sa_id_number (varchar 20) and id_number (varchar 13); anything over 13
 * characters reached Postgres and came back as a bare "HTTP 500".
 *
 * What must hold:
 *   - a malformed NEW value is rejected, in EITHER of the two mirrored fields
 *   - the raw submitted string is judged, so whitespace cannot smuggle a
 *     too-long value past the length check
 *   - an unchanged value is allowed through even when invalid, so the legacy
 *     rows holding a bad SA ID stay editable
 *   - clearing the field is allowed (foreign nationals carry a passport)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/neon-sql', () => ({ getSql: () => mocks.sql }));

import { checkStaffSaId } from '../staffSaIdGuard';

const STAFF_ID = '5ec63f0f-c3e6-4cf5-b3d7-b169c86ecf1d';
const VALID_SA_ID = '7802035087081';
/** The value that produced the original 500: an SA ID with an import prefix. */
const PREFIXED = '027802035087081';
/** A stored value that fails validation but must remain editable. */
const LEGACY_BAD = '760719500035H';

function storedRow(sa_id_number: string | null, id_number: string | null = null) {
  mocks.sql.mockResolvedValueOnce([{ sa_id_number, id_number }]);
}

beforeEach(() => {
  mocks.sql.mockReset();
});

describe('checkStaffSaId', () => {
  it('allows a body that submits no SA ID at all', async () => {
    expect(await checkStaffSaId(STAFF_ID, { position: 'Technician' })).toBeNull();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('allows clearing both mirrored fields', async () => {
    expect(await checkStaffSaId(STAFF_ID, { saIdNumber: '', idNumber: '' })).toBeNull();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('rejects a new value carrying the legacy import prefix', async () => {
    storedRow(null);
    const out = await checkStaffSaId(STAFF_ID, { saIdNumber: PREFIXED });
    expect(out?.field).toBe('saIdNumber');
    // Rejected for its LENGTH — not merely because some error fired.
    expect(out?.message).toContain('exactly 13 digits with no spaces');
  });

  it('rejects a new 13-digit value whose check digit is wrong', async () => {
    storedRow(null);
    const out = await checkStaffSaId(STAFF_ID, { saIdNumber: '8510256080085' });
    // A distinct reason from the length rejection above, so neither assertion
    // can pass for the other's cause.
    expect(out?.message).toContain('checksum');
    expect(out?.message).not.toContain('exactly 13 digits with no spaces');
  });

  it('reads the row belonging to the staff member being updated', async () => {
    storedRow(null);
    await checkStaffSaId(STAFF_ID, { saIdNumber: VALID_SA_ID });
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    expect(mocks.sql.mock.calls[0]).toContain(STAFF_ID);
  });

  it('accepts a new valid SA ID', async () => {
    storedRow(null);
    expect(await checkStaffSaId(STAFF_ID, { saIdNumber: VALID_SA_ID })).toBeNull();
  });

  it('leaves an unchanged invalid SA ID alone so the row stays editable', async () => {
    storedRow(LEGACY_BAD);
    expect(await checkStaffSaId(STAFF_ID, { saIdNumber: LEGACY_BAD })).toBeNull();
  });

  it('still rejects when a row holding an invalid SA ID is given a different bad value', async () => {
    storedRow(LEGACY_BAD);
    expect(await checkStaffSaId(STAFF_ID, { saIdNumber: PREFIXED })).not.toBeNull();
  });

  it('reads the snake_case field names too', async () => {
    storedRow(null);
    expect(await checkStaffSaId(STAFF_ID, { sa_id_number: PREFIXED })).not.toBeNull();
  });

  describe('both mirrored fields', () => {
    it('rejects a bad idNumber even when saIdNumber is valid', async () => {
      // The pair travels together in the browser, but another client can send
      // them out of step — and id_number is the narrow column that breaks.
      storedRow(null, null);
      const out = await checkStaffSaId(STAFF_ID, { saIdNumber: VALID_SA_ID, idNumber: PREFIXED });
      expect(out?.field).toBe('idNumber');
      // The message is the only part the user ever sees, so it must name the
      // field they are looking at — the two live on different tabs.
      expect(out?.message).toContain('SA ID Number (for Tax)');
    });

    it('validates idNumber against id_number, not against sa_id_number', async () => {
      // Same string as the stored sa_id_number, but it is a CHANGE to
      // id_number, so it must still be validated.
      storedRow(LEGACY_BAD, null);
      expect(await checkStaffSaId(STAFF_ID, { idNumber: LEGACY_BAD })).not.toBeNull();
    });

    it('allows an unchanged pair on a legacy row', async () => {
      storedRow(LEGACY_BAD, LEGACY_BAD);
      expect(
        await checkStaffSaId(STAFF_ID, { saIdNumber: LEGACY_BAD, idNumber: LEGACY_BAD })
      ).toBeNull();
    });
  });

  it('rejects a value padded with whitespace rather than validating its cleaned form', async () => {
    // validateSaId strips whitespace before measuring length, so the cleaned
    // form looks fine while the 14-character original is what gets written.
    storedRow(null);
    const out = await checkStaffSaId(STAFF_ID, { saIdNumber: '780 2035087081' });
    expect(out?.message).toContain('exactly 13 digits with no spaces');
  });

  it('rejects a non-string payload without stringifying it into a plausible ID', async () => {
    storedRow(null);
    expect(await checkStaffSaId(STAFF_ID, { saIdNumber: ['7802035087081'] })).not.toBeNull();
  });

  describe('create (no stored row)', () => {
    it('validates without querying for a stored value', async () => {
      expect(await checkStaffSaId(null, { saIdNumber: PREFIXED })).not.toBeNull();
      expect(mocks.sql).not.toHaveBeenCalled();
    });

    it('accepts a valid SA ID on create', async () => {
      expect(await checkStaffSaId(null, { saIdNumber: VALID_SA_ID })).toBeNull();
    });
  });
});
