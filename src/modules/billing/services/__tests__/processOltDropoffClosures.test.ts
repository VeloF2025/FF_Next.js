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
