/**
 * Versioning the PR8 analytics/retention policy (stage 8, task 9b).
 *
 * Two things make this different from the other settings surfaces in the
 * module. Every bound here mirrors a CHECK constraint in migration 518, so the
 * caller gets a sentence instead of a 23514. And one field — `retentionMonths`
 * — decides how much identifiable data is eligible for deletion, so SHORTENING
 * it is gated on a dry run somebody actually looked at.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ transaction: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ transaction: db.transaction, queryOne: db.queryOne, query: vi.fn() }));

import {
  RetentionSettingsValidationError, versionAnalyticsRetentionSettings,
} from '../settingsRepository';
import type { AnalyticsRetentionSettingsChangeRequest } from '../settingsRepository';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const DRY_RUN = '99999999-9999-4999-8999-999999999999';

/** The open version the transaction locks, as migration 518's defaults describe it. */
const CURRENT = {
  version: 4,
  effective_from: '2026-01-01T00:00:00.000Z',
  retention_months: 12,
  anonymity_min_contributors: 5,
  recalculation_window_months: 3,
  retention_batch_size: 100,
  maximum_hold_review_days: 90,
  hold_review_reminder_lead_days: 14,
  aggregation_run_hour_sast: 1,
  aggregation_run_minute_sast: 0,
  retention_run_hour_sast: 3,
  retention_run_minute_sast: 30,
  aggregate_freshness_warning_hours: 36,
  retention_freshness_warning_hours: 48,
  permitted_hold_categories: ['health_safety', 'accident', 'insurance', 'disciplinary', 'legal', 'other_approved'],
  metric_version: 1,
  live_retention_enabled: false,
};

function request(over: Partial<AnalyticsRetentionSettingsChangeRequest> = {}): AnalyticsRetentionSettingsChangeRequest {
  return {
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    retentionMonths: 12,
    anonymityMinContributors: 5,
    recalculationWindowMonths: 3,
    retentionBatchSize: 100,
    maximumHoldReviewDays: 90,
    holdReviewReminderLeadDays: 14,
    aggregationRunHourSast: 1,
    aggregationRunMinuteSast: 0,
    retentionRunHourSast: 3,
    retentionRunMinuteSast: 30,
    aggregateFreshnessWarningHours: 36,
    retentionFreshnessWarningHours: 48,
    permittedHoldCategories: ['health_safety', 'legal'],
    metricVersion: 1,
    liveRetentionEnabled: false,
    changeReason: 'Quarterly review',
    ...over,
  } as AnalyticsRetentionSettingsChangeRequest;
}

interface Statement { sql: string; params: unknown[] }

/**
 * A transaction double. `rows` is what each `queryOne` returns in order, so a
 * test can supply the locked current version and then the inserted row.
 */
function transactionReturning(rows: unknown[]): { calls: Statement[] } {
  const calls: Statement[] = [];
  const queue = [...rows];
  db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => work({
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [] }; },
    queryOne: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return queue.shift() ?? null;
    },
  }));
  return { calls };
}

/** The common happy path: lock the current version, then return the inserted one. */
function happyPath(over: Record<string, unknown> = {}): { calls: Statement[] } {
  return transactionReturning([CURRENT, { ...CURRENT, version: 5, ...over }]);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('versionAnalyticsRetentionSettings', () => {
  it('closes the open version and inserts the next one', async () => {
    const { calls } = happyPath();
    const created = await versionAnalyticsRetentionSettings(request(), ACTOR);

    expect(created.version).toBe(5);
    expect(calls.some((call) => /UPDATE fleet_operational_analytics_settings SET effective_to/i.test(call.sql))).toBe(true);
    expect(calls.some((call) => /INSERT INTO fleet_operational_analytics_settings/i.test(call.sql))).toBe(true);
  });

  it('locks the open version before reading it', async () => {
    const { calls } = happyPath();
    await versionAnalyticsRetentionSettings(request(), ACTOR);
    expect(calls[0]?.sql).toMatch(/FOR UPDATE/i);
  });

  it('records the session actor, never an actor from the request', async () => {
    const { calls } = happyPath();
    await versionAnalyticsRetentionSettings(request(), ACTOR);
    const insert = calls.find((call) => /INSERT INTO/i.test(call.sql));
    expect(insert?.params).toContain(ACTOR);
  });

  it('refuses an effectiveFrom at or before the version it replaces', async () => {
    happyPath();
    await expect(versionAnalyticsRetentionSettings(request({ effectiveFrom: CURRENT.effective_from }), ACTOR))
      .rejects.toBeInstanceOf(RetentionSettingsValidationError);
  });

  it('refuses a malformed effectiveFrom', async () => {
    happyPath();
    await expect(versionAnalyticsRetentionSettings(request({ effectiveFrom: 'next Tuesday' }), ACTOR))
      .rejects.toBeInstanceOf(RetentionSettingsValidationError);
  });

  /**
   * Every one of these mirrors a CHECK in migration 518. They are validated
   * here so a caller gets a sentence naming the field rather than a 23514
   * naming a constraint, and so the rule is visible to a reader of the code.
   */
  it.each([
    ['retentionMonths', { retentionMonths: 0 }],
    ['retentionMonths above the ceiling', { retentionMonths: 121 }],
    ['anonymityMinContributors below the floor', { anonymityMinContributors: 4 }],
    ['recalculationWindowMonths', { recalculationWindowMonths: 0 }],
    ['recalculationWindowMonths above the ceiling', { recalculationWindowMonths: 25 }],
    ['retentionBatchSize', { retentionBatchSize: 0 }],
    ['retentionBatchSize above the ceiling', { retentionBatchSize: 101 }],
    ['maximumHoldReviewDays', { maximumHoldReviewDays: 0 }],
    ['maximumHoldReviewDays above the ceiling', { maximumHoldReviewDays: 91 }],
    ['holdReviewReminderLeadDays', { holdReviewReminderLeadDays: 0 }],
    ['an aggregation hour', { aggregationRunHourSast: 24 }],
    ['an aggregation minute', { aggregationRunMinuteSast: 60 }],
    ['a retention hour', { retentionRunHourSast: -1 }],
    ['a retention minute', { retentionRunMinuteSast: 60 }],
    ['aggregate freshness hours', { aggregateFreshnessWarningHours: 0 }],
    ['retention freshness hours', { retentionFreshnessWarningHours: 0 }],
    ['metricVersion', { metricVersion: 0 }],
    ['an empty category list', { permittedHoldCategories: [] }],
    ['an unknown category', { permittedHoldCategories: ['gardening'] }],
    ['a non-integer', { retentionMonths: 12.5 }],
  ])('refuses %s', async (_label, over) => {
    happyPath();
    await expect(versionAnalyticsRetentionSettings(request(over as Partial<AnalyticsRetentionSettingsChangeRequest>), ACTOR))
      .rejects.toBeInstanceOf(RetentionSettingsValidationError);
  });

  /**
   * A reminder that fires after the review is due is not a reminder. The
   * migration enforces the same pairing; this makes the message readable.
   */
  it('refuses a reminder lead longer than the review maximum', async () => {
    happyPath();
    await expect(versionAnalyticsRetentionSettings(
      request({ maximumHoldReviewDays: 30, holdReviewReminderLeadDays: 31 }), ACTOR,
    )).rejects.toBeInstanceOf(RetentionSettingsValidationError);
  });

  describe('shortening the retention window', () => {
    /**
     * Shortening is the one change here that DESTROYS data: every incident
     * between the new cutoff and the old one becomes eligible for deletion the
     * next time the purge runs. So it is gated on a dry run someone actually
     * looked at, rather than on a boolean any caller could set.
     */
    it('refuses to shorten without a dry run to point at', async () => {
      happyPath();
      await expect(versionAnalyticsRetentionSettings(request({ retentionMonths: 6 }), ACTOR))
        .rejects.toBeInstanceOf(RetentionSettingsValidationError);
    });

    it('names the months being given up, so the reader knows the size of it', async () => {
      happyPath();
      await expect(versionAnalyticsRetentionSettings(request({ retentionMonths: 6 }), ACTOR))
        .rejects.toThrow(/12.*6|6.*12/);
    });

    it('refuses a dry-run id that does not name a real dry run', async () => {
      transactionReturning([CURRENT, null]);
      await expect(versionAnalyticsRetentionSettings(
        request({ retentionMonths: 6, acknowledgedDryRunId: DRY_RUN }), ACTOR,
      )).rejects.toBeInstanceOf(RetentionSettingsValidationError);
    });

    it('accepts a shortening backed by a real dry run', async () => {
      const { calls } = transactionReturning([CURRENT, { id: DRY_RUN }, { ...CURRENT, version: 5, retention_months: 6 }]);
      const created = await versionAnalyticsRetentionSettings(
        request({ retentionMonths: 6, acknowledgedDryRunId: DRY_RUN }), ACTOR,
      );
      expect(created.retentionMonths).toBe(6);
      // The lookup is scoped to dry runs — a LIVE run is not an acknowledgement
      // of anything, it is the deletion itself.
      const lookup = calls.find((call) => /retention_runs/i.test(call.sql));
      expect(lookup?.sql).toMatch(/dry_run/i);
    });

    /** Lengthening adds no eligibility and needs no ceremony. */
    it('lets the window be lengthened freely', async () => {
      happyPath({ retention_months: 24 });
      await expect(versionAnalyticsRetentionSettings(request({ retentionMonths: 24 }), ACTOR)).resolves.toBeDefined();
    });

    it('lets an unchanged window through', async () => {
      happyPath();
      await expect(versionAnalyticsRetentionSettings(request({ retentionMonths: 12 }), ACTOR)).resolves.toBeDefined();
    });
  });

  it('refuses when there is no open version to replace', async () => {
    transactionReturning([null]);
    await expect(versionAnalyticsRetentionSettings(request(), ACTOR))
      .rejects.toBeInstanceOf(RetentionSettingsValidationError);
  });
});
