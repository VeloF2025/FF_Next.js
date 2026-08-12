/**
 * Telling "nothing happened" apart from "nothing was recorded".
 *
 * This is the whole reason the reporting layer exists as a layer rather than a set of
 * counts. FibreFlow's stores do not cover projects uniformly, and a bare zero is the
 * most dangerous number a report can print — it reads as a fact about the site when it
 * is usually a fact about the data:
 *
 *   Thembisa POP 2  30,682 SOW drops, 0 poles   → genuinely not started (status planning)
 *   Tonga                0 SOW drops, 1,360 poles → work done, scope never imported
 *   Middelburg           0 SOW drops, 51 poles, status "planning" → status is stale
 *
 * A percentage built on an absent denominator is worse still: it is not zero, it is
 * undefined, and printing 0% for Tonga would say the opposite of the truth.
 */

/** Why a metric has no value, when it has none. */
export type Absence =
  | 'no-scope-recorded'
  | 'no-data-in-store'
  | 'not-started'
  | 'no-baseline';

export interface Measure {
  /** The count, always present — a store with no rows genuinely measured zero. */
  value: number;
  /** True when this store holds nothing at all for the project. */
  storeEmpty: boolean;
}

export interface Ratio {
  /** null whenever the denominator is absent or zero — never a misleading 0. */
  percent: number | null;
  of: number | null;
  /** Set when `percent` is null, saying which kind of absence caused it. */
  absent?: Absence;
  note?: string;
}

export function measure(value: number): Measure {
  return { value, storeEmpty: value === 0 };
}

/**
 * A completion ratio that refuses to invent a denominator.
 *
 * `scope` of 0 means the SOW was never imported for this project, NOT that the project
 * has no work in it — 1,360 poles have been built at Tonga against an empty SOW.
 */
export function ratio(done: number, scope: number, projectStatus?: string | null): Ratio {
  if (scope > 0) {
    return { percent: Math.round((done / scope) * 1000) / 10, of: scope };
  }
  if (done > 0) {
    return {
      percent: null,
      of: null,
      absent: 'no-scope-recorded',
      note:
        `${done} recorded, but no SOW scope is imported for this project, so there is ` +
        'no denominator. This is a missing import, not zero progress — do not report a percentage.',
    };
  }
  return {
    percent: null,
    of: null,
    absent: projectStatus === 'planning' ? 'not-started' : 'no-data-in-store',
    note:
      projectStatus === 'planning'
        ? 'Nothing recorded and the project is still in planning — consistent with not started.'
        : 'Nothing recorded in this store. Cannot distinguish "not started" from "not captured".',
  };
}

/**
 * Weekly throughput and what it implies, stated as a rate and never as a date.
 *
 * FibreFlow holds no maintained schedule — `progress_percentage` is 0 on all 21 projects,
 * `planning_items` has one row — so "on track" and "behind" are not computable here. A
 * run rate is, and it is honest: it says what the site is doing, not what a plan said.
 */
export interface Throughput {
  last7Days: number;
  prior7Days: number;
  /** Positive means accelerating. null when the prior week is zero (no baseline to divide by). */
  changePercent: number | null;
  /** Weeks to finish the remaining scope at the current rate. null without both. */
  weeksRemainingAtCurrentRate: number | null;
  note: string;
}

/**
 * Beyond this, a run-rate projection stops being information.
 *
 * Etwatwa measured 2 poles in the last 7 days against 19,515 remaining — arithmetically
 * 9,758 weeks, or 187 years. Printing that invites the whole report to be dismissed; the
 * honest reading is that the current rate is too low to project from, which is a real
 * finding in itself and is said in words instead.
 */
const MAX_PROJECTABLE_WEEKS = 260; // five years

export function throughput(last7: number, prior7: number, remaining: number | null): Throughput {
  const changePercent =
    prior7 > 0 ? Math.round(((last7 - prior7) / prior7) * 1000) / 10 : null;

  const rawWeeks = remaining !== null && last7 > 0 ? Math.ceil(remaining / last7) : null;
  const weeks = rawWeeks !== null && rawWeeks <= MAX_PROJECTABLE_WEEKS ? rawWeeks : null;

  const parts = ['Rate only. FibreFlow holds no maintained schedule, so "on track" and "behind" cannot be computed — this is throughput against SOW scope, not against a plan.'];
  if (weeks === null && remaining !== null && last7 === 0) {
    parts.push('No poles recorded in the last 7 days, so no completion estimate is possible.');
  }
  if (rawWeeks !== null && weeks === null) {
    parts.push(
      `At ${last7} in the last 7 days there is too little movement to project completion ` +
        `(${remaining} remaining would take over ${Math.floor(MAX_PROJECTABLE_WEEKS / 52)} years at this rate). ` +
        'Treat the rate itself as the finding.',
    );
  }
  if (changePercent === null && prior7 === 0) {
    parts.push('Nothing recorded the prior week, so the week-on-week change has no baseline.');
  }

  return {
    last7Days: last7,
    prior7Days: prior7,
    changePercent,
    weeksRemainingAtCurrentRate: weeks,
    note: parts.join(' '),
  };
}
