/**
 * Pins the 1Map side of NOC ticket enrichment.
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

import { lookupOneMapDrop } from '../../services/ticketEnrichmentService';

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
    expect(first).toMatch(/contact_number IS NOT NULL/i);
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

  it('falls back to a fuzzy match when the exact lookup misses', async () => {
    queryOneMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ drop_number: 'DR1735912', contact_number: '0821234567' });

    const result = await lookupOneMapDrop('DR1735912');

    expect(queryOneMock).toHaveBeenCalledTimes(2);
    expect(result?.drop_number).toBe('DR1735912');
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
