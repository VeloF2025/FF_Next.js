/**
 * Tests for the daily OLT match reconciliation sweep.
 *
 * Part 1 — the pure confirmation predicate (no mocks). Locks the deliberate
 * difference from `classifyOltRecords`: a stale wrong serial on another prop
 * must NOT block resolution once an installed prop carries the OES serial.
 *
 * Part 2 — the orchestration (`reconcileConfirmedMatches`) with the DB, 1Map
 * API and NOC ticket services mocked: guarded UPDATE, ticket-close outcomes,
 * cap accounting, and the consecutive-failure abort.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OneMapRecord } from '@/modules/system/services/oneMapApiService';
import { INSTALLED_STATUS } from '../oltMismatchClassifier';

const { poolQuery, searchDR, getTicketById, updateTicket, logTicketChanges, applySideEffects } =
  vi.hoisted(() => ({
    poolQuery: vi.fn(),
    searchDR: vi.fn(),
    getTicketById: vi.fn(),
    updateTicket: vi.fn(),
    logTicketChanges: vi.fn(),
    applySideEffects: vi.fn(),
  }));
vi.mock('@/lib/db', () => ({ default: { query: poolQuery } }));
vi.mock('@/modules/system/services/oneMapApiService', () => ({ oneMapApi: { searchDR } }));
vi.mock('@/modules/noc/services/ticketService', () => ({
  getTicketById,
  updateTicket,
  logTicketChanges,
}));
vi.mock('@/modules/noc/services/ticketResolutionService', () => ({
  applyTicketResolvedSideEffects: applySideEffects,
}));
vi.mock('@/modules/noc/types/ticket', () => ({ TicketStatus: { RESOLVED: 'resolved' } }));

import {
  hasConfirmedInstalledMatch,
  reconcileConfirmedMatches,
} from '../oltMatchReconciliationService';

const rec = (over: Partial<OneMapRecord> = {}): OneMapRecord =>
  ({ prop_id: 'p1', drp: 'DR1', ph_ont: null, br_ser: null, status: null, ...over });

describe('hasConfirmedInstalledMatch', () => {
  it('true when the OES serial sits on an installed prop', () => {
    const records = [rec({ ph_ont: 'ALCLB48E205C', status: INSTALLED_STATUS })];
    expect(hasConfirmedInstalledMatch(records, 'ALCLB48E205C')).toBe(true);
  });

  it('normalises case and whitespace on both sides', () => {
    const records = [rec({ ph_ont: '  alclb48e205c ', status: INSTALLED_STATUS })];
    expect(hasConfirmedInstalledMatch(records, ' Alclb48E205c ')).toBe(true);
  });

  it('false when the serial matches but no prop is installed yet', () => {
    const records = [
      rec({ ph_ont: 'ALCLB48E205C', status: 'Home Sign Ups: Approved & Installation Scheduled' }),
    ];
    expect(hasConfirmedInstalledMatch(records, 'ALCLB48E205C')).toBe(false);
  });

  it('false when only a different serial is installed', () => {
    const records = [rec({ ph_ont: 'ALCLB4900000', status: INSTALLED_STATUS })];
    expect(hasConfirmedInstalledMatch(records, 'ALCLB48E205C')).toBe(false);
  });

  it('false when the correct serial is on one prop but installed status is on another', () => {
    const records = [
      rec({ ph_ont: 'ALCLB48E205C', status: 'Home Installation: In Progress' }),
      rec({ prop_id: 'p2', ph_ont: 'ALCLB4900000', status: INSTALLED_STATUS }),
    ];
    expect(hasConfirmedInstalledMatch(records, 'ALCLB48E205C')).toBe(false);
  });

  it('true even when another prop still carries a stale wrong serial', () => {
    const records = [
      rec({ ph_ont: 'ALCLB4900000', status: 'Home Sign Ups: Approved' }),
      rec({ prop_id: 'p2', ph_ont: 'ALCLB48E205C', status: INSTALLED_STATUS }),
    ];
    expect(hasConfirmedInstalledMatch(records, 'ALCLB48E205C')).toBe(true);
  });

  it('false on empty records or empty serial', () => {
    expect(hasConfirmedInstalledMatch([], 'ALCLB48E205C')).toBe(false);
    expect(
      hasConfirmedInstalledMatch([rec({ ph_ont: 'X', status: INSTALLED_STATUS })], '  '),
    ).toBe(false);
  });
});

interface Candidate {
  id: string;
  drop_number: string;
  olt_serial: string | null;
  maintenance_ticket_id: string | null;
  oes_serial: string | null;
}

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: 'r1',
  drop_number: 'DR100',
  olt_serial: 'ALCLB4AAA111',
  maintenance_ticket_id: null,
  oes_serial: 'ALCLB4AAA111',
  ...over,
});

/** Route the three query shapes the service issues; UPDATE rowCount is scriptable. */
function primeDb(candidates: Candidate[], { updateRowCount = 1 } = {}) {
  poolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM olt_mismatch_records')) return { rows: candidates, rowCount: candidates.length };
    if (sql.includes('FROM users')) return { rows: [{ id: 'sys-1', email: 'system@fibreflow.app' }], rowCount: 1 };
    if (sql.includes('UPDATE olt_mismatch_records')) return { rows: [], rowCount: updateRowCount };
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  });
}

const updateCalls = () =>
  poolQuery.mock.calls.filter((c) => String(c[0]).includes('UPDATE olt_mismatch_records'));

describe('reconcileConfirmedMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a confirmed match and closes the linked ticket via the cascade', async () => {
    primeDb([cand({ maintenance_ticket_id: 't1' })]);
    searchDR.mockResolvedValue({
      success: true,
      records: [rec({ ph_ont: 'ALCLB4AAA111', status: INSTALLED_STATUS })],
    });
    getTicketById.mockResolvedValue({ id: 't1', status: 'open' });
    updateTicket.mockResolvedValue({ id: 't1', status: 'resolved' });

    const result = await reconcileConfirmedMatches();

    expect(result).toMatchObject({
      candidates: 1, scanned: 1, confirmed: 1, recordsResolved: 1, ticketsClosed: 1,
      apiErrors: 0, capped: 0, abortedEarly: false,
    });
    const upd = updateCalls();
    expect(upd).toHaveLength(1);
    expect(upd[0]![1][0]).toContain('DR100'); // note names the drop
    expect(upd[0]![1][1]).toBe('sys-1'); // resolved_by = live system user
    expect(applySideEffects).toHaveBeenCalledOnce();
    expect(logTicketChanges).toHaveBeenCalledOnce();
  });

  it('never mutates on a wrong serial or an absent DR', async () => {
    primeDb([cand({ id: 'r1' }), cand({ id: 'r2', drop_number: 'DR200' })]);
    searchDR
      .mockResolvedValueOnce({ success: true, records: [rec({ ph_ont: 'WRONG', status: INSTALLED_STATUS })] })
      .mockResolvedValueOnce({ success: true, records: [] });

    const result = await reconcileConfirmedMatches();

    expect(result).toMatchObject({ scanned: 2, confirmed: 0, recordsResolved: 0 });
    expect(updateCalls()).toHaveLength(0);
  });

  it('skips rows with no OES serial without calling 1Map', async () => {
    primeDb([cand({ olt_serial: null, oes_serial: null })]);

    const result = await reconcileConfirmedMatches();

    expect(result.skippedNoSerial).toBe(1);
    expect(searchDR).not.toHaveBeenCalled();
  });

  it('does not count an already-terminal ticket as closed', async () => {
    primeDb([cand({ maintenance_ticket_id: 't1' })]);
    searchDR.mockResolvedValue({
      success: true,
      records: [rec({ ph_ont: 'ALCLB4AAA111', status: INSTALLED_STATUS })],
    });
    getTicketById.mockResolvedValue({ id: 't1', status: 'resolved' });

    const result = await reconcileConfirmedMatches();

    expect(result).toMatchObject({ recordsResolved: 1, ticketsClosed: 0 });
    expect(updateTicket).not.toHaveBeenCalled();
  });

  it('yields to a concurrent manual action: rowCount 0 → no ticket close', async () => {
    primeDb([cand({ maintenance_ticket_id: 't1' })], { updateRowCount: 0 });
    searchDR.mockResolvedValue({
      success: true,
      records: [rec({ ph_ont: 'ALCLB4AAA111', status: INSTALLED_STATUS })],
    });

    const result = await reconcileConfirmedMatches();

    expect(result).toMatchObject({ confirmed: 1, recordsResolved: 0, ticketsClosed: 0 });
    expect(getTicketById).not.toHaveBeenCalled();
  });

  it('aborts after 5 consecutive API failures and reports the cap', async () => {
    const many = Array.from({ length: 301 }, (_, i) => cand({ id: `r${i}`, drop_number: `DR${i}` }));
    primeDb(many);
    searchDR.mockResolvedValue({ success: false, records: [], error: 'rate limited' });

    const result = await reconcileConfirmedMatches();

    expect(searchDR).toHaveBeenCalledTimes(5);
    expect(result).toMatchObject({
      candidates: 301, capped: 1, apiErrors: 5, abortedEarly: true, scanned: 0, recordsResolved: 0,
    });
    expect(updateCalls()).toHaveLength(0);
  });
});
