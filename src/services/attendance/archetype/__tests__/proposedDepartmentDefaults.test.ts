import { describe, it, expect } from 'vitest';
import {
  proposedDepartmentDefault,
  PROPOSED_DEPARTMENT_DEFAULTS,
  type ArchetypeResolved,
} from '../proposedDepartmentDefaults';

describe('proposedDepartmentDefault', () => {
  it('maps every department from the spec to a valid archetype', () => {
    const validKinds: ReadonlyArray<ArchetypeResolved> = ['project', 'mobile', 'office'];
    for (const dept of [
      'Civil', 'Optical', 'field_operations',
      'NOC', 'Maintenance', 'Project Management',
      'Procurement', 'Commercial & Strategy', 'Planning', 'General',
    ]) {
      const a = proposedDepartmentDefault(dept);
      expect(validKinds).toContain(a);
    }
  });

  it('returns "office" as the safe fallback for unknown departments', () => {
    expect(proposedDepartmentDefault('Acquisitions')).toBe('office');
    expect(proposedDepartmentDefault(null)).toBe('office');
    expect(proposedDepartmentDefault('')).toBe('office');
  });

  it('matches the spec seed values exactly for all 10 departments', () => {
    // Guards against transposition errors (e.g. accidentally flipping Maintenance to office).
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Civil']).toBe('project');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Optical']).toBe('project');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['field_operations']).toBe('project');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['NOC']).toBe('mobile');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Maintenance']).toBe('mobile');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Project Management']).toBe('mobile');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Procurement']).toBe('office');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Commercial & Strategy']).toBe('office');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Planning']).toBe('office');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['General']).toBe('office');
  });
});
