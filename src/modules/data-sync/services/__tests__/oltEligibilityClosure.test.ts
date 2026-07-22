/**
 * Tests for the FT daily-eligibility closure sweep: the payable predicate,
 * the guarded resolve, ticket-close accounting, and the never-act cases
 * ('Not Eligible' / NULL eligibility must not mutate anything).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { poolQuery, closeLinkedTicket, getSystemUser } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  closeLinkedTicket: vi.fn(),
  getSystemUser: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ default: { query: poolQuery } }));
vi.mock('../oltMatchReconciliationService', () => ({ closeLinkedTicket, getSystemUser }));

import {
  isPayableEligibility,
  processEligibilityClosures,
} from '../oltEligibilityClosureService';

describe('isPayableEligibility', () => {
  it('true for Eligible and any PAID variant', () => {
    expect(isPayableEligibility('Eligible')).toBe(true);
    expect(isPayableEligibility('PAID - Invoiced on 2026-07-12')).toBe(true);
    expect(isPayableEligibility('paid - invoiced on 2026-01-01')).toBe(true);
  });

  it('false for Not Eligible, blank, and null', () => {
    expect(isPayableEligibility('Not Eligible')).toBe(false);
    expect(isPayableEligibility('')).toBe(false);
    expect(isPayableEligibility(null)).toBe(false);
  });
});

interface Candidate {
  id: string;
  drop_number: string;
  maintenance_ticket_id: string | null;
  payment_eligibility: string;
}

function primeDb(candidates: Candidate[], { updateRowCount = 1 } = {}) {
  poolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM olt_mismatch_records')) return { rows: candidates, rowCount: candidates.length };
    if (sql.includes('UPDATE olt_mismatch_records')) return { rows: [], rowCount: updateRowCount };
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  });
}

const updateCalls = () =>
  poolQuery.mock.calls.filter((c) => String(c[0]).includes('UPDATE olt_mismatch_records'));

describe('processEligibilityClosures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSystemUser.mockResolvedValue({ id: 'sys-1', email: 'system@fibreflow.app' });
  });

  it('resolves records and closes tickets for Eligible and PAID DRs', async () => {
    primeDb([
      { id: 'r1', drop_number: 'DR1', maintenance_ticket_id: 't1', payment_eligibility: 'Eligible' },
      { id: 'r2', drop_number: 'DR2', maintenance_ticket_id: null, payment_eligibility: 'PAID - Invoiced on 2026-07-12' },
    ]);
    closeLinkedTicket.mockResolvedValue('closed');

    const result = await processEligibilityClosures();

    expect(result).toMatchObject({ candidates: 2, recordsResolved: 2, ticketsClosed: 1, ticketFailures: 0 });
    const upd = updateCalls();
    expect(upd).toHaveLength(2);
    expect(upd[0]![1][0]).toContain('"Eligible"'); // note quotes FT's verbatim value
    expect(upd[0]![1][1]).toBe('sys-1');
    expect(closeLinkedTicket).toHaveBeenCalledTimes(1);
  });

  it('skips a row the predicate should not have matched (defense in depth)', async () => {
    primeDb([{ id: 'r1', drop_number: 'DR1', maintenance_ticket_id: null, payment_eligibility: 'Not Eligible' }]);

    const result = await processEligibilityClosures();

    expect(result).toMatchObject({ candidates: 1, recordsResolved: 0 });
    expect(updateCalls()).toHaveLength(0);
  });

  it('yields to a concurrent manual action: rowCount 0 → no ticket close', async () => {
    primeDb(
      [{ id: 'r1', drop_number: 'DR1', maintenance_ticket_id: 't1', payment_eligibility: 'Eligible' }],
      { updateRowCount: 0 },
    );

    const result = await processEligibilityClosures();

    expect(result).toMatchObject({ candidates: 1, recordsResolved: 0, ticketsClosed: 0 });
    expect(closeLinkedTicket).not.toHaveBeenCalled();
  });

  it('counts ticket failures without failing the sweep', async () => {
    primeDb([{ id: 'r1', drop_number: 'DR1', maintenance_ticket_id: 't1', payment_eligibility: 'Eligible' }]);
    closeLinkedTicket.mockResolvedValue('failed');

    const result = await processEligibilityClosures();

    expect(result).toMatchObject({ recordsResolved: 1, ticketsClosed: 0, ticketFailures: 1 });
  });

  it('no candidates → no system-user lookup, no mutations', async () => {
    primeDb([]);

    const result = await processEligibilityClosures();

    expect(result).toMatchObject({ candidates: 0, recordsResolved: 0 });
    expect(getSystemUser).not.toHaveBeenCalled();
  });
});
