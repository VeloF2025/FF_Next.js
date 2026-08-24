/**
 * The random configurations both the property sweep and its timing probe run on.
 *
 * Kept beside the sweep rather than inside it so a second test can generate the
 * same cases without copying the generator — a copied generator drifts, and the
 * two would then be defending different systems.
 */
import type { CalculatedMetricGroup } from '../facts';
import type { OperationsMetricKey } from '../aggregateSchema';

const MONTH = '2026-07-01';

/** Deterministic PRNG — a seeded run is reproducible, unlike Math.random. */
function makeRandom(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function configurationFor(seed: number): CalculatedMetricGroup[] {
  const random = makeRandom(seed);
  const pick = (count: number): number => Math.floor(random() * count);
  const groups: CalculatedMetricGroup[] = [];
  const add = (
    metricKey: OperationsMetricKey, projectId: string, siteId: string,
    contributors: string[], denominator: number | null,
  ): void => {
    if (contributors.length === 0) return;
    groups.push({
      monthStart: MONTH, metricVersion: 1, projectId, operationalSiteId: siteId, metricKey,
      numerator: contributors.length * (1 + pick(4)), denominator,
      histogram: null, contributors: new Set(contributors),
    });
  };

  for (let project = 0; project < 1 + pick(2); project += 1) {
    const projectId = `p${project}`;
    for (let site = 0; site < 1 + pick(3); site += 1) {
      const siteId = `${projectId}s${site}`;
      const roster = Array.from({ length: 1 + pick(8) }, (_, index) => `${siteId}-${index}`);
      const part = (): string[] => roster.slice(0, pick(roster.length + 1));
      const size = roster.length * 20;

      // `metricCalculator` bumps `presence.scheduled_days` for every staff-day
      // and exactly one of the three members alongside it, so the members COVER
      // the roster. A generator that drew them independently produced a site
      // where somebody was scheduled and yet confirmed, unconfirmed and
      // vehicle-only all missed them — impossible in production, and the oracle
      // rightly called the resulting arithmetic a disclosure.
      const presence: Record<'confirmed' | 'unconfirmed' | 'vehicle_only', string[]> = {
        confirmed: [], unconfirmed: [], vehicle_only: [],
      };
      const confirmations = ['confirmed', 'unconfirmed', 'vehicle_only'] as const;
      for (const person of roster) {
        presence[confirmations[pick(3)]!].push(person);
        // Somebody can have days of more than one kind across a month.
        if (random() < 0.25) presence[confirmations[pick(3)]!].push(person);
      }
      add('presence.scheduled_days', projectId, siteId, roster, null);
      for (const member of confirmations) {
        add(`presence.${member}_days`, projectId, siteId, [...new Set(presence[member])], size);
      }

      // Outcomes, evidence and recurrence are all bumped BY `applyIncident`, on
      // the contributor of an incident. Nobody reaches them without one.
      const incidents = new Map<string, string[]>();
      for (const kind of ['late', 'wrong_site', 'accident_sos'] as const) {
        incidents.set(kind, part());
        add(`incident.${kind}`, projectId, siteId, incidents.get(kind)!, null);
      }
      const involved = [...new Set([...incidents.values()].flat())];
      const someIncidents = (): string[] => involved.slice(0, pick(involved.length + 1));
      for (const outcome of ['confirmed', 'valid_reason', 'false_positive'] as const) {
        add(`outcome.${outcome}`, projectId, siteId, someIncidents(), size);
      }
      add('reliability.evidence_available', projectId, siteId, someIncidents(), size);
      add('reliability.recurrence', projectId, siteId, someIncidents(), size);

      const requested = part();
      add('input.requests_sent', projectId, siteId, requested, null);
      add('input.responses_received', projectId, siteId, requested.slice(0, pick(requested.length + 1)), size);
      add('input.responses_on_time', projectId, siteId, requested.slice(0, pick(requested.length + 1)), size);

      const notified = part();
      add('reliability.notifications_sent', projectId, siteId, notified, null);
      add('reliability.notifications_delivered', projectId, siteId, notified.slice(0, pick(notified.length + 1)), size);
      const expected = part();
      add('reliability.monitor_runs_expected', projectId, siteId, expected, null);
      add('reliability.monitor_runs_completed', projectId, siteId, expected.slice(0, pick(expected.length + 1)), size);
    }
  }
  return groups;
}

