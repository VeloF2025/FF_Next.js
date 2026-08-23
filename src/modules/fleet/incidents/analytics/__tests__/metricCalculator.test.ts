/**
 * Monthly metric calculation: facts in, per-site groups out.
 *
 * Two properties carry real weight here and the rest support them:
 *
 *   - Vehicle-only evidence is NEVER confirmed presence. A vehicle parked at a
 *     site is not a person at a site, and a metric that conflates the two would
 *     make an absent driver look present in every downstream report.
 *   - `numerator <= denominator` holds for every ratio produced. The aggregate
 *     table enforces it as a CHECK, so a calculator that can exceed it does not
 *     produce a wrong number - it produces a failed run at 01:00.
 */
import { describe, expect, it } from 'vitest';
import { calculateMonthlyMetrics } from '../metricCalculator';
import type { IncidentFact, OperationsFact, PresenceFact } from '../facts';

const DIMENSION = { projectId: 'p1', operationalSiteId: 's1' };
const VERSION = 1;

function presence(
  contributorKey: string,
  confirmation: PresenceFact['confirmation'],
  workDate = '2026-07-14',
): PresenceFact {
  return { kind: 'presence', workDate, dimension: DIMENSION, contributorKey, confirmation };
}

function incident(overrides: Partial<IncidentFact> = {}): IncidentFact {
  return {
    kind: 'incident',
    workDate: '2026-07-14',
    dimension: DIMENSION,
    contributorKey: 'staff-1',
    incidentType: 'late',
    outcome: null,
    acknowledgementSeconds: null,
    reviewStartSeconds: null,
    resolutionSeconds: null,
    driverResponseSeconds: null,
    driverInputRequested: false,
    driverInputResponded: false,
    driverInputOnTime: false,
    evidenceAvailable: false,
    isRecurrence: false,
    ...overrides,
  };
}

function find(groups: ReturnType<typeof calculateMonthlyMetrics>, metricKey: string) {
  return groups.find((g) => g.metricKey === metricKey);
}

describe('calculateMonthlyMetrics', () => {
  describe('presence', () => {
    it('counts every scheduled staff-day, whatever its confirmation', () => {
      const groups = calculateMonthlyMetrics(
        [
          presence('a', 'confirmed'),
          presence('b', 'unconfirmed'),
          presence('c', 'vehicle_only'),
        ],
        VERSION,
      );
      const scheduled = find(groups, 'presence.scheduled_days');
      expect(scheduled?.numerator).toBe(3);
      expect(scheduled?.denominator).toBeNull();
    });

    it('NEVER counts vehicle-only evidence as confirmed presence', () => {
      const groups = calculateMonthlyMetrics(
        [presence('a', 'confirmed'), presence('b', 'vehicle_only'), presence('c', 'vehicle_only')],
        VERSION,
      );

      expect(find(groups, 'presence.confirmed_days')?.numerator).toBe(1);
      expect(find(groups, 'presence.vehicle_only_days')?.numerator).toBe(2);
      // and it is not quietly folded into unconfirmed either
      expect(find(groups, 'presence.unconfirmed_days')?.numerator).toBe(0);
    });

    it('divides each confirmation state by scheduled days', () => {
      const groups = calculateMonthlyMetrics(
        [presence('a', 'confirmed'), presence('b', 'confirmed'), presence('c', 'unconfirmed')],
        VERSION,
      );
      expect(find(groups, 'presence.confirmed_days')?.denominator).toBe(3);
      expect(find(groups, 'presence.unconfirmed_days')?.denominator).toBe(3);
      expect(find(groups, 'presence.vehicle_only_days')?.denominator).toBe(3);
    });
  });

  describe('incidents and outcomes', () => {
    it('counts each incident type under its own key', () => {
      const groups = calculateMonthlyMetrics(
        [
          incident({ incidentType: 'late' }),
          incident({ incidentType: 'late' }),
          incident({ incidentType: 'severe_driving' }),
        ],
        VERSION,
      );
      expect(find(groups, 'incident.late')?.numerator).toBe(2);
      expect(find(groups, 'incident.severe_driving')?.numerator).toBe(1);
      expect(find(groups, 'incident.wrong_site')?.numerator).toBe(0);
    });

    it('keeps incident counts denominator-free so two-per-day cannot exceed a rate', () => {
      // Three incidents on one staff-day. As a ratio over scheduled days this
      // would be 3/1 and the aggregate table's numerator <= denominator CHECK
      // would reject the row.
      const groups = calculateMonthlyMetrics(
        [presence('a', 'confirmed'), incident(), incident(), incident()],
        VERSION,
      );
      expect(find(groups, 'incident.late')?.numerator).toBe(3);
      expect(find(groups, 'incident.late')?.denominator).toBeNull();
    });

    it('divides outcomes by reviewed incidents, not by all incidents', () => {
      const groups = calculateMonthlyMetrics(
        [
          incident({ outcome: 'confirmed' }),
          incident({ outcome: 'false_positive' }),
          incident({ outcome: null }), // still open
        ],
        VERSION,
      );
      expect(find(groups, 'outcome.confirmed')?.numerator).toBe(1);
      expect(find(groups, 'outcome.confirmed')?.denominator).toBe(2);
      expect(find(groups, 'outcome.duplicate')?.numerator).toBe(0);
    });
  });

  describe('timing histograms', () => {
    it('places a duration in the bucket its upper bound owns', () => {
      const groups = calculateMonthlyMetrics(
        [
          incident({ acknowledgementSeconds: 1 }),
          incident({ acknowledgementSeconds: 300 }), // inclusive upper bound
          incident({ acknowledgementSeconds: 301 }),
          incident({ acknowledgementSeconds: 20000 }), // past the last bound
        ],
        VERSION,
      );
      const histogram = find(groups, 'timing.acknowledgement')?.histogram;
      expect(histogram?.buckets).toEqual([2, 1, 0, 0, 0, 1]);
      expect(histogram?.sampleCount).toBe(4);
      expect(histogram?.sumSeconds).toBe(20602);
    });

    it('ignores an unmeasured duration rather than counting it as zero', () => {
      const groups = calculateMonthlyMetrics(
        [incident({ resolutionSeconds: 600 }), incident({ resolutionSeconds: null })],
        VERSION,
      );
      const histogram = find(groups, 'timing.resolution')?.histogram;
      expect(histogram?.sampleCount).toBe(1);
      expect(histogram?.sumSeconds).toBe(600);
    });

    it('gives every timing metric a histogram and no denominator', () => {
      const groups = calculateMonthlyMetrics([incident({ driverResponseSeconds: 60 })], VERSION);
      const timing = groups.filter((g) => g.metricKey.startsWith('timing.'));
      expect(timing).toHaveLength(4);
      for (const group of timing) {
        expect(group.histogram).not.toBeNull();
        expect(group.denominator).toBeNull();
      }
    });
  });

  describe('driver input and reliability', () => {
    it('divides responses by requests sent', () => {
      const groups = calculateMonthlyMetrics(
        [
          incident({ driverInputRequested: true, driverInputResponded: true, driverInputOnTime: true }),
          incident({ driverInputRequested: true, driverInputResponded: true, driverInputOnTime: false }),
          incident({ driverInputRequested: true }),
          incident({ driverInputRequested: false }),
        ],
        VERSION,
      );
      expect(find(groups, 'input.requests_sent')?.numerator).toBe(3);
      expect(find(groups, 'input.responses_received')?.numerator).toBe(2);
      expect(find(groups, 'input.responses_received')?.denominator).toBe(3);
      expect(find(groups, 'input.responses_on_time')?.numerator).toBe(1);
      expect(find(groups, 'input.responses_on_time')?.denominator).toBe(3);
    });

    it('divides evidence availability and recurrence by incidents', () => {
      const groups = calculateMonthlyMetrics(
        [
          incident({ evidenceAvailable: true, isRecurrence: true }),
          incident({ evidenceAvailable: false, isRecurrence: false }),
        ],
        VERSION,
      );
      expect(find(groups, 'reliability.evidence_available')?.numerator).toBe(1);
      expect(find(groups, 'reliability.evidence_available')?.denominator).toBe(2);
      expect(find(groups, 'reliability.recurrence')?.numerator).toBe(1);
    });

    it('gives a monitor-run metric the roster it covered as its contributors', () => {
      // The aggregate table's contributor_count >= 5 is unconditional, so a
      // system metric with no people attached could never be stored at all.
      const facts: OperationsFact[] = [
        {
          kind: 'monitor_run',
          workDate: '2026-07-14',
          dimension: DIMENSION,
          contributorKeys: ['a', 'b', 'c'],
          completed: true,
        },
        {
          kind: 'monitor_run',
          workDate: '2026-07-14',
          dimension: DIMENSION,
          contributorKeys: ['c', 'd'],
          completed: false,
        },
      ];
      const groups = calculateMonthlyMetrics(facts, VERSION);
      expect(find(groups, 'reliability.monitor_runs_expected')?.numerator).toBe(2);
      expect(find(groups, 'reliability.monitor_runs_completed')?.numerator).toBe(1);
      expect(find(groups, 'reliability.monitor_runs_completed')?.denominator).toBe(2);
      expect(find(groups, 'reliability.monitor_runs_expected')?.contributors.size).toBe(4);
    });

    it('divides delivered notifications by sent', () => {
      const facts: OperationsFact[] = [
        { kind: 'notification', workDate: '2026-07-14', dimension: DIMENSION, contributorKey: 'a', delivered: true },
        { kind: 'notification', workDate: '2026-07-14', dimension: DIMENSION, contributorKey: 'b', delivered: false },
      ];
      const groups = calculateMonthlyMetrics(facts, VERSION);
      expect(find(groups, 'reliability.notifications_sent')?.numerator).toBe(2);
      expect(find(groups, 'reliability.notifications_delivered')?.numerator).toBe(1);
      expect(find(groups, 'reliability.notifications_delivered')?.denominator).toBe(2);
    });
  });

  describe('grouping', () => {
    it('splits on the SAST month the work date falls in', () => {
      const groups = calculateMonthlyMetrics(
        [presence('a', 'confirmed', '2026-07-31'), presence('a', 'confirmed', '2026-08-01')],
        VERSION,
      );
      const scheduled = groups.filter((g) => g.metricKey === 'presence.scheduled_days');
      expect(scheduled.map((g) => g.monthStart).sort()).toEqual(['2026-07-01', '2026-08-01']);
      expect(scheduled.every((g) => g.numerator === 1)).toBe(true);
    });

    it('splits on site, keeping each site its own group', () => {
      const other = { ...presence('b', 'confirmed'), dimension: { projectId: 'p1', operationalSiteId: 's2' } };
      const groups = calculateMonthlyMetrics([presence('a', 'confirmed'), other], VERSION);
      const scheduled = groups.filter((g) => g.metricKey === 'presence.scheduled_days');
      expect(scheduled.map((g) => g.operationalSiteId).sort()).toEqual(['s1', 's2']);
    });

    it('collects the contributors that produced each group', () => {
      const groups = calculateMonthlyMetrics(
        [presence('a', 'confirmed'), presence('b', 'confirmed'), presence('a', 'unconfirmed')],
        VERSION,
      );
      expect(find(groups, 'presence.scheduled_days')?.contributors).toEqual(new Set(['a', 'b']));
    });

    it('stamps the metric version it was asked for', () => {
      const groups = calculateMonthlyMetrics([presence('a', 'confirmed')], 7);
      expect(groups.every((g) => g.metricVersion === 7)).toBe(true);
    });

    it('produces nothing at all from no facts', () => {
      expect(calculateMonthlyMetrics([], VERSION)).toEqual([]);
    });
  });

  it('never produces a ratio the aggregate CHECK would reject', () => {
    const facts: OperationsFact[] = [
      presence('a', 'confirmed'),
      presence('b', 'vehicle_only'),
      incident({ outcome: 'confirmed', driverInputRequested: true, driverInputResponded: true }),
      incident({ outcome: 'duplicate', evidenceAvailable: true, isRecurrence: true }),
      incident(),
      { kind: 'notification', workDate: '2026-07-14', dimension: DIMENSION, contributorKey: 'a', delivered: true },
      { kind: 'monitor_run', workDate: '2026-07-14', dimension: DIMENSION, contributorKeys: ['a'], completed: true },
    ];
    const groups = calculateMonthlyMetrics(facts, VERSION);
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.numerator).toBeGreaterThanOrEqual(0);
      if (group.denominator !== null) {
        expect(group.numerator).toBeLessThanOrEqual(group.denominator);
      }
    }
  });
});
