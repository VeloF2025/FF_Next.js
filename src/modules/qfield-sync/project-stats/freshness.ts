import type { Freshness } from './types';

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const POLICY = 'stale after 24 weekday hours; weekend warnings suppressed' as const;

function shifted(ms: number): Date {
  return new Date(ms + SAST_OFFSET_MS);
}

function isWeekend(ms: number): boolean {
  const day = shifted(ms).getUTCDay();
  return day === 0 || day === 6;
}

function nextSastMidnightUtc(ms: number): number {
  const local = shifted(ms);
  return (
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - SAST_OFFSET_MS
  );
}

export function weekdayAgeHours(startIso: string, end: Date): number | null {
  const start = Date.parse(startIso);
  const endMs = end.getTime();
  if (!Number.isFinite(start) || endMs < start) return null;

  let cursor = start;
  let weekdayMs = 0;
  while (cursor < endMs) {
    const segmentEnd = Math.min(endMs, nextSastMidnightUtc(cursor));
    if (!isWeekend(cursor)) weekdayMs += segmentEnd - cursor;
    cursor = segmentEnd;
  }
  return Math.round((weekdayMs / HOUR_MS) * 100) / 100;
}

export function calculateFreshness(lastUpdatedAt: string | null, now = new Date()): Freshness {
  if (!lastUpdatedAt) {
    return {
      lastQFieldUpdateAt: null,
      weekdayAgeHours: null,
      state: 'unknown',
      warningSuppressed: false,
      policy: POLICY,
    };
  }

  const age = weekdayAgeHours(lastUpdatedAt, now);
  if (age === null) {
    return {
      lastQFieldUpdateAt: lastUpdatedAt,
      weekdayAgeHours: null,
      state: 'unknown',
      warningSuppressed: false,
      policy: POLICY,
    };
  }

  const state = age > 24 ? 'stale' : 'fresh';
  return {
    lastQFieldUpdateAt: lastUpdatedAt,
    weekdayAgeHours: age,
    state,
    warningSuppressed: state === 'stale' && isWeekend(now.getTime()),
    policy: POLICY,
  };
}
