/**
 * Tests for applyTicketResolvedSideEffects — the shared resolve cascade used by
 * both the NOC ticket PUT route and the OLT investigate resolve endpoint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/db', () => ({
  query: vi.fn(async () => []),
}));
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock('../../services/ticketService', () => ({
  logTicketActivity: vi.fn(async () => {}),
}));
vi.mock('../../services/notificationTriggers', () => ({
  triggerOnTicketResolution: vi.fn(async () => ({ success: true })),
}));
vi.mock('../../services/dataSyncResolution', () => ({
  markLinkedDataSyncResolved: vi.fn(async () => {}),
}));
vi.mock('../../services/drHistoryService', () => ({
  summarizeAndAttachDrHistory: vi.fn(async () => {}),
}));

import { applyTicketResolvedSideEffects } from '../../services/ticketResolutionService';
import { query } from '../../utils/db';
import { logTicketActivity } from '../../services/ticketService';
import { triggerOnTicketResolution } from '../../services/notificationTriggers';
import { markLinkedDataSyncResolved } from '../../services/dataSyncResolution';
import { summarizeAndAttachDrHistory } from '../../services/drHistoryService';

type AnyTicket = Parameters<typeof applyTicketResolvedSideEffects>[0];

function makeTicket(overrides: Partial<Record<string, unknown>> = {}): AnyTicket {
  return {
    id: 'ticket-123',
    ticket_uid: 'VF-20260524-004',
    dr_number: 'DR1745123',
    ont_serial: 'ALCLB48E205C',
    source: 'olt_mismatch',
    status: 'resolved',
    ...overrides,
  } as unknown as AnyTicket;
}

const insertCalls = () =>
  vi.mocked(query).mock.calls.filter(c => /INSERT INTO maintenance_notes/i.test(String(c[0])));
const snagCalls = () =>
  vi.mocked(query).mock.calls.filter(c => /UPDATE snags/i.test(String(c[0])));
const aiDeleteCalls = () =>
  vi.mocked(query).mock.calls.filter(c => /DELETE FROM maintenance_activities/i.test(String(c[0])));

describe('applyTicketResolvedSideEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FF_AI_TICKET_SUMMARY;
  });

  it('always resolves linked Data Sync records and notifies the creator', async () => {
    await applyTicketResolvedSideEffects(makeTicket());
    expect(markLinkedDataSyncResolved).toHaveBeenCalledWith('ticket-123');
    expect(triggerOnTicketResolution).toHaveBeenCalledTimes(1);
  });

  it('adds a public resolution note + note activity when a note is supplied', async () => {
    await applyTicketResolvedSideEffects(makeTicket(), {
      actingUser: { id: 'user-1', name: 'Hein', email: 'hein@x.co' },
      note: 'Resolved from OLT investigation as "Manually Fixed in 1Map".',
      noteVisibility: 'public',
    });

    const notes = insertCalls();
    expect(notes).toHaveLength(1);
    // params: [ticket_id, content, visibility, created_by]
    expect(notes[0]![1]).toEqual([
      'ticket-123',
      'Resolved from OLT investigation as "Manually Fixed in 1Map".',
      'public',
      'user-1',
    ]);
    expect(logTicketActivity).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 'ticket-123', activityType: 'note' }),
    );
  });

  it('adds NO note when none is supplied', async () => {
    await applyTicketResolvedSideEffects(makeTicket());
    expect(insertCalls()).toHaveLength(0);
    expect(logTicketActivity).not.toHaveBeenCalled();
  });

  it('back-syncs snags only when the ticket source is snags', async () => {
    await applyTicketResolvedSideEffects(makeTicket({ source: 'snags' }));
    expect(snagCalls()).toHaveLength(1);

    vi.clearAllMocks();
    await applyTicketResolvedSideEffects(makeTicket({ source: 'olt_mismatch' }));
    expect(snagCalls()).toHaveLength(0);
  });

  it('regenerates the AI summary only when FF_AI_TICKET_SUMMARY=1 and a DR is present', async () => {
    process.env.FF_AI_TICKET_SUMMARY = '1';
    await applyTicketResolvedSideEffects(makeTicket());
    await vi.waitFor(() => {
      expect(aiDeleteCalls()).toHaveLength(1);
      expect(summarizeAndAttachDrHistory).toHaveBeenCalledWith('ticket-123', 'DR1745123', 'ALCLB48E205C');
    });
  });

  it('skips AI summary when the flag is off', async () => {
    await applyTicketResolvedSideEffects(makeTicket());
    await new Promise(r => setTimeout(r, 10));
    expect(aiDeleteCalls()).toHaveLength(0);
    expect(summarizeAndAttachDrHistory).not.toHaveBeenCalled();
  });

  it('skips AI summary when the ticket has no DR number', async () => {
    process.env.FF_AI_TICKET_SUMMARY = '1';
    await applyTicketResolvedSideEffects(makeTicket({ dr_number: null }));
    await new Promise(r => setTimeout(r, 10));
    expect(summarizeAndAttachDrHistory).not.toHaveBeenCalled();
  });

  it('on a re-resolve (isTransition=false) still resolves data-sync + snag, but skips notify + AI', async () => {
    process.env.FF_AI_TICKET_SUMMARY = '1';
    await applyTicketResolvedSideEffects(makeTicket({ source: 'snags' }), { isTransition: false });
    await new Promise(r => setTimeout(r, 10));
    // Idempotent data-sync effects still run...
    expect(markLinkedDataSyncResolved).toHaveBeenCalledWith('ticket-123');
    expect(snagCalls()).toHaveLength(1);
    // ...but one-shot effects are suppressed.
    expect(triggerOnTicketResolution).not.toHaveBeenCalled();
    expect(summarizeAndAttachDrHistory).not.toHaveBeenCalled();
    expect(aiDeleteCalls()).toHaveLength(0);
  });
});
