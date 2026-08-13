import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
  txnQuery: vi.fn(),
  txnQueryOne: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({
  query: db.query,
  queryOne: db.queryOne,
  transaction: db.transaction,
}));

import {
  RuleValidationError,
  createRuleVersion,
  listRuleVersions,
  loadEffectiveRule,
} from '../ruleQueries';

const USER = '11111111-1111-4111-8111-111111111111';
const row = {
  id: '22222222-2222-4222-8222-222222222222', version: 1,
  timezone: 'Africa/Johannesburg', effective_from: '2026-08-13T08:00:00.000Z', effective_to: null,
  monitoring_before_minutes: 60, monitoring_after_minutes: 60, arrival_dwell_minutes: 5,
  wrong_site_confirmation_minutes: 5, early_departure_confirmation_minutes: 10,
  approaching_distance_meters: 10_000, approaching_min_readings: 2,
  minimum_moving_speed_kmh: 5, evidence_mismatch_tolerance_meters: 250,
  change_reason: null, created_by: USER, created_at: '2026-08-13T08:00:00.000Z',
};

const input = {
  timezone: 'Africa/Johannesburg', effectiveFrom: '2099-01-01T00:00:00.000Z',
  monitoringBeforeMinutes: 30, monitoringAfterMinutes: 45, arrivalDwellMinutes: 4,
  wrongSiteConfirmationMinutes: 6, earlyDepartureConfirmationMinutes: 12,
  approachingDistanceMeters: 8_000, approachingMinReadings: 3,
  minimumMovingSpeedKmh: 8, evidenceMismatchToleranceMeters: 300,
  changeReason: '  Temporary field-trial calibration  ',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => work({
    query: db.txnQuery, queryOne: db.txnQueryOne,
  }));
});

describe('operational status rules', () => {
  it('selects only the rule whose half-open interval covers the as-of instant', async () => {
    db.queryOne.mockResolvedValue(row);

    await expect(loadEffectiveRule('2026-08-13T08:00:00.000Z')).resolves.toMatchObject({ version: 1 });
    expect(db.queryOne.mock.calls[0]?.[0]).toContain('effective_from <= $1::timestamptz');
    expect(db.queryOne.mock.calls[0]?.[0]).toContain("effective_to > $1::timestamptz");
  });

  it('lists rule history newest version first', async () => {
    db.query.mockResolvedValue([{ ...row, version: 2 }, row]);

    await expect(listRuleVersions()).resolves.toMatchObject([{ version: 2 }, { version: 1 }]);
    expect(db.query.mock.calls[0]?.[0]).toContain('ORDER BY version DESC');
  });

  it('locks the open version, closes it, then inserts the next version atomically', async () => {
    db.txnQueryOne.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, id: '33333333-3333-4333-8333-333333333333', version: 2, effective_from: input.effectiveFrom, change_reason: 'Temporary field-trial calibration' });
    db.txnQuery.mockResolvedValue([]);

    await expect(createRuleVersion(input, USER)).resolves.toMatchObject({ version: 2, changeReason: 'Temporary field-trial calibration' });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.txnQueryOne.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(db.txnQuery.mock.calls[0]?.[0]).toContain('SET effective_to = $1::timestamptz');
    expect(db.txnQuery.mock.invocationCallOrder[0]).toBeLessThan(db.txnQueryOne.mock.invocationCallOrder[1]!);
    expect(db.txnQueryOne.mock.calls[1]?.[1]).toContain(2);
    expect(db.txnQueryOne.mock.calls[1]?.[1]).toContain('Temporary field-trial calibration');
  });

  it('rejects a backdated activation before opening a transaction', async () => {
    await expect(createRuleVersion({ ...input, effectiveFrom: '2020-01-01T00:00:00.000Z' }, USER))
      .rejects.toBeInstanceOf(RuleValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each(['2099-02-30T00:00:00.000Z', '2099-01-01', 'January 1, 2099']) (
    'rejects the malformed activation instant %s before SQL', async (effectiveFrom) => {
      await expect(createRuleVersion({ ...input, effectiveFrom }, USER)).rejects.toBeInstanceOf(RuleValidationError);
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['2099-01-01T00:00:00.000Z', '2099-01-01T02:00:00+02:00'])(
    'accepts and normalizes the valid future instant %s', async (effectiveFrom) => {
      db.txnQueryOne.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, version: 2, effective_from: '2099-01-01T00:00:00.000Z' });
      db.txnQuery.mockResolvedValue([]);
      await expect(createRuleVersion({ ...input, effectiveFrom }, USER)).resolves.toMatchObject({ version: 2 });
      expect(db.txnQuery.mock.calls[0]?.[1]?.[0]).toBe('2099-01-01T00:00:00.000Z');
    },
  );

  it('allows an activation timestamp captured immediately before the request', async () => {
    const capturedNow = new Date(Date.now() - 1_000).toISOString();
    db.txnQueryOne.mockResolvedValueOnce({ ...row, effective_from: '2026-08-13T08:00:00.000Z' })
      .mockResolvedValueOnce({ ...row, version: 2, effective_from: capturedNow });
    db.txnQuery.mockResolvedValue([]);

    await expect(createRuleVersion({ ...input, effectiveFrom: capturedNow }, USER)).resolves.toMatchObject({ version: 2 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['negative monitoring before', { monitoringBeforeMinutes: -1 }],
    ['zero approaching distance', { approachingDistanceMeters: 0 }],
    ['zero approaching readings', { approachingMinReadings: 0 }],
    ['negative mismatch tolerance', { evidenceMismatchToleranceMeters: -1 }],
  ])('rejects %s before SQL', async (_label, change) => {
    await expect(createRuleVersion({ ...input, ...change }, USER)).rejects.toBeInstanceOf(RuleValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['monitoring before', { monitoringBeforeMinutes: 1.5 }],
    ['monitoring after', { monitoringAfterMinutes: 1.5 }],
    ['arrival dwell', { arrivalDwellMinutes: 1.5 }],
    ['wrong-site confirmation', { wrongSiteConfirmationMinutes: 1.5 }],
    ['early-departure confirmation', { earlyDepartureConfirmationMinutes: 1.5 }],
    ['approaching distance', { approachingDistanceMeters: 1.5 }],
    ['approaching readings', { approachingMinReadings: 1.5 }],
    ['mismatch tolerance', { evidenceMismatchToleranceMeters: 1.5 }],
  ])('rejects decimal %s before SQL', async (_label, change) => {
    await expect(createRuleVersion({ ...input, ...change }, USER)).rejects.toBeInstanceOf(RuleValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('propagates an insert failure so the transaction rolls back its close', async () => {
    db.txnQueryOne.mockResolvedValueOnce(row).mockRejectedValueOnce(new Error('insert failed'));
    db.txnQuery.mockResolvedValue([]);

    await expect(createRuleVersion(input, USER)).rejects.toThrow('insert failed');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
