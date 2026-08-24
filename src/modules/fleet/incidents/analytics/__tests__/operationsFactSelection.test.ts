/**
 * `factMatchesFilters` on the fact kinds that are not incidents.
 *
 * This branch is a safety net rather than a hot path: when an incident-shaped
 * filter is set the loaders for presence, monitor runs and notifications are
 * not called at all, so in production nothing ever reaches it. That is exactly
 * why it needs a direct test — a net nobody falls into is a net nobody notices
 * has a hole, and the day a caller loads those facts under a filter, this
 * predicate is the only thing standing between a presence figure and an
 * `op_type` it cannot honour.
 */
import { describe, expect, it } from 'vitest';
import { factMatchesFilters, hasIncidentShapedFilter, omittedMetricKeys } from '../operationsFactSelection';
import type { OperationsFilters } from '../types';
import { PROJECT, SITE, filters, incident, monitorRun, notification, presence } from './operationsTestFixtures';

const OTHER_SITE = 'aaaaaaa9-0000-4000-8000-000000000009';
const OTHER_PROJECT_ID = 'bbbbbbb9-0000-4000-8000-000000000009';

const nonIncidentFacts = [
  ['presence', presence()],
  ['monitor run', monitorRun()],
  ['notification', notification()],
] as const;

describe('a fact that is not an incident', () => {
  it.each(nonIncidentFacts)('passes an unfiltered request (%s)', (_kind, fact) => {
    expect(factMatchesFilters(fact, filters())).toBe(true);
  });

  it.each(nonIncidentFacts)('passes the two dimension filters it does carry (%s)', (_kind, fact) => {
    expect(factMatchesFilters(fact, filters({ projectId: PROJECT, operationalSiteId: SITE }))).toBe(true);
  });

  const incidentShaped: Array<[string, Partial<OperationsFilters>]> = [
    ['op_type', { incidentType: 'late' }],
    ['op_severity', { severity: 'high' }],
    ['op_outcome', { outcome: 'confirmed' }],
    ['op_driver', { staffId: 'someone' }],
    ['op_vehicle', { vehicleId: 'something' }],
    ['op_evidence', { evidenceAvailable: true }],
  ];

  for (const [kind, fact] of nonIncidentFacts) {
    it.each(incidentShaped)(`is excluded by %s, which a ${kind} cannot answer`, (_name, overrides) => {
      // Excluded rather than passed through: a presence figure that ignored
      // op_type would silently answer a wider question than the cards beside it.
      expect(factMatchesFilters(fact, filters(overrides))).toBe(false);
    });
  }

  it.each(nonIncidentFacts)('is still excluded by a dimension it does not match (%s)', (_kind, fact) => {
    expect(factMatchesFilters(fact, filters({ operationalSiteId: OTHER_SITE }))).toBe(false);
    expect(factMatchesFilters(fact, filters({ projectId: OTHER_PROJECT_ID }))).toBe(false);
  });
});

describe('an incident fact, for contrast', () => {
  it('is kept by the same filters that exclude the others', () => {
    expect(factMatchesFilters(incident(), filters({ incidentType: 'late' }))).toBe(true);
  });

  it('is dropped when the attribute does not match', () => {
    expect(factMatchesFilters(incident(), filters({ incidentType: 'left_early' }))).toBe(false);
  });
});

describe('the two predicates that share one definition', () => {
  it('omits the non-incident metric keys exactly when a fact kind is inapplicable', () => {
    const filtered = filters({ severity: 'high' });
    expect(hasIncidentShapedFilter(filtered)).toBe(true);
    expect([...omittedMetricKeys(filtered)]).toContain('presence.scheduled_days');
    expect(hasIncidentShapedFilter(filters({ projectId: PROJECT }))).toBe(false);
    expect([...omittedMetricKeys(filters({ projectId: PROJECT }))]).toEqual([]);
  });
});
