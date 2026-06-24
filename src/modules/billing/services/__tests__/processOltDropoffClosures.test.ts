// src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts
import { describe, it, expect } from 'vitest';
import { computeDropOffClosures, type OpenMismatchRecord } from '../processOltDropoffClosures';

const rec = (dropNumber: string, ticket?: Partial<OpenMismatchRecord>): OpenMismatchRecord => ({
  id: `id-${dropNumber}`,
  dropNumber,
  maintenanceTicketId: ticket?.maintenanceTicketId ?? null,
  ticketUid: ticket?.ticketUid ?? null,
  ticketStatus: ticket?.ticketStatus ?? null,
});

describe('computeDropOffClosures', () => {
  it('returns records whose DR was flagged before but is absent this week', () => {
    const prior = new Set(['DR1', 'DR2', 'DR3']);
    const current = new Set(['DR2']); // DR2 still flagged
    const open = [rec('DR1'), rec('DR2'), rec('DR3')];
    const out = computeDropOffClosures(prior, current, open);
    expect(out.map((r) => r.dropNumber).sort()).toEqual(['DR1', 'DR3']);
  });

  it('ignores open records never flagged note2/note4 (not FT-driven)', () => {
    const prior = new Set(['DR1']);
    const current = new Set<string>();
    const open = [rec('DR1'), rec('DR_AUTODETECT_ONLY')];
    expect(computeDropOffClosures(prior, current, open).map((r) => r.dropNumber)).toEqual(['DR1']);
  });

  it('a clean week (empty current) drops off every prior-flagged open record', () => {
    const prior = new Set(['DR1', 'DR2']);
    const out = computeDropOffClosures(prior, new Set(), [rec('DR1'), rec('DR2')]);
    expect(out).toHaveLength(2);
  });

  it('no prior flags → nothing dropped off', () => {
    expect(computeDropOffClosures(new Set(), new Set(['DR1']), [rec('DR1')])).toEqual([]);
  });
});

import { vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ default: { query: (...a: unknown[]) => query(...a) } }));

const updateTicket = vi.fn();
vi.mock('@/modules/noc/services/ticketService', () => ({ updateTicket: (...a: unknown[]) => updateTicket(...a) }));

const applyTicketResolvedSideEffects = vi.fn();
vi.mock('@/modules/noc/services/ticketResolutionService', () => ({
  applyTicketResolvedSideEffects: (...a: unknown[]) => applyTicketResolvedSideEffects(...a),
}));

const logNonInvoiceableResolved = vi.fn();
const logTicketAutoClosed = vi.fn();
vi.mock('@/modules/activate/services/activity-log/eventLoggers', () => ({
  logNonInvoiceableResolved: (...a: unknown[]) => logNonInvoiceableResolved(...a),
  logTicketAutoClosed: (...a: unknown[]) => logTicketAutoClosed(...a),
}));

// Import AFTER mocks are registered.
const { processOltDropoffClosures } = await import('../processOltDropoffClosures');

beforeEach(() => {
  query.mockReset();
  updateTicket.mockReset();
  applyTicketResolvedSideEffects.mockReset();
  logNonInvoiceableResolved.mockReset();
  logTicketAutoClosed.mockReset();
});

describe('processOltDropoffClosures — guards', () => {
  it('is a no-op when notesPresent is false', async () => {
    const out = await processOltDropoffClosures({
      project: 'Lawley', weekEnding: '2026-06-21',
      currentNote2or4Drs: new Set(), notesPresent: false, dryRun: false,
    });
    expect(out.evaluated).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('processOltDropoffClosures — dryRun', () => {
  it('returns candidates and mutates nothing', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ dr_number: 'DR1', deduction_note: 'note4' }] }) // prior
      .mockResolvedValueOnce({ rows: [{ id: 'rec1', drop_number: 'DR1', maintenance_ticket_id: null, ticket_uid: null, ticket_status: null }] }); // open
    const out = await processOltDropoffClosures({
      project: 'Lawley', weekEnding: '2026-06-21',
      currentNote2or4Drs: new Set(), notesPresent: true, dryRun: true,
    });
    expect(out.candidates.map((c) => c.dropNumber)).toEqual(['DR1']);
    expect(updateTicket).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2); // prior + open only, no UPDATE
  });
});

describe('processOltDropoffClosures — import', () => {
  it('closes the ticket via cascade for a ticketed record', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ dr_number: 'DR1', deduction_note: 'note4' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rec1', drop_number: 'DR1', maintenance_ticket_id: 'tk1', ticket_uid: 'NOC-1', ticket_status: 'open' }] })
      .mockResolvedValue({ rows: [], rowCount: 1 }); // any follow-up UPDATE
    updateTicket.mockResolvedValue({ id: 'tk1', ticket_uid: 'NOC-1', status: 'resolved', dr_number: 'DR1' });

    const out = await processOltDropoffClosures({
      project: 'Lawley', weekEnding: '2026-06-21',
      currentNote2or4Drs: new Set(), notesPresent: true, dryRun: false,
    });

    expect(updateTicket).toHaveBeenCalledWith('tk1', expect.objectContaining({ status: 'resolved' }));
    expect(applyTicketResolvedSideEffects).toHaveBeenCalledTimes(1);
    expect(logTicketAutoClosed).toHaveBeenCalledTimes(1);
    expect(logNonInvoiceableResolved).toHaveBeenCalledWith('DR1', expect.objectContaining({ noteCode: 'note4' }), expect.any(String));
    expect(out.closedTickets).toBe(1);
  });

  it('resolves an unticketed record directly', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ dr_number: 'DR9', deduction_note: 'note2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rec9', drop_number: 'DR9', maintenance_ticket_id: null, ticket_uid: null, ticket_status: null }] })
      .mockResolvedValue({ rows: [], rowCount: 1 }); // the direct UPDATE
    const out = await processOltDropoffClosures({
      project: 'Lawley', weekEnding: '2026-06-21',
      currentNote2or4Drs: new Set(), notesPresent: true, dryRun: false,
    });
    expect(updateTicket).not.toHaveBeenCalled();
    expect(out.resolvedRecords).toBe(1);
    // Third query is the resolving UPDATE on olt_mismatch_records.
    const updateCall = query.mock.calls[2]?.[0] as string;
    expect(updateCall).toMatch(/UPDATE olt_mismatch_records/i);
    expect(updateCall).toMatch(/fix_status\s*=\s*'resolved'/i);
  });
});
