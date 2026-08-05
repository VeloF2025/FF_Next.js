import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildWaNoOesTitle,
  buildWaNoOesDescription,
  buildWaNoOesPayload,
  partitionForCreation,
  clampSinceDays,
  fetchCandidates,
  runWaNoOesTickets,
  autoResolveWaNoOesTickets,
  type WaNoOesCandidate,
  type QueryableDb,
} from '../waNoOesTicketService';
import { TicketSource, TicketType, TicketStatus } from '@/modules/noc/types/ticket';
import { logTicketActivity } from '@/modules/noc/services/ticketService';

// Mock the noc ticket service so autoResolve's logTicketActivity fan-out never
// hits a real DB, and the default createTicket import is inert (tests inject it).
vi.mock('@/modules/noc/services/ticketService', () => ({
  createTicket: vi.fn(),
  logTicketActivity: vi.fn(async () => {}),
}));

// runWaNoOesTickets calls lookupOesGps per candidate. Without an explicit mock
// it resolves through the global @/lib/db auto-mock, whose `pool.query` is a
// bare vi.fn() returning undefined — reading `.rows` off that throws, the
// service's own catch swallows it, and the result is always null. Every test
// below would then exercise only the no-GPS path while appearing to cover the
// feature. Mock it deliberately so both paths are reachable and asserted.
const { oesGpsMock } = vi.hoisted(() => ({ oesGpsMock: vi.fn() }));
vi.mock('@/modules/noc/services/ticketGpsService', () => ({
  lookupOesGps: (...a: unknown[]) => oesGpsMock(...a),
}));

beforeEach(() => {
  vi.mocked(logTicketActivity).mockClear();
  oesGpsMock.mockReset();
  oesGpsMock.mockResolvedValue(null); // default: no OES row, the usual wa_no_oes case
});

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

/** Fake pg.Pool routed by SQL target: ledger-LATERAL → candidates; the dedup
 *  `FROM maintenance_tickets` SELECT → open DRs. The auto-resolve UPDATE matches
 *  neither (it is `UPDATE maintenance_tickets`), so it falls through to []. */
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

  it('omits the WA-submitted line when wa_submitted_at is null', () => {
    const d = buildWaNoOesDescription(candidate({ wa_submitted_at: null }));
    expect(d).not.toContain('WA submitted:');
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

  // These tickets shipped with no location at all — createTicket could not carry
  // one. The GPS branch below is the fix, and none of it was reachable from a
  // test until now: every call above passes a single argument.
  describe('GPS', () => {
    const designCandidate = candidate({ design_lat: '-26.9', design_lng: '27.9' });

    it('carries no coordinate when neither source has one', () => {
      expect(buildWaNoOesPayload(candidate()).gps_coordinates).toBeUndefined();
    });

    it('uses the design position when that is all there is', () => {
      // wa_no_oes means "no OES activation row for this DR" by definition, so
      // this is the normal case — coverage, not accuracy.
      expect(buildWaNoOesPayload(designCandidate).gps_coordinates).toEqual({
        latitude: -26.9,
        longitude: 27.9,
      });
    });

    it('prefers an OES coordinate over the design position', () => {
      expect(
        buildWaNoOesPayload(designCandidate, { latitude: -26.5, longitude: 27.5 })
          .gps_coordinates
      ).toEqual({ latitude: -26.5, longitude: 27.5 });
    });

    it('accepts an OES coordinate when there is no design position', () => {
      expect(
        buildWaNoOesPayload(candidate(), { latitude: -26.5, longitude: 27.5 }).gps_coordinates
      ).toEqual({ latitude: -26.5, longitude: 27.5 });
    });

    it('drops a non-finite pair rather than writing NaN into the column', () => {
      expect(
        buildWaNoOesPayload(candidate({ design_lat: 'not-a-number', design_lng: '27.9' }))
          .gps_coordinates
      ).toBeUndefined();
    });

    it('ignores a half pair — a lone axis is not a location', () => {
      expect(
        buildWaNoOesPayload(candidate({ design_lat: '-26.9', design_lng: null })).gps_coordinates
      ).toBeUndefined();
      expect(
        buildWaNoOesPayload(candidate({ design_lat: null, design_lng: '27.9' })).gps_coordinates
      ).toBeUndefined();
    });
  });
});

describe('clampSinceDays', () => {
  it('passes null/undefined through as null', () => {
    expect(clampSinceDays(null)).toBeNull();
    expect(clampSinceDays(undefined)).toBeNull();
  });
  it('floors a negative window to 0', () => {
    expect(clampSinceDays(-30)).toBe(0);
  });
  it('truncates a fractional window', () => {
    expect(clampSinceDays(30.9)).toBe(30);
  });
});

describe('partitionForCreation', () => {
  it('skips DRs that already have an open ticket', () => {
    const cands = [candidate({ drop_number: 'A' }), candidate({ drop_number: 'B' })];
    const { toCreate, skippedExisting } = partitionForCreation(cands, new Set(['A']));
    expect(skippedExisting).toBe(1);
    expect(toCreate.map((c) => c.drop_number)).toEqual(['B']);
  });

  it('creates all when none are open (fresh run)', () => {
    const cands = [candidate({ drop_number: 'A' }), candidate({ drop_number: 'B' })];
    const { toCreate, skippedExisting } = partitionForCreation(cands, new Set());
    expect(skippedExisting).toBe(0);
    expect(toCreate).toHaveLength(2);
  });

  it('creates none when all are open (idempotent re-run)', () => {
    const cands = [candidate({ drop_number: 'A' }), candidate({ drop_number: 'B' })];
    const { toCreate, skippedExisting } = partitionForCreation(cands, new Set(['A', 'B']));
    expect(skippedExisting).toBe(2);
    expect(toCreate).toEqual([]);
  });
});

describe('fetchCandidates', () => {
  it('binds [projectName, clampedSinceDays, limit] and defaults the limit', async () => {
    const q = vi.fn(async () => ({ rows: [] }));
    const db = { query: q } as unknown as QueryableDb;
    await fetchCandidates(db, { sinceDays: 30 });
    expect(q).toHaveBeenCalledWith(expect.stringContaining('v_dr_reconciliation_ledger'), [null, 30, 1000]);
  });

  it('clamps a negative sinceDays to 0 in the bound params', async () => {
    const q = vi.fn(async () => ({ rows: [] }));
    const db = { query: q } as unknown as QueryableDb;
    await fetchCandidates(db, { sinceDays: -5, projectName: 'Lawley', limit: 10 });
    expect(q).toHaveBeenCalledWith(expect.any(String), ['Lawley', 0, 10]);
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

describe('autoResolveWaNoOesTickets', () => {
  it('returns 0 and logs nothing when no tickets resolve', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) } as unknown as QueryableDb;
    const n = await autoResolveWaNoOesTickets(db);
    expect(n).toBe(0);
    expect(logTicketActivity).not.toHaveBeenCalled();
  });

  it('resolves rows and logs a status_change per ticket', async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [
          { id: 'u1', dr_number: 'DR1' },
          { id: 'u2', dr_number: 'DR2' },
        ],
      })),
    } as unknown as QueryableDb;
    const n = await autoResolveWaNoOesTickets(db);
    expect(n).toBe(2);
    expect(logTicketActivity).toHaveBeenCalledTimes(2);
    expect(logTicketActivity).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: 'status_change' }),
    );
  });
});

describe('runWaNoOesTickets — GPS on created tickets', () => {
  it('looks the coordinate up by DR and by serial', async () => {
    await runWaNoOesTickets({
      db: makeDb([candidate({ drop_number: 'A', wa_serial: 'SN-A' })], []),
      createTicketFn: vi.fn() as never,
    });
    expect(oesGpsMock).toHaveBeenCalledWith('A', 'SN-A');
  });

  it('puts the OES coordinate on the ticket when one exists', async () => {
    // The serial fallback inside lookupOesGps is what finds this: a wa_no_oes DR
    // has no OES row by definition, but its ONT may have activated elsewhere.
    oesGpsMock.mockResolvedValue({ latitude: -26.5, longitude: 27.5 });
    const create = vi.fn();

    await runWaNoOesTickets({
      db: makeDb([candidate({ drop_number: 'A' })], []),
      createTicketFn: create as never,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]?.gps_coordinates).toEqual({
      latitude: -26.5,
      longitude: 27.5,
    });
  });

  it('falls back to the design position when the OES report has nothing', async () => {
    const create = vi.fn();
    await runWaNoOesTickets({
      db: makeDb([candidate({ drop_number: 'A', design_lat: '-26.9', design_lng: '27.9' })], []),
      createTicketFn: create as never,
    });
    expect(create.mock.calls[0]?.[0]?.gps_coordinates).toEqual({
      latitude: -26.9,
      longitude: 27.9,
    });
  });

  it('creates the ticket with no coordinate rather than failing when neither source has one', async () => {
    const create = vi.fn();
    await runWaNoOesTickets({
      db: makeDb([candidate({ drop_number: 'A' })], []),
      createTicketFn: create as never,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]?.gps_coordinates).toBeUndefined();
  });
});
