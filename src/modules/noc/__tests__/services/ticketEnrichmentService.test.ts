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

const { queryOneMock, oesGpsMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
  oesGpsMock: vi.fn(),
}));

vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
// Only the DB-touching lookup is stubbed; haversineMeters stays real so the
// divergence figure below is genuinely computed, not asserted against itself.
vi.mock('../../services/ticketGpsService', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  lookupOesGpsByDr: (...a: unknown[]) => oesGpsMock(...a),
}));

import { lookupOneMapDrop, lookupSOWDrop, enrichTicketData } from '../../services/ticketEnrichmentService';

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
 * The measurements behind these tests live in exactly one place, alongside the
 * queries that produce them: `scripts/check-sow-drop-lookup-collisions.sql`.
 * Deliberately not repeated here, and not in lookupSOWDrop's doc comment
 * either — duplicated figures drift apart when only one copy gets corrected.
 */
describe('lookupSOWDrop', () => {
  it('never uses a substring match that could hit a different drop', async () => {
    queryOneMock.mockResolvedValue(null);

    // DR173 is a real truncated ticket DR, and the worst measured collision.
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

/**
 * enrichTicketData composes the lookups the tests above pin individually. It had
 * no coverage at all, so the OES coordinate it now returns — and the divergence
 * figure the ticket UI uses to decide whether to show both locations — shipped
 * unverified.
 *
 * lookupOesGpsByDr is mocked rather than driven through the pool: its own SQL is
 * pinned in ticketGpsLookup.test.ts, and what matters here is the composition —
 * that oes_gps is surfaced SEPARATELY from fibreflow_gps rather than collapsed
 * into it, because collapsing would hide exactly the disagreement this is for.
 */
describe('enrichTicketData — OES coordinate and divergence', () => {
  const SOW_ROW = {
    drop_number: 'DR1735912',
    pole_number: 'P1',
    latitude: -26.7295508,
    longitude: 27.0179814,
    address: '1 Main Rd',
    municipality: 'M',
    pon_no: 1,
    zone_no: 2,
    contractor: 'C',
    status: 'active',
  };

  beforeEach(() => {
    oesGpsMock.mockReset();
    queryOneMock.mockReset();
  });

  it('returns the OES coordinate alongside the design one, not instead of it', async () => {
    queryOneMock.mockImplementation((sql: string) =>
      Promise.resolve(String(sql).includes('sow_drops') ? SOW_ROW : null)
    );
    oesGpsMock.mockResolvedValue({ latitude: -26.7387387, longitude: 27.0148998 });

    const r = await enrichTicketData('DR1735912');

    expect(r.oes_gps).toEqual({
      latitude: -26.7387387,
      longitude: 27.0148998,
      address: null,
    });
    // The design coordinate must survive — the UI shows both when they disagree.
    expect(r.fibreflow_gps).toMatchObject({ latitude: -26.7295508, longitude: 27.0179814 });
  });

  it('reports the separation in whole metres', async () => {
    queryOneMock.mockImplementation((sql: string) =>
      Promise.resolve(String(sql).includes('sow_drops') ? SOW_ROW : null)
    );
    oesGpsMock.mockResolvedValue({ latitude: -26.7387387, longitude: 27.0148998 });

    const r = await enrichTicketData('DR1735912');

    // Same pair measured at 1,066 m in Postgres.
    expect(r.gps_divergence_m).toBeGreaterThan(1060);
    expect(r.gps_divergence_m).toBeLessThan(1072);
    expect(Number.isInteger(r.gps_divergence_m)).toBe(true);
  });

  it('leaves divergence null when there is nothing to compare against', async () => {
    queryOneMock.mockResolvedValue(null); // no SOW row
    oesGpsMock.mockResolvedValue({ latitude: -26.7387387, longitude: 27.0148998 });

    const r = await enrichTicketData('DR1735912');

    expect(r.oes_gps).not.toBeNull();
    expect(r.fibreflow_gps).toBeNull();
    expect(r.gps_divergence_m).toBeNull();
  });

  it('measures divergence against 1Map when sow_drops has no row', async () => {
    // The gap this closes: divergence used to be computed only against
    // sow_drops, but the UI ranks 1Map second when sow_drops misses. 244 open
    // tickets sit in that configuration — 76 of them more than 50m apart, worst
    // 10.5km — and every one rendered as a single confident pin with no warning.
    queryOneMock.mockImplementation((sql: string) =>
      Promise.resolve(
        String(sql).includes('onemap_properties')
          ? {
              drop_number: 'DR1735912',
              latitude: -26.7295508,
              longitude: 27.0179814,
              address: '1 Main Rd',
              customer_name: null,
              contact_number: null,
              property_id: null,
              status: null,
            }
          : null // sow_drops misses
      )
    );
    oesGpsMock.mockResolvedValue({ latitude: -26.7387387, longitude: 27.0148998 });

    const r = await enrichTicketData('DR1735912');

    expect(r.fibreflow_gps).toBeNull();
    expect(r.onemap_gps).not.toBeNull();
    expect(r.gps_divergence_m).toBeGreaterThan(1060);
    expect(r.gps_divergence_m).toBeLessThan(1072);
  });

  it('leaves oes_gps and divergence null when the OES report has no row', async () => {
    queryOneMock.mockImplementation((sql: string) =>
      Promise.resolve(String(sql).includes('sow_drops') ? SOW_ROW : null)
    );
    oesGpsMock.mockResolvedValue(null);

    const r = await enrichTicketData('DR1735912');

    expect(r.oes_gps).toBeNull();
    expect(r.gps_divergence_m).toBeNull();
    expect(r.fibreflow_gps).not.toBeNull();
  });

  it('does not look anything up without a DR', async () => {
    const r = await enrichTicketData(null);
    expect(r.oes_gps).toBeNull();
    expect(r.gps_divergence_m).toBeNull();
    expect(oesGpsMock).not.toHaveBeenCalled();
  });
});
