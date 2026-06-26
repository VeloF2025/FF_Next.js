import { describe, it, expect } from 'vitest';
import { buildUpdateSql, PLANNING_FIELD_MAP } from '../services/planningService';
import type { UpdatePlanningItemPayload } from '../types/planning';

describe('buildUpdateSql', () => {
  it('maps only known fields to parameterized assignments and always bumps updated_at', () => {
    const { setSql, values } = buildUpdateSql({ stage: 'hld', title: 'X', bogus: 1 } as unknown as UpdatePlanningItemPayload);
    expect(setSql).toContain('stage = $1');
    expect(setSql).toContain('title = $2');
    expect(setSql).toContain('updated_at = NOW()');
    expect(setSql).not.toContain('bogus');
    expect(values).toEqual(['hld', 'X']);
  });

  it('serializes stage_checklists to JSON', () => {
    const checklists = { intake: [{ id: 'x', label: 'y', kind: 'gate', done: true }] };
    const { setSql, values } = buildUpdateSql({ stage_checklists: checklists } as unknown as UpdatePlanningItemPayload);
    expect(setSql).toContain('stage_checklists = $1');
    expect(typeof values[0]).toBe('string');
    expect(JSON.parse(values[0] as string)).toEqual(checklists);
  });

  it('sets closed_at when stage becomes cancelled', () => {
    const { setSql } = buildUpdateSql({ stage: 'cancelled' } as UpdatePlanningItemPayload);
    expect(setSql).toContain('closed_at = NOW()');
  });

  it('exposes a field map covering the editable columns', () => {
    expect(Object.keys(PLANNING_FIELD_MAP).sort()).toEqual(
      ['assigned_to', 'description', 'priority', 'scope_area', 'stage', 'stage_checklists', 'title'].sort(),
    );
  });
});
