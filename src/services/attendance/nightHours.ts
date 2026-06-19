/**
 * Pure night-shift hour computation (BCEA s17) for the overtime engine.
 *
 * Split out of overtimeCalculator.ts to keep that file under CLAUDE.md's
 * 300-line cap. Computes the hours of a shift that fall inside the rule's
 * [nightStart, nightEnd] window (with midnight wrap), and parses the
 * 'HH:MM[:SS]' rule strings. No DB, no side effects.
 */

import { sastMidnight, overlapMs, MS_PER_HOUR, MS_PER_DAY } from './dayTypeHours';

export interface HourMinute {
  hour: number;
  minute: number;
}

/** Parse 'HH:MM' or 'HH:MM:SS' (SAST). Throws on malformed/out-of-range. */
export function parseHm(s: string): HourMinute {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) throw new Error(`parseHm: invalid time '${s}' (expected HH:MM or HH:MM:SS)`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`parseHm: out-of-range time '${s}'`);
  }
  return { hour, minute };
}

function addSastHm(midnight: Date, hm: HourMinute): Date {
  return new Date(midnight.getTime() + (hm.hour * 60 + hm.minute) * 60 * 1000);
}

/**
 * Hours inside the night window [nightStart, nightEnd]. When nightEnd <
 * nightStart the window wraps midnight, so the COMPLEMENT (the day window
 * [nightEnd, nightStart]) is contiguous within a calendar day; we subtract
 * the worked-day-window overlap from the worked-day total to get night hours.
 * Scans offset days [-1, 2] so a shift's tail in the following day's night
 * window (and a head in the previous day's) is counted.
 */
export function computeNightHours(
  clockIn: Date,
  clockOut: Date,
  nightStart: HourMinute,
  nightEnd: HourMinute,
): number {
  const totalMs = clockOut.getTime() - clockIn.getTime();
  if (totalMs <= 0) return 0;

  const dayStart = nightEnd;
  const dayEnd = nightStart;

  const startMidnight = sastMidnight(clockIn);
  let nightMs = 0;

  for (let offsetDays = -1; offsetDays <= 2; offsetDays++) {
    const mid = new Date(startMidnight.getTime() + offsetDays * MS_PER_DAY);
    const nextMid = new Date(mid.getTime() + MS_PER_DAY);

    const workedOnDayMs = overlapMs(clockIn, clockOut, mid, nextMid);
    if (workedOnDayMs === 0) continue;

    const dayPeriodStart = addSastHm(mid, dayStart);
    const dayPeriodEnd = addSastHm(mid, dayEnd);
    if (dayPeriodStart.getTime() >= dayPeriodEnd.getTime()) {
      nightMs += workedOnDayMs;
      continue;
    }

    const dayPeriodMs = overlapMs(clockIn, clockOut, dayPeriodStart, dayPeriodEnd);
    nightMs += workedOnDayMs - dayPeriodMs;
  }

  return nightMs / MS_PER_HOUR;
}
