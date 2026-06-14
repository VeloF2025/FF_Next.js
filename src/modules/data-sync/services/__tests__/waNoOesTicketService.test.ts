import { describe, it, expect, vi } from 'vitest';
import {
  buildWaNoOesTitle,
  buildWaNoOesDescription,
  buildWaNoOesPayload,
  partitionForCreation,
  runWaNoOesTickets,
  type WaNoOesCandidate,
  type QueryableDb,
} from '../waNoOesTicketService';
import { TicketSource, TicketType, TicketStatus } from '@/modules/noc/types/ticket';

function candidate(over: Partial<WaNoOesCandidate> = {}): WaNoOesCandidate {
  return {
    drop_number: 'DR1733092',
    project: 'Mohadin',
    project_id: 'bf9a90db-e758-4c05-b999-694cd63c451f',
    activations_team_id: '48507948-48ba-4d95-9768-e2b40a6d13bb',
    wa_submitted_at: '2026-05-01T08:30:00.000Z',
    wa_serial: 'ALCLB48E394B',
    wa_serial_source: 'typed',
    ...over,
  };
}

/** Fake pg.Pool: routes by SQL target table. */
function makeDb(candidates: WaNoOesCandidate[], openDrs: string[]): QueryableDb {
  return {
    query: vi.fn(async (text: string) => {
      if (text.includes('v_dr_reconciliation_ledger') && text.includes('LATERAL')) {
        return { rows: candidates };
      }
      if (text.includes('FROM maintenance_tickets')) {
        return { rows: openDrs.map((dr_number) => ({ dr_number })) };
      }
      return { rows: [] };
    }),
  } as unknown as QueryableDb;
}

describe('buildWaNoOesTitle', () => {
  it('formats the title with drop + project', () => {
    expect(buildWaNoOesTitle('DR123', 'Lawley')).toBe('WA install not activated — DR123 (Lawley)');
  });
});

describe('buildWaNoOesDescription', () => {
  it('includes the WA-submitted date (YYYY-MM-DD) and serial provenance', () => {
    const d = buildWaNoOesDescription(candidate());
    expect(d).toContain('Drop DR1733092 (project: Mohadin)');
    expect(d).toContain('WA submitted: 2026-05-01');
    expect(d).toContain('WA serial (typed source): ALCLB48E394B');
    expect(d).toContain('recon_class = wa_no_oes');
  });

  it('omits the serial line when no WA serial exists', () => {
    const d = buildWaNoOesDescription(candidate({ wa_serial: null, wa_serial_source: null }));
    expect(d).not.toContain('WA serial');
  });
});

describe('buildWaNoOesPayload', () => {
  it('maps to an assigned activations ticket when a team resolves', () => {
    const p = buildWaNoOesPayload(candidate());
    expect(p.source).toBe(TicketSource.WA_NO_OES);
    expect(p.source_type).toBe('wa_no_oes');
    expect(p.ticket_type).toBe(TicketType.ACTIVATIONS);
    expect(p.dr_number).toBe('DR1733092');
    expect(p.project_id).toBe('bf9a90db-e758-4c05-b999-694cd63c451f');
    expect(p.assigned_team_id).toBe('48507948-48ba-4d95-9768-e2b40a6d13bb');
    expect(p.status).toBe(TicketStatus.ASSIGNED);
    expect(p.created_by).toBeTruthy();
  });

  it('leaves status undefined (open) when no team resolves', () => {
    const p = buildWaNoOesPayload(candidate({ activations_team_id: null }));
    expect(p.assigned_team_id).toBeUndefined();
    expect(p.status).toBeUndefined();
  });
});

describe('partitionForCreation', () => {
  it('skips DRs that already have an open ticket', () => {
    const cands = [candidate({ drop_number: 'A' }), candidate({ drop_number: 'B' })];
    const { toCreate, skippedExisting } = partitionForCreation(cands, new Set(['A']));
    expect(skippedExisting).toBe(1);
    expect(toCreate.map((c) => c.drop_number)).toEqual(['B']);
  });
});

describe('runWaNoOesTickets', () => {
  it('dry-run previews without creating', async () => {
    const create = vi.fn();
    const res = await runWaNoOesTickets({
      dryRun: true,
      db: makeDb([candidate({ drop_number: 'A' }), candidate({ drop_number: 'B' })], ['A']),
      createTicketFn: create as never,
    });
    expect(create).not.toHaveBeenCalled();
    expect(res.dryRun).toBe(true);
    expect(res.scanned).toBe(2);
    expect(res.skippedExisting).toBe(1);
    expect(res.preview?.map((p) => p.drop_number)).toEqual(['B']);
  });

  it('creates tickets for non-deduped candidates and counts unassigned', async () => {
    const create = vi.fn(async () => ({}) as never);
    const res = await runWaNoOesTickets({
      db: makeDb(
        [
          candidate({ drop_number: 'A' }),
          candidate({ drop_number: 'B', activations_team_id: null }),
          candidate({ drop_number: 'C' }),
        ],
        ['A'],
      ),
      createTicketFn: create as never,
    });
    expect(create).toHaveBeenCalledTimes(2); // B + C (A deduped)
    expect(res.created).toBe(2);
    expect(res.skippedExisting).toBe(1);
    expect(res.unassigned).toBe(1); // B had no team
  });

  it('treats a 23505 unique violation as a skip, not a failure', async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error('dup'), { code: '23505' });
    });
    const res = await runWaNoOesTickets({
      db: makeDb([candidate({ drop_number: 'A' })], []),
      createTicketFn: create as never,
    });
    expect(res.created).toBe(0);
    expect(res.skippedExisting).toBe(1);
  });

  it('rethrows non-unique-violation errors', async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { code: '42P01' });
    });
    await expect(
      runWaNoOesTickets({
        db: makeDb([candidate({ drop_number: 'A' })], []),
        createTicketFn: create as never,
      }),
    ).rejects.toThrow('boom');
  });
});
