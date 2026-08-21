/**
 * staffSite — site resolution and picker visibility.
 *
 * Fixtures use the REAL production values, not placeholders: the project names
 * and warehouse-to-project pairs below are the ones migration 514 writes, and
 * the spelling disagreements between warehouse and project names ('Tembisa 1'
 * vs 'Thembisa POP 1') are exactly why this must compare IDs and never names.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveStaffSite,
  matchStaffToStore,
  isVisibleByDefault,
  type SiteMatch,
} from '../staffSite';

// Real project ids are uuids; using distinguishable uuid-shaped values so a
// bug that compares the wrong field cannot pass by accident.
const POP1 = '11111111-1111-4111-8111-111111111111'; // Thembisa POP 1
const LAWLEY = '22222222-2222-4222-8222-222222222222'; // Lawley

describe('resolveStaffSite', () => {
  it('admin assignment wins over the self-declaration', () => {
    const site = resolveStaffSite({
      assignedProjectId: LAWLEY,
      assignedProjectName: 'Lawley',
      declaredProjectId: POP1,
      declaredProjectName: 'Thembisa POP 1',
    });
    expect(site.projectId).toBe(LAWLEY);
    expect(site.source).toBe('assigned');
  });

  it('falls back to the declaration when no admin assignment exists', () => {
    const site = resolveStaffSite({
      assignedProjectId: null,
      declaredProjectId: POP1,
      declaredProjectName: 'Thembisa POP 1',
    });
    expect(site.projectId).toBe(POP1);
    expect(site.source).toBe('declared');
  });

  it('reports no site when neither is set', () => {
    const site = resolveStaffSite({ assignedProjectId: null, declaredProjectId: null });
    expect(site.projectId).toBeNull();
    expect(site.source).toBe('none');
  });
});

describe('matchStaffToStore', () => {
  const at = (projectId: string | null) => resolveStaffSite({
    assignedProjectId: projectId, declaredProjectId: null,
  });

  it('matches a person to the store on their own site', () => {
    expect(matchStaffToStore(at(POP1), POP1)).toBe('match');
  });

  it('marks a person from another site as elsewhere', () => {
    expect(matchStaffToStore(at(LAWLEY), POP1)).toBe('elsewhere');
  });

  it('does not judge a person whose site is unknown', () => {
    expect(matchStaffToStore(at(null), POP1)).toBe('unknown-staff');
  });

  it('treats a store with no project as unmapped, whoever the person is', () => {
    // The state of all 17 warehouses before migration 514, and the state any
    // warehouse Hein has not mapped stays in.
    expect(matchStaffToStore(at(LAWLEY), null)).toBe('unmapped-store');
    expect(matchStaffToStore(at(null), null)).toBe('unmapped-store');
  });
});

describe('isVisibleByDefault', () => {
  // The whole point of the feature: exactly ONE case is hidden.
  const cases: Array<[SiteMatch, boolean]> = [
    ['match', true],
    ['elsewhere', false],
    ['unknown-staff', true],
    ['unmapped-store', true],
  ];

  it.each(cases)('%s -> visible=%s', (match, visible) => {
    expect(isVisibleByDefault(match)).toBe(visible);
  });

  it('hides ONLY people known to work at a different site', () => {
    const hidden = cases.filter(([, v]) => !v).map(([m]) => m);
    expect(hidden).toEqual(['elsewhere']);
  });
});

describe('the failure this prevents', () => {
  it('never hides someone because of missing data', () => {
    // A casual who has not declared and has no assignment must still be
    // issuable. Hiding them would make stock un-issuable to a real worker,
    // which is worse than showing one extra name.
    const undeclared = resolveStaffSite({ assignedProjectId: null, declaredProjectId: null });
    expect(isVisibleByDefault(matchStaffToStore(undeclared, POP1))).toBe(true);
  });

  it('compares ids, not names — warehouse and project names disagree', () => {
    // 'Tembisa 1' (warehouse) serves 'Thembisa POP 1' (project). Any
    // implementation that compared names would return elsewhere here.
    const worker = resolveStaffSite({
      assignedProjectId: POP1, assignedProjectName: 'Thembisa POP 1', declaredProjectId: null,
    });
    expect(matchStaffToStore(worker, POP1)).toBe('match');
  });
});
