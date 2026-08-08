import { beforeEach, describe, expect, it, vi } from 'vitest';

const readZoneAggregate = vi.fn();
const readTransactionTime = vi.fn();
const lockZone = vi.fn();
const declareHandover = vi.fn();
const appendActivity = vi.fn();
const recalculateZone = vi.fn();
const clientQuery = vi.fn();
const insertZone = vi.fn();

vi.mock('../../repositories/zoneDeliveryReadRepository', () => ({
  readZoneAggregate: (...a: unknown[]) => readZoneAggregate(...a),
  readTransactionTime: (...a: unknown[]) => readTransactionTime(...a),
}));
vi.mock('../../repositories/zoneDeliveryWriteRepository', () => ({
  lockZone: (...a: unknown[]) => lockZone(...a),
  insertZone: (...a: unknown[]) => insertZone(...a),
  declareHandover: (...a: unknown[]) => declareHandover(...a),
  appendActivity: (...a: unknown[]) => appendActivity(...a),
}));
vi.mock('../zoneDeliveryHandover', () => ({
  buildSnapshot: () => ({ snapshot: true }),
  recalculateZone: (...a: unknown[]) => recalculateZone(...a),
}));
vi.mock('../zoneDeliveryCanonical', () => ({ assertCanonicalZone: async () => undefined }));
vi.mock('../zoneDeliveryTransactions', () => ({
  transaction: async (_pool: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: (...a: unknown[]) => clientQuery(...a) }),
}));

import type { DeclareHandoverInput, DeliveryActor } from '../../types/zoneDelivery.types';
import { declareZoneHandoverCommand } from '../zoneDeliveryHandoverCommand';

const NOW = new Date('2026-08-08T06:00:00.000Z');

const actor = (): DeliveryActor => ({
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'johan@velocityfibre.co.za',
  permission: 'construction-qa.zone-delivery.zone-qa-approve',
});

const input = (over: Partial<DeclareHandoverInput> = {}): DeclareHandoverInput => ({
  projectId: '33333333-3333-4333-8333-333333333333',
  zoneNo: 17,
  expectedRowVersion: 4,
  effectiveAt: '2026-08-08T05:59:00.000Z',
  source: 'works-qa',
  ...over,
} as DeclareHandoverInput);

const doc = (documentType: 'fac' | 'cac', over: Record<string, unknown> = {}) => ({
  document_type: documentType, pon_stage_id: null, superseded_at: null, ...over,
});

const run = (i = input()) => declareZoneHandoverCommand({} as never, i, actor());

beforeEach(() => {
  vi.clearAllMocks();
  readTransactionTime.mockResolvedValue(NOW);
  lockZone.mockResolvedValue({ id: 'zone-1', row_version: 4, handed_over_at: null });
  // Johan supplies both documents every time — that upload IS the handover.
  readZoneAggregate.mockResolvedValue({
    pons: [], snagLinks: [], documents: [doc('fac'), doc('cac')],
  });
  declareHandover.mockResolvedValue({ id: 'zone-1', handed_over_at: '2026-08-08T05:59:00.000Z' });
  recalculateZone.mockResolvedValue({ ok: true });
  clientQuery.mockResolvedValue({ rows: [] });
  insertZone.mockResolvedValue({ id: 'zone-1', row_version: 1, handed_over_at: null });
});

describe('declareZoneHandoverCommand', () => {
  it('writes the operator-chosen date, not the transaction time', async () => {
    await run(input({ effectiveAt: '2026-05-08T00:00:00.000Z', reason: 'FAC signed 8 May' }));

    expect(declareHandover).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), { snapshot: true }, '2026-05-08T00:00:00.000Z', 4,
    );
  });

  it('records a legacy zone that never completed its gates in FibreFlow', async () => {
    // No PONs, no zone QA, no milestones — the zone was delivered before
    // FibreFlow tracked the site. It must still be recordable.
    readZoneAggregate.mockResolvedValue({
      pons: [], snagLinks: [], documents: [doc('fac'), doc('cac')],
    });

    await run(input({ effectiveAt: '2026-05-08T00:00:00.000Z', reason: 'Lawley 17, legacy' }));

    expect(declareHandover).toHaveBeenCalled();
  });

  it('requires a reason to back-date', async () => {
    await expect(run(input({ effectiveAt: '2026-05-08T00:00:00.000Z' })))
      .rejects.toThrow(/reason is required/i);
    expect(declareHandover).not.toHaveBeenCalled();
  });

  it.each([
    ['FAC', [doc('cac')]],
    ['CAC', [doc('fac')]],
    ['FAC and CAC', []],
  ])('refuses without an active %s', async (_label, documents) => {
    readZoneAggregate.mockResolvedValue({ pons: [], snagLinks: [], documents });

    await expect(run()).rejects.toThrow(/requires an active/i);
    expect(declareHandover).not.toHaveBeenCalled();
  });

  it('ignores a superseded FAC when checking for one', async () => {
    readZoneAggregate.mockResolvedValue({
      pons: [],
      snagLinks: [],
      documents: [doc('fac', { superseded_at: '2026-07-01T00:00:00.000Z' }), doc('cac')],
    });

    await expect(run()).rejects.toThrow(/requires an active FAC/i);
  });

  it('ignores a PON-scoped document when checking for the zone-level one', async () => {
    readZoneAggregate.mockResolvedValue({
      pons: [],
      snagLinks: [],
      documents: [doc('fac', { pon_stage_id: 'pon-1' }), doc('cac')],
    });

    await expect(run()).rejects.toThrow(/requires an active FAC/i);
  });

  it('corrects an existing handover date, and records it as a correction', async () => {
    lockZone.mockResolvedValue({
      id: 'zone-1', row_version: 4, handed_over_at: '2026-08-01T00:00:00.000Z',
    });

    await run(input({ reason: 'FAC date was captured wrong' }));

    expect(declareHandover).toHaveBeenCalled();
    const activity = appendActivity.mock.calls[0]![1] as Record<string, never>;
    expect(activity.previousValue).toEqual({ handedOverAt: '2026-08-01T00:00:00.000Z' });
    expect(activity.newValue).toMatchObject({ declared: true, corrected: true });
    // Migration 470 keeps handed_over_at immutable in the database; 485 narrows
    // that to "unless this GUC is set". Without the opt-in the UPDATE raises.
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('ff.zone_handover_correction'),
    );
  });

  it('does NOT opt into the correction gate on a first declare', async () => {
    // OLD.handed_over_at is NULL, so the trigger never fires — widening the
    // window would relax the invariant for a write that does not need it.
    await run(input({ effectiveAt: '2026-05-08T00:00:00.000Z', reason: 'legacy' }));

    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('ff.zone_handover_correction'),
    );
  });

  it('requires a reason to correct, even when the new date is today', async () => {
    lockZone.mockResolvedValue({
      id: 'zone-1', row_version: 4, handed_over_at: '2026-08-01T00:00:00.000Z',
    });

    await expect(run()).rejects.toThrow(/reason is required/i);
  });

  it('creates the delivery-state row when the zone has none', async () => {
    // A zone delivered before FibreFlow tracked the site has no state row at
    // all; getZone reports rowVersion 0 for it, so 0 means "no record yet".
    lockZone.mockResolvedValue(null);

    await run(input({ expectedRowVersion: 0, effectiveAt: '2026-05-08T00:00:00.000Z', reason: 'legacy' }));

    expect(insertZone).toHaveBeenCalled();
    // CAS must use the created row's real version, not the caller's 0.
    expect(declareHandover).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), { snapshot: true }, '2026-05-08T00:00:00.000Z', 1,
    );
  });

  it('does not create a row when the caller expected one to exist', async () => {
    lockZone.mockResolvedValue(null);

    await expect(run(input({ expectedRowVersion: 3 }))).rejects.toThrow(/reload and retry/i);
    expect(insertZone).not.toHaveBeenCalled();
  });

  it('conflicts when a concurrent transaction won the insert', async () => {
    lockZone.mockResolvedValue(null);
    insertZone.mockResolvedValue(null);

    await expect(run(input({ expectedRowVersion: 0 }))).rejects.toThrow(/reload and retry/i);
    expect(declareHandover).not.toHaveBeenCalled();
  });

  it('conflicts when the row version moved', async () => {
    lockZone.mockResolvedValue({ id: 'zone-1', row_version: 9, handed_over_at: null });
    await expect(run()).rejects.toThrow(/reload and retry/i);
    expect(declareHandover).not.toHaveBeenCalled();
  });
});
