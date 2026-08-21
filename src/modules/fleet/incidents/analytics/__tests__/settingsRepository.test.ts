import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ queryOne: db.queryOne }));

import { getEffectiveAnalyticsRetentionSettings } from '../settingsRepository';

const ROW = {
  version: 1,
  effective_from: new Date('2026-08-01T00:00:00.000Z'),
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
  permitted_hold_categories: ['health_safety', 'legal'],
  metric_version: 1,
  live_retention_enabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.queryOne.mockResolvedValue(ROW);
});

describe('getEffectiveAnalyticsRetentionSettings', () => {
  it('selects the version whose effective interval covers the instant, parameterised', async () => {
    await getEffectiveAnalyticsRetentionSettings('2026-08-20T00:00:00.000Z');
    const [text, params] = db.queryOne.mock.calls[0]!;
    expect(text).toContain('FROM fleet_operational_analytics_settings');
    expect(text).toContain('effective_from <= $1::timestamptz');
    expect(text).toContain('effective_to IS NULL OR effective_to > $1::timestamptz');
    expect(params).toEqual(['2026-08-20T00:00:00.000Z']);
  });

  it('maps every retention knob the hold and purge services read', async () => {
    const settings = await getEffectiveAnalyticsRetentionSettings('2026-08-20T00:00:00.000Z');
    expect(settings).toMatchObject({
      version: 1,
      effectiveFrom: '2026-08-01T00:00:00.000Z',
      retentionMonths: 12,
      retentionBatchSize: 100,
      maximumHoldReviewDays: 90,
      holdReviewReminderLeadDays: 14,
      permittedHoldCategories: ['health_safety', 'legal'],
      liveRetentionEnabled: false,
    });
  });

  // Fails CLOSED. A missing settings interval must never silently become a
  // default 12-month policy: defaulting here would let a purge run against a
  // policy nobody configured.
  it('throws rather than defaulting when no interval covers the instant', async () => {
    db.queryOne.mockResolvedValue(null);
    await expect(getEffectiveAnalyticsRetentionSettings('2026-08-20T00:00:00.000Z')).rejects.toThrow(
      /No Fleet analytics.retention settings interval covers/,
    );
  });

  // live_retention_enabled is the switch between "report what would be deleted"
  // and "delete it". A truthy string from a driver quirk must not read as true
  // by accident, so the mapping is asserted on the false case explicitly above
  // and on the true case here.
  it('carries live retention enablement through unchanged', async () => {
    db.queryOne.mockResolvedValue({ ...ROW, live_retention_enabled: true });
    const settings = await getEffectiveAnalyticsRetentionSettings('2026-08-20T00:00:00.000Z');
    expect(settings.liveRetentionEnabled).toBe(true);
  });
});
