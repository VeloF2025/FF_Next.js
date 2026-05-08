import { describe, it, expect } from 'vitest';
import {
  proposedDepartmentDefault,
  PROPOSED_DEPARTMENT_DEFAULTS,
  type ArchetypeKind,
} from '../proposedDepartmentDefaults';

describe('proposedDepartmentDefault', () => {
  it('maps every department from the spec to a valid archetype', () => {
    const validKinds: ReadonlyArray<ArchetypeKind> = ['project', 'mobile', 'office'];
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

  it('matches the spec seed values exactly', () => {
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Civil']).toBe('project');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['NOC']).toBe('mobile');
    expect(PROPOSED_DEPARTMENT_DEFAULTS['Procurement']).toBe('office');
  });
});
