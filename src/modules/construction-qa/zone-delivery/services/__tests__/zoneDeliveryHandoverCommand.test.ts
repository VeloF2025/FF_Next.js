import { beforeEach, describe, expect, it, vi } from 'vitest';

const readZoneAggregate = vi.fn();
const readTransactionTime = vi.fn();
const lockZone = vi.fn();
const declareHandover = vi.fn();
const appendActivity = vi.fn();
const calculateAggregate = vi.fn();
const recalculateZone = vi.fn();

vi.mock('../../repositories/zoneDeliveryReadRepository', () => ({
  readZoneAggregate: (...a: unknown[]) => readZoneAggregate(...a),
  readTransactionTime: (...a: unknown[]) => readTransactionTime(...a),
}));
vi.mock('../../repositories/zoneDeliveryWriteRepository', () => ({
  lockZone: (...a: unknown[]) => lockZone(...a),
  declareHandover: (...a: unknown[]) => declareHandover(...a),
  appendActivity: (...a: unknown[]) => appendActivity(...a),
}));
vi.mock('../zoneDeliveryHandover', () => ({
  buildSnapshot: () => ({ snapshot: true }),
  calculateAggregate: (...a: unknown[]) => calculateAggregate(...a),
  recalculateZone: (...a: unknown[]) => recalculateZone(...a),
}));
vi.mock('../zoneDeliveryCanonical', () => ({ assertCanonicalZone: async () => undefined }));
vi.mock('../zoneDeliveryTransactions', () => ({
  transaction: async (_pool: unknown, fn: (c: unknown) => Promise<unknown>) => fn({}),
}));

import type { DeclareHandoverInput, DeliveryActor } from '../../types/zoneDelivery.types';
import { declareZoneHandoverCommand } from '../zoneDeliveryHandoverCommand';

const NOW = new Date('2026-08-08T06:00:00.000Z');

const actor = (over: Partial<DeliveryActor> = {}): DeliveryActor => ({
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'johan@velocityfibre.co.za',
  permission: 'construction-qa.zone-delivery.zone-qa-approve',
  ...over,
});

const input = (over: Partial<DeclareHandoverInput> = {}): DeclareHandoverInput => ({
  projectId: '33333333-3333-4333-8333-333333333333',
  zoneNo: 17,
  expectedRowVersion: 4,
  effectiveAt: '2026-08-08T05:59:00.000Z',
  source: 'works-qa',
  ...over,
} as DeclareHandoverInput);

const run = (i = input(), a = actor()) =>
  declareZoneHandoverCommand({} as never, i, a);

beforeEach(() => {
  vi.clearAllMocks();
  readTransactionTime.mockResolvedValue(NOW);
  lockZone.mockResolvedValue({ id: 'zone-1', row_version: 4, handed_over_at: null });
  readZoneAggregate.mockResolvedValue({ pons: [], documents: [], snagLinks: [] });
  calculateAggregate.mockReturnValue({ eligibleForHandover: true, blockers: [] });
  declareHandover.mockResolvedValue({ id: 'zone-1', handed_over_at: '2026-08-08T05:59:00.000Z' });
  recalculateZone.mockResolvedValue({ ok: true });
});

describe('declareZoneHandoverCommand', () => {
  it('writes the operator-chosen date, not the transaction time', async () => {
    await run(input({ effectiveAt: '2026-05-08T00:00:00.000Z', reason: 'FAC signed 8 May' }));

    expect(declareHandover).toHaveBeenCalledWith(
      {}, expect.anything(), { snapshot: true }, '2026-05-08T00:00:00.000Z', 4,
    );
  });

  it('requires a reason to back-date', async () => {
    await expect(run(input({ effectiveAt: '2026-05-08T00:00:00.000Z' })))
      .rejects.toThrow(/reason is required/i);
    expect(declareHandover).not.toHaveBeenCalled();
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
  });

  it('requires a reason to correct, even when the new date is today', async () => {
    lockZone.mockResolvedValue({
      id: 'zone-1', row_version: 4, handed_over_at: '2026-08-01T00:00:00.000Z',
    });

    await expect(run()).rejects.toThrow(/reason is required/i);
  });

  it('conflicts when the row version moved', async () => {
    lockZone.mockResolvedValue({ id: 'zone-1', row_version: 9, handed_over_at: null });
    await expect(run()).rejects.toThrow(/reload and retry/i);
    expect(declareHandover).not.toHaveBeenCalled();
  });

  it('blocks an ineligible zone when no override is offered', async () => {
    calculateAggregate.mockReturnValue({
      eligibleForHandover: false,
      blockers: [{ code: 'PON_NOT_LIVE', message: 'PONs are not technically live' }],
    });

    await expect(run()).rejects.toThrow(/not technically live/i);
    expect(declareHandover).not.toHaveBeenCalled();
  });

  it('proceeds on an ineligible legacy zone with an authorised override', async () => {
    calculateAggregate.mockReturnValue({
      eligibleForHandover: false,
      blockers: [{ code: 'PON_NOT_LIVE', message: 'PONs are not technically live' }],
    });

    await run(
      input({ overridePrerequisite: true, reason: 'Lawley 17 delivered before FibreFlow' }),
      actor({ canOverridePrerequisites: true }),
    );

    expect(declareHandover).toHaveBeenCalled();
    const activity = appendActivity.mock.calls[0]![1] as Record<string, never>;
    expect(activity.newValue).toMatchObject({ overrodePrerequisite: true });
  });

  it.each([
    ['FAC_MISSING', 'Active FAC is missing'],
    ['CAC_MISSING', 'Active CAC is missing'],
    ['OPEN_HANDOVER_SNAGS', '2 open handover-blocking snag(s)'],
  ])('never waives %s, even with an authorised override', async (code, message) => {
    calculateAggregate.mockReturnValue({
      eligibleForHandover: false,
      blockers: [{ code, message }],
    });

    await expect(run(
      input({ overridePrerequisite: true, reason: 'legacy site' }),
      actor({ canOverridePrerequisites: true }),
    )).rejects.toThrow(new RegExp(message.replace(/[()]/g, '.'), 'i'));
    expect(declareHandover).not.toHaveBeenCalled();
  });

  it('refuses an override from an actor without the grant', async () => {
    calculateAggregate.mockReturnValue({
      eligibleForHandover: false,
      blockers: [{ code: 'PON_NOT_LIVE', message: 'PONs are not technically live' }],
    });

    await expect(run(
      input({ overridePrerequisite: true, reason: 'legacy site' }),
      actor({ canOverridePrerequisites: false }),
    )).rejects.toThrow(/override is required/i);
    expect(declareHandover).not.toHaveBeenCalled();
  });
});
