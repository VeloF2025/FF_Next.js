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

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Relative to the clock, not a literal. `effectiveFrom` may no longer be
 * backdated, so a hard-coded 2026-09-01 would be a fixture that quietly starts
 * failing the day it goes past — and the failure would look like a bug in the
 * rule rather than in the fixture.
 */
const PAST = new Date(Date.now() - 30 * DAY_MS).toISOString();
const FUTURE = new Date(Date.now() + 7 * DAY_MS).toISOString();

/** The open version the transaction locks, as migration 518's defaults describe it. */
const CURRENT = {
  version: 4,
  effective_from: PAST,
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
    effectiveFrom: FUTURE,
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
   * A version may be scheduled forward but never backdated. The settings row
   * is the record of what was in force when a purge ran, so one claiming to
   * have been effective last month rewrites the justification for deletions
   * that already happened.
   *
   * `../driver/settingsRepository.ts` has the same gap and is deliberately NOT
   * fixed here — a second table with its own tests is a second review.
   */
  it('refuses an effectiveFrom in the past', async () => {
    happyPath();
    const backdated = new Date(Date.now() - 60 * 1000).toISOString();
    await expect(versionAnalyticsRetentionSettings(request({ effectiveFrom: backdated }), ACTOR))
      .rejects.toThrow(/past|backdat/i);
  });

  it('accepts an effectiveFrom scheduled forward', async () => {
    happyPath();
    await expect(versionAnalyticsRetentionSettings(
      request({ effectiveFrom: new Date(Date.now() + 90 * DAY_MS).toISOString() }), ACTOR,
    )).resolves.toBeDefined();
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
      transactionReturning([CURRENT, { id: DRY_RUN }, { ...CURRENT, version: 5, retention_months: 6 }]);
      const created = await versionAnalyticsRetentionSettings(
        request({ retentionMonths: 6, acknowledgedDryRunId: DRY_RUN }), ACTOR,
      );
      expect(created.retentionMonths).toBe(6);
    });

    /**
     * Three clauses, and the gate is worth nothing without all three. Without
     * `dry_run`, a LIVE run — the deletion itself — would arm the change.
     * Without `policy_months`, a dry run at 24 months would authorise a cut to
     * 6, though it says nothing about what a 6-month policy deletes. Without
     * the age bound, a run from last quarter would, though incidents have aged
     * past the cutoff since and they are exactly the ones this would delete.
     *
     * Dropping any one clause from the SQL fails this test.
     */
    it('looks up the dry run scoped to dry, to the months asked for, and to the last 14 days', async () => {
      const { calls } = transactionReturning([CURRENT, { id: DRY_RUN }, { ...CURRENT, version: 5, retention_months: 6 }]);
      await versionAnalyticsRetentionSettings(
        request({ retentionMonths: 6, acknowledgedDryRunId: DRY_RUN }), ACTOR,
      );
      const lookup = calls.find((call) => /retention_runs/i.test(call.sql));
      expect(lookup?.sql).toMatch(/dry_run\s*=\s*true/i);
      expect(lookup?.sql).toMatch(/policy_months\s*=\s*\$2/i);
      expect(lookup?.sql).toMatch(/started_at\s*>\s*now\(\)\s*-/i);
      // The months bound to that clause are the ones being ASKED for, not the
      // ones in force: the dry run has to describe the policy about to apply.
      expect(lookup?.params[1]).toBe(6);
      expect(lookup?.params[2]).toBe('14');
    });

    it('says what would make the acknowledgement acceptable', async () => {
      transactionReturning([CURRENT, null]);
      await expect(versionAnalyticsRetentionSettings(
        request({ retentionMonths: 6, acknowledgedDryRunId: DRY_RUN }), ACTOR,
      )).rejects.toThrow(/6 months.*14 days/i);
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

  /**
   * `liveRetentionEnabled` false→true is the switch that ARMS deletion. Until
   * it flips the purge reports and deletes nothing; flipping it makes every
   * incident already past the cutoff deletable at the next run — on a first
   * arming, the entire backlog. It is a bigger irreversible step than
   * shortening the window by a month, and it had no gate at all.
   */
  describe('arming live retention', () => {
    const armed = { ...CURRENT, live_retention_enabled: true };

    it('refuses to arm without a dry run to point at', async () => {
      happyPath();
      await expect(versionAnalyticsRetentionSettings(request({ liveRetentionEnabled: true }), ACTOR))
        .rejects.toBeInstanceOf(RetentionSettingsValidationError);
    });

    it('says a dry run at the requested months, within 14 days, is what is wanted', async () => {
      happyPath();
      await expect(versionAnalyticsRetentionSettings(request({ liveRetentionEnabled: true }), ACTOR))
        .rejects.toThrow(/12 months.*14 days/i);
    });

    /**
     * A run that is live, at other months, or older than the window fails the
     * repository's lookup and comes back as no row — which is the same
     * refusal, for each of the three reasons.
     */
    it('refuses a dry-run id the scoped lookup does not find', async () => {
      transactionReturning([CURRENT, null]);
      await expect(versionAnalyticsRetentionSettings(
        request({ liveRetentionEnabled: true, acknowledgedDryRunId: DRY_RUN }), ACTOR,
      )).rejects.toBeInstanceOf(RetentionSettingsValidationError);
    });

    it('arms once a recent dry run at the same months is named', async () => {
      const { calls } = transactionReturning([
        CURRENT, { id: DRY_RUN }, { ...CURRENT, version: 5, live_retention_enabled: true },
      ]);
      const created = await versionAnalyticsRetentionSettings(
        request({ liveRetentionEnabled: true, acknowledgedDryRunId: DRY_RUN }), ACTOR,
      );
      expect(created.liveRetentionEnabled).toBe(true);
      expect(calls.find((call) => /retention_runs/i.test(call.sql))?.params[1]).toBe(12);
    });

    /** Disarming deletes nothing and needs no ceremony. */
    it('lets live retention be turned off freely', async () => {
      transactionReturning([armed, { ...armed, version: 5, live_retention_enabled: false }]);
      await expect(versionAnalyticsRetentionSettings(request({ liveRetentionEnabled: false }), ACTOR))
        .resolves.toBeDefined();
    });

    it('lets an already-armed policy be saved unchanged', async () => {
      transactionReturning([armed, { ...armed, version: 5 }]);
      await expect(versionAnalyticsRetentionSettings(request({ liveRetentionEnabled: true }), ACTOR))
        .resolves.toBeDefined();
    });
  });

  it('refuses when there is no open version to replace', async () => {
    transactionReturning([null]);
    await expect(versionAnalyticsRetentionSettings(request(), ACTOR))
      .rejects.toBeInstanceOf(RetentionSettingsValidationError);
  });
});
