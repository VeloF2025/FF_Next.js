/**
 * Facts to drive the real calculator with.
 *
 * Everything here builds `OperationsFact`s, never `CalculatedMetricGroup`s. The
 * previous design's tests fed hand-built groups straight to the release rule,
 * which meant the complements they reasoned about were reconstructed from
 * contributor sets rather than counted — and reconstructing them is exactly what
 * was wrong. Going through `metricCalculator` is what makes the supports exact.
 *
 * The generator's invariants mirror the calculator's, because a configuration
 * that cannot happen defends nothing: a scheduled day has exactly one
 * confirmation state, and an outcome, a piece of evidence or a recurrence flag
 * only exists where an incident does.
 */
import type { OperationsFact } from '../facts';

export const MONTH_DAY = '2026-07-14';

export function presence(
  projectId: string, siteId: string, contributorKey: string,
  confirmation: 'confirmed' | 'unconfirmed' | 'vehicle_only', workDate = MONTH_DAY,
): OperationsFact {
  return { kind: 'presence', workDate, dimension: { projectId, operationalSiteId: siteId }, contributorKey, confirmation };
}

export function incident(
  projectId: string, siteId: string, contributorKey: string,
  overrides: Partial<Extract<OperationsFact, { kind: 'incident' }>> = {},
): OperationsFact {
  return {
    kind: 'incident',
    workDate: MONTH_DAY,
    dimension: { projectId, operationalSiteId: siteId },
    contributorKey,
    incidentType: 'late',
    outcome: 'confirmed',
    acknowledgementSeconds: 137,
    reviewStartSeconds: 402,
    resolutionSeconds: 4271,
    driverResponseSeconds: 88,
    driverInputRequested: true,
    driverInputResponded: true,
    driverInputOnTime: true,
    evidenceAvailable: true,
    isRecurrence: false,
    ...overrides,
  };
}

export function notification(
  projectId: string, siteId: string, contributorKey: string, delivered: boolean,
): OperationsFact {
  return { kind: 'notification', workDate: MONTH_DAY, dimension: { projectId, operationalSiteId: siteId }, contributorKey, delivered };
}

export function monitorRun(
  projectId: string, siteId: string, contributorKeys: string[], completed: boolean,
): OperationsFact {
  return { kind: 'monitor_run', workDate: MONTH_DAY, dimension: { projectId, operationalSiteId: siteId }, contributorKeys, completed };
}

/** Deterministic PRNG — a seeded run is reproducible, unlike Math.random. */
export function makeRandom(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const INCIDENT_TYPES = ['late', 'wrong_site', 'accident_sos', 'evidence_gap'] as const;
const OUTCOMES = ['confirmed', 'valid_reason', 'false_positive', null] as const;

/**
 * One randomised month: up to two projects of up to two sites, rosters of one to
 * six, and incidents, notifications and monitor runs over them.
 *
 * Deliberately small. The oracle solves the reader's system in exact rationals
 * and elimination is cubic in the number of variables, which is names times
 * cells — so a third site costs more than another seed does, and variety across
 * seeds is worth more than size within one. Every relation shape is present at
 * two projects of two sites: within a cell, across metric keys, across sites
 * into a project, and across projects into the organisation.
 */
export function configurationFor(seed: number): OperationsFact[] {
  const random = makeRandom(seed);
  const pick = (count: number): number => Math.floor(random() * count);
  const facts: OperationsFact[] = [];

  // Every fourth seed is a SHARED-STAFF month: three projects, and staff drawn
  // from one pool so the same person appears at several sites and across
  // projects. Without it the sweep only ever saw rosters that partition
  // cleanly, and a contributor union is exactly the thing that behaves
  // differently when they do not — a project's support can be smaller than the
  // sum of its sites', and the organisation's smaller again.
  const shared = seed % 4 === 0;
  const pool = Array.from({ length: 9 }, (_, index) => `shared-${index}`);
  const projectCount = shared ? 3 : 1 + pick(2);

  for (let project = 0; project < projectCount; project += 1) {
    const projectId = `p${project}`;
    for (let site = 0; site < 1 + pick(2); site += 1) {
      const siteId = `${projectId}s${site}`;
      const roster = shared
        ? pool.slice(pick(4), pick(4) + 2 + pick(6))
        : Array.from({ length: 1 + pick(6) }, (_, index) => `${siteId}-${index}`);
      if (roster.length === 0) continue;
      for (const person of roster) {
        for (let day = 0; day < 1 + pick(3); day += 1) {
          facts.push(presence(projectId, siteId, person, (['confirmed', 'unconfirmed', 'vehicle_only'] as const)[pick(3)]!));
        }
      }
      for (let n = 0; n < pick(5); n += 1) {
        const person = roster[pick(roster.length)]!;
        facts.push(incident(projectId, siteId, person, {
          incidentType: INCIDENT_TYPES[pick(INCIDENT_TYPES.length)]!,
          outcome: OUTCOMES[pick(OUTCOMES.length)]!,
          driverInputRequested: random() < 0.8,
          // An on-time response is a response; the calculator enforces it, and
          // a generator that pretended otherwise would be modelling data that
          // cannot occur.
          driverInputResponded: random() < 0.6,
          driverInputOnTime: random() < 0.4,
          evidenceAvailable: random() < 0.6,
          isRecurrence: random() < 0.3,
        }));
      }
      for (let n = 0; n < pick(4); n += 1) {
        facts.push(notification(projectId, siteId, roster[pick(roster.length)]!, random() < 0.7));
      }
      if (random() < 0.7) {
        facts.push(monitorRun(projectId, siteId, roster.slice(0, 1 + pick(roster.length)), random() < 0.6));
      }
    }
  }
  return facts;
}

/**
 * The month the usability target is measured on: TWO projects — one of three
 * sites and twenty staff, one of a single site and six — and a month of
 * ordinary operations over both.
 *
 * The second project is the point. It is small enough that several of its
 * components fall short of FULL, so it is regularly one of the projects the
 * organisation would be leaving behind, which is exactly what the virtual-cell
 * rule has to reason about. A one-project fixture never exercises that.
 *
 * Six and not four, deliberately. A four-person project is below the threshold
 * outright: the residual it leaves is four people whatever rule is applied, so
 * an organisation row containing it can never be published and measuring
 * usability on it would be measuring `k`, not the rule.
 * `belowThresholdMonth` keeps that case, where it belongs.
 */
export function realisticMonth(): OperationsFact[] {
  return [
    ...projectMonth('p-velocity', [
      { id: 's-north', size: 8 }, { id: 's-central', size: 7 }, { id: 's-south', size: 5 },
    ], 20260824),
    ...projectMonth('p-pilot', [{ id: 's-pilot', size: 6 }], 20260901),
  ];
}

/** The same month with a project that cannot clear the threshold at all. */
export function belowThresholdMonth(): OperationsFact[] {
  return [
    ...projectMonth('p-velocity', [
      { id: 's-north', size: 8 }, { id: 's-central', size: 7 }, { id: 's-south', size: 5 },
    ], 20260824),
    ...projectMonth('p-tiny', [{ id: 's-tiny', size: 4 }], 20260901),
  ];
}

function projectMonth(
  projectId: string, sites: readonly { id: string; size: number }[], seed: number,
): OperationsFact[] {
  const random = makeRandom(seed);
  const facts: OperationsFact[] = [];
  for (const site of sites) {
    const roster = Array.from({ length: site.size }, (_, index) => `${site.id}-${index}`);
    for (const person of roster) {
      for (let day = 1; day <= 20; day += 1) {
        const roll = random();
        const confirmation = roll < 0.86 ? 'confirmed' : roll < 0.95 ? 'unconfirmed' : 'vehicle_only';
        facts.push(presence(projectId, site.id, person, confirmation, `2026-07-${String(day).padStart(2, '0')}`));
      }
    }
    // Roughly one incident per person per month, spread over the roster.
    for (let n = 0; n < site.size; n += 1) {
      facts.push(incident(projectId, site.id, roster[n % roster.length]!, {
        incidentType: INCIDENT_TYPES[Math.floor(random() * INCIDENT_TYPES.length)]!,
        outcome: OUTCOMES[Math.floor(random() * OUTCOMES.length)]!,
        driverInputRequested: random() < 0.9,
        driverInputResponded: random() < 0.75,
        driverInputOnTime: random() < 0.6,
        evidenceAvailable: random() < 0.7,
        isRecurrence: random() < 0.25,
      }));
    }
    for (const person of roster) facts.push(notification(projectId, site.id, person, random() < 0.9));
    facts.push(monitorRun(projectId, site.id, roster, true));
    facts.push(monitorRun(projectId, site.id, roster, random() < 0.8));
  }
  return facts;
}
