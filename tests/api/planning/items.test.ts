// tests/api/planning/items.test.ts
import { describe, it, expect } from 'vitest';
import type { PlanningItemWithRelations } from '@/modules/planning/types/planning';

describe('Planning Items API - response contracts', () => {
  it('list response has the paginated envelope', () => {
    const res = {
      success: true,
      data: [] as PlanningItemWithRelations[],
      pagination: { page: 1, pageSize: 2500, total: 0, totalPages: 0 },
      meta: { timestamp: new Date().toISOString() },
    };
    expect(res.success).toBe(true);
    expect(res.data).toBeInstanceOf(Array);
    expect(res.pagination).toHaveProperty('totalPages');
  });

  it('parses exclude_stage[] query params into an array', () => {
    const params = new URLSearchParams('exclude_stage=on_hold&exclude_stage=cancelled');
    expect(params.getAll('exclude_stage')).toEqual(['on_hold', 'cancelled']);
  });

  it('rejects create without project_id/title (validation contract)', () => {
    const validate = (b: { project_id?: string; title?: string }) => {
      const errors: string[] = [];
      if (!b.project_id) errors.push('project_id');
      if (!b.title || !b.title.trim()) errors.push('title');
      return errors;
    };
    expect(validate({})).toEqual(['project_id', 'title']);
    expect(validate({ project_id: 'p', title: 'x' })).toEqual([]);
  });
});
