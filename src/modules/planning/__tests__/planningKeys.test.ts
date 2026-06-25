import { describe, it, expect } from 'vitest';
import { planningKeys } from '../hooks/usePlanningItems';

describe('planningKeys', () => {
  it('builds stable hierarchical keys', () => {
    expect(planningKeys.all).toEqual(['planning']);
    expect(planningKeys.lists()).toEqual(['planning', 'list']);
    expect(planningKeys.detail('abc')).toEqual(['planning', 'detail', 'abc']);
    expect(planningKeys.list({ project_id: 'p' })).toEqual(['planning', 'list', { project_id: 'p' }]);
  });
});
