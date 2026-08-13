import { describe, expect, it } from 'vitest';
import {
  approachTrend,
  continuousInside,
  continuousOutside,
  continuousOutsideAtKnownSite,
  type ContinuityFix,
} from '../continuity';

const at = (seconds: number, change: Partial<ContinuityFix> = {}): ContinuityFix => ({ recordedAt: new Date(Date.UTC(2026, 7, 13, 8, 0, seconds)).toISOString(), valid: true, inside: true, distanceM: 100, speedKmh: 10, ...change });
const AS_OF = '2026-08-13T08:10:00.000Z';

describe('continuity', () => {
  it('keeps one inside fix pending and confirms two fixes at exactly five minutes', () => {
    expect(continuousInside([at(0)], 5 * 60, 600, AS_OF)).toMatchObject({ confirmed: false, pending: true });
    expect(continuousInside([at(0), at(300)], 5 * 60, 600, AS_OF)).toMatchObject({ confirmed: true });
    expect(continuousInside([at(0), at(299)], 5 * 60, 600, AS_OF)).toMatchObject({ confirmed: false, pending: true });
  });

  it('allows a freshness-sized gap and breaks one second above it', () => {
    expect(continuousInside([at(0), at(300)], 300, 300, '2026-08-13T08:05:00Z')).toMatchObject({ confirmed: true });
    expect(continuousInside([at(0), at(301)], 300, 300, '2026-08-13T08:05:01Z')).toMatchObject({ confirmed: false, pending: true, sequenceLength: 1 });
  });

  it('uses the newest fresh valid sequence for outside wrong-site/departure confirmation', () => {
    const fixes = [at(0, { inside: false }), at(301, { inside: false }), at(601, { inside: false })];
    expect(continuousOutside(fixes, 300, 300, '2026-08-13T08:10:01Z')).toMatchObject({ confirmed: true, sequenceLength: 2 });
    expect(continuousOutside([...fixes, at(602, { valid: false, inside: false })], 301, 300, '2026-08-13T08:10:02Z')).toMatchObject({ confirmed: false, pending: true });
  });

  it('does not let a stale earlier fix confirm dwell with a fresh latest fix', () => {
    expect(continuousInside([at(0), at(600)], 300, 300, '2026-08-13T08:10:00Z'))
      .toMatchObject({ confirmed: false, pending: true, sequenceLength: 1 });
  });

  it('requires one continuous known wrong-site identity for confirmation', () => {
    const sameSite = [
      at(0, { inside: false, knownSiteId: 'site-2' }),
      at(300, { inside: false, knownSiteId: 'site-2' }),
    ];
    expect(continuousOutsideAtKnownSite(sameSite, 300, 300, '2026-08-13T08:05:00Z'))
      .toMatchObject({ confirmed: true, knownSiteId: 'site-2', sequenceLength: 2 });

    const changedSite = [sameSite[0]!, at(300, { inside: false, knownSiteId: 'site-3' })];
    expect(continuousOutsideAtKnownSite(changedSite, 300, 300, '2026-08-13T08:05:00Z'))
      .toMatchObject({ confirmed: false, knownSiteId: 'site-3', sequenceLength: 1 });
    expect(continuousOutsideAtKnownSite(
      [at(0, { inside: false, knownSiteId: null }), at(300, { inside: false, knownSiteId: null })],
      300,
      300,
      '2026-08-13T08:05:00Z',
    )).toMatchObject({ confirmed: false, knownSiteId: null });
  });
});

describe('approachTrend', () => {
  it('accepts two decreasing fresh readings at inclusive distance and speed thresholds', () => {
    expect(approachTrend([at(0, { distanceM: 10_000, speedKmh: 5 }), at(60, { distanceM: 9_000, speedKmh: 5 })], 2, 10_000, 5, 300, '2026-08-13T08:01:00Z')).toBe(true);
  });

  it('rejects flat/increasing, below-speed, outside-distance, and stale readings', () => {
    expect(approachTrend([at(0), at(60)], 2, 10_000, 5, 300, '2026-08-13T08:01:00Z')).toBe(false);
    expect(approachTrend([at(0, { distanceM: 100 }), at(60, { distanceM: 90, speedKmh: 4.99 })], 2, 10_000, 5, 300, '2026-08-13T08:01:00Z')).toBe(false);
    expect(approachTrend([at(0, { distanceM: 11_000 }), at(60, { distanceM: 10_001 })], 2, 10_000, 5, 300, '2026-08-13T08:01:00Z')).toBe(false);
    expect(approachTrend([at(0, { distanceM: 100 }), at(60, { distanceM: 90 })], 2, 10_000, 5, 30, '2026-08-13T08:01:31Z')).toBe(false);
  });

  it('does not let a stale old reading contribute to an approach trend', () => {
    expect(approachTrend([at(0, { distanceM: 10_000 }), at(600, { distanceM: 9_000 })], 2, 10_000, 5, 300, '2026-08-13T08:10:00Z')).toBe(false);
  });
});
