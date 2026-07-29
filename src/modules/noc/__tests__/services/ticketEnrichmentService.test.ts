/**
 * Pins both lookup sides of NOC ticket enrichment.
 *
 * Both had the same defect: an exact-match miss fell through to
 * `drop_number LIKE '%<digits>%'`, which returns whichever unrelated drop the
 * planner reaches first. See the lookupSOWDrop block at the bottom for the
 * measured blast radius on `sow_drops`.
 *
 * This lookup previously queried `onemap_drops`, which holds 0 rows — so it
 * always returned null and no ticket was ever enriched with a customer name,
 * contact number or address, despite the function being marked WORKING. The
 * live table is `onemap_properties`.
 *
 * The row-preference assertion is the load-bearing one: onemap_properties holds
 * roughly one row per workflow stage per drop, and the contact number is
 * captured at sign-up (~33% of those rows) but not carried onto the
 * "Home Installation: Installed" row (~3%). Tickets are raised against
 * installed drops, so a query that just takes the first row it finds would
 * usually return the installed row, report no contact, and look exactly like
 * the bug this replaces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryOneMock } = vi.hoisted(() => ({ queryOneMock: vi.fn() }));

vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { lookupOneMapDrop, lookupSOWDrop } from '../../services/ticketEnrichmentService';

/** SQL text of every query the service issued, whitespace-collapsed. */
function sqlIssued(): string[] {
  return queryOneMock.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '));
}

beforeEach(() => {
  queryOneMock.mockReset();
});

describe('lookupOneMapDrop', () => {
  it('queries onemap_properties, never the empty onemap_drops table', async () => {
    queryOneMock.mockResolvedValue(null);

    await lookupOneMapDrop('DR1735912');

    expect(sqlIssued().length).toBeGreaterThan(0);
    for (const sql of sqlIssued()) {
      expect(sql).toContain('onemap_properties');
      expect(sql).not.toMatch(/\bonemap_drops\b/);
    }
  });

  it('prefers a row that actually carries a contact number', async () => {
    queryOneMock.mockResolvedValue(null);

    await lookupOneMapDrop('DR1735912');

    // Without this ordering the installed row (no contact) usually wins.
    const [first] = sqlIssued();
    expect(first).toMatch(/ORDER BY/i);
    // DESC is the whole point: flipping it to ASC would invert the fix and
    // prefer rows WITHOUT a contact, reintroducing the bug this replaces.
    expect(first).toMatch(/contact_number IS NOT NULL[^)]*\)\s*DESC/i);
  });

  // last_modified_date is NULL on every contact-bearing row of all 6,840 drops
  // that have more than one, so it can never break a tie. Without a column that
  // is always present, which of several different numbers wins is decided by
  // physical row order — reproducible today, but not guaranteed across a VACUUM
  // or a replan.
  it('breaks ties on a column that is actually populated', async () => {
    queryOneMock.mockResolvedValue(null);

    await lookupOneMapDrop('DR1735912');

    const [first] = sqlIssued();
    expect(first).toMatch(/ORDER BY[\s\S]*\bid\b\s+DESC/i);
  });

  it('maps onemap_properties columns onto the returned shape', async () => {
    queryOneMock.mockResolvedValueOnce({
      drop_number: 'DR1735912',
      property_id: '12345',
      latitude: -26.2708,
      longitude: 27.8546,
      address: '12 Rose Street, Lawley',
      customer_name: 'Thabo Mokoena',
      contact_number: '0821234567',
      status: 'Home Installation: Installed',
    });

    const result = await lookupOneMapDrop('DR1735912');

    expect(result).toMatchObject({
      drop_number: 'DR1735912',
      address: '12 Rose Street, Lawley',
      customer_name: 'Thabo Mokoena',
      contact_number: '0821234567',
    });
    // location_address and contact_name/contact_surname are the real column
    // names — they must be aliased, or every consumer reads undefined.
    const [first] = sqlIssued();
    expect(first).toMatch(/location_address AS address/i);
    expect(first).toMatch(/contact_name/i);
  });

  it('returns null when the DR is not in 1Map at all', async () => {
    queryOneMock.mockResolvedValue(null);

    await expect(lookupOneMapDrop('DR0000000')).resolves.toBeNull();
  });

  it('falls back to a prefix-insensitive match when the exact lookup misses', async () => {
    queryOneMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ drop_number: 'DR1735912', contact_number: '0821234567' });

    const result = await lookupOneMapDrop('DR1735912');

    expect(queryOneMock).toHaveBeenCalledTimes(2);
    expect(result?.drop_number).toBe('DR1735912');
    // The fallback exists to tolerate a stored value with or without the DR
    // prefix — it must still be an equality test on the whole number.
    expect(queryOneMock.mock.calls[1]?.[1]).toEqual(['1735912']);
  });

  // The fallback must never be a substring search. `LIKE '%172950%'` matches
  // nine distinct drops (DR1729500…DR1729509) in the live table, so a miss on
  // the exact lookup could attach a different customer's name, phone number and
  // GPS to the ticket — worse than returning nothing.
  it('never uses a substring match that could hit a different drop', async () => {
    queryOneMock.mockResolvedValue(null);

    await lookupOneMapDrop('DR1729500');

    for (const sql of sqlIssued()) {
      expect(sql).not.toMatch(/LIKE/i);
    }
    for (const call of queryOneMock.mock.calls) {
      for (const param of (call[1] as unknown[]) ?? []) {
        expect(String(param)).not.toContain('%');
      }
    }
  });

  it('returns null for an empty DR without touching the database', async () => {
    await expect(lookupOneMapDrop('')).resolves.toBeNull();
    expect(queryOneMock).not.toHaveBeenCalled();
  });

  it('never throws when the query fails', async () => {
    queryOneMock.mockImplementation(() => Promise.reject(new Error('db down')));

    await expect(lookupOneMapDrop('DR1735912')).resolves.toBeNull();
  });
});

/**
 * `sow_drops` supplies the pole number, contractor, municipality, PON/zone and
 * GPS rendered on the ticket, so a lookup that returns the wrong row sends a
 * technician to a stranger's address.
 *
 * Measured against the live table on 2026-07-29: of 4,134 distinct ticket DR
 * numbers, 422 miss the exact match. The old `LIKE '%<digits>%'` fallback
 * returned a row for 27 of them and every one was a different drop — `DR173`
 * matched 10,107 rows, `DR185` matched 6,829.
 */
describe('lookupSOWDrop', () => {
  it('never uses a substring match that could hit a different drop', async () => {
    queryOneMock.mockResolvedValue(null);

    // DR173 is a real truncated ticket DR: as a substring it matched 10,107 rows.
    await lookupSOWDrop('DR173');

    for (const sql of sqlIssued()) {
      expect(sql).not.toMatch(/LIKE/i);
    }
    for (const call of queryOneMock.mock.calls) {
      for (const param of (call[1] as unknown[]) ?? []) {
        expect(String(param)).not.toContain('%');
      }
    }
  });

  it('falls back to a prefix-insensitive equality match, not a guess', async () => {
    queryOneMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ drop_number: 'DR1735912', pole_number: 'LAW.P.A123' });

    const result = await lookupSOWDrop('DR1735912');

    expect(queryOneMock).toHaveBeenCalledTimes(2);
    expect(result?.drop_number).toBe('DR1735912');
    // Whole-number equality on the stripped value — never a substring of it.
    expect(queryOneMock.mock.calls[1]?.[1]).toEqual(['1735912']);
    expect(sqlIssued()[1]).toMatch(/REGEXP_REPLACE\(UPPER\(drop_number\), *'\^DR', *''\) *= *\$1/i);
  });

  it('matches on the normalised DR, case-insensitively, against sow_drops', async () => {
    queryOneMock.mockResolvedValue(null);

    await lookupSOWDrop('dr1735912');

    const [sql] = sqlIssued();
    expect(sql).toContain('sow_drops');
    expect(sql).toMatch(/UPPER\(drop_number\)\s*=\s*\$1/i);
    expect(queryOneMock.mock.calls[0]?.[1]).toEqual(['DR1735912']);
  });

  // normalizeDRNumber's docstring has always claimed to accept "1853428", but
  // the pattern required a literal D, so the bare form fell through unchanged
  // and could never equal a DR-prefixed stored value. Callers write dr_number
  // to the database unnormalised, so the form is reachable.
  it('prefixes a bare numeric DR so it can match a DR-prefixed row', async () => {
    queryOneMock.mockResolvedValue(null);

    await lookupSOWDrop('1853428');

    expect(queryOneMock.mock.calls[0]?.[1]).toEqual(['DR1853428']);
  });

  // The normalisation is anchored so it cannot rewrite DR-{PROJECT}-{ZONE}
  // references: an unanchored pattern finds the digits in DR-LAW-A-045 and
  // turns it into DR045, silently pointing the lookup at a different drop.
  it('leaves a DR-{PROJECT}-{ZONE} reference untouched', async () => {
    queryOneMock.mockResolvedValue(null);

    await lookupSOWDrop('DR-LAW-A-045');

    expect(queryOneMock.mock.calls[0]?.[1]).toEqual(['DR-LAW-A-045']);
  });

  it('returns the drop on an exact match', async () => {
    queryOneMock.mockResolvedValueOnce({
      drop_number: 'DR1735912',
      pole_number: 'LAW.P.A123',
      latitude: -26.2708,
      longitude: 27.8546,
      address: '12 Rose Street, Lawley',
      municipality: 'City of Johannesburg',
      pon_no: 4,
      zone_no: 7,
      contractor: 'Acme Fibre',
      status: 'Installed',
    });

    await expect(lookupSOWDrop('DR1735912')).resolves.toMatchObject({
      drop_number: 'DR1735912',
      pole_number: 'LAW.P.A123',
      contractor: 'Acme Fibre',
    });
  });

  it('returns null for an empty DR without touching the database', async () => {
    await expect(lookupSOWDrop('')).resolves.toBeNull();
    expect(queryOneMock).not.toHaveBeenCalled();
  });

  it('never throws when the query fails', async () => {
    queryOneMock.mockImplementation(() => Promise.reject(new Error('db down')));

    await expect(lookupSOWDrop('DR1735912')).resolves.toBeNull();
  });
});
