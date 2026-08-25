/**
 * The labels exist so the screen never shows a reader a database key. The
 * forbidding test is the exhaustive one: a metric key added to
 * `OPERATIONS_METRIC_KEYS` without a label here would otherwise reach the page
 * as `reliability.notifications_delivered` and look deliberate.
 */
import { describe, expect, it } from 'vitest';
import { OPERATIONS_METRIC_KEYS } from '../../analytics/aggregateSchema';
import { HEADLINE_METRICS, METRIC_GROUPS, metricLabel } from '../operationsMetricLabels';

describe('metricLabel', () => {
  it('labels every metric key', () => {
    for (const key of OPERATIONS_METRIC_KEYS) {
      const label = metricLabel(key);
      expect(label).not.toBe(key);
      expect(label).not.toMatch(/[._]/);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  /**
   * The incident and outcome halves are derived from the queue's own label
   * maps rather than restated. Two spellings of "Accident / SOS" on two Fleet
   * screens is how a reader ends up believing they are two different things.
   */
  it('reuses the incident queue wording for types and outcomes', () => {
    expect(metricLabel('incident.accident_sos')).toBe('Accident / SOS');
    expect(metricLabel('outcome.no_action_required')).toBe('No action required');
  });
});

describe('METRIC_GROUPS', () => {
  it('covers every metric key exactly once', () => {
    const grouped = METRIC_GROUPS.flatMap((group) => group.keys);
    expect([...grouped].sort()).toEqual([...OPERATIONS_METRIC_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});

describe('HEADLINE_METRICS', () => {
  /**
   * A headline card shows a percentage, and it may only show one the server
   * paired with its own denominator. Anything else means the page dividing two
   * numbers the server never said were a ratio — and where a component was
   * released below FULL, that division is over a total whose members are
   * missing.
   */
  it('names only metrics the server gives a denominator', () => {
    const withDenominator = new Set([
      'presence.confirmed_days', 'presence.unconfirmed_days', 'presence.vehicle_only_days',
      'input.responses_received', 'input.responses_on_time',
      'reliability.monitor_runs_completed', 'reliability.notifications_delivered',
      'reliability.evidence_available', 'reliability.recurrence',
    ]);
    for (const key of HEADLINE_METRICS) expect(withDenominator.has(key)).toBe(true);
  });
});
