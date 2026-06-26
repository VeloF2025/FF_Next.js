import { describe, it, expect } from 'vitest';
import { BOARD_STAGES, STAGE_LABELS, PLANNING_STAGE_TEMPLATE, buildInitialChecklists } from '../constants/stages';

describe('planning stages', () => {
  it('has the 6 on-board stages in workflow order', () => {
    expect(BOARD_STAGES.map(s => s.key)).toEqual([
      'intake', 'hld', 'lld', 'splice', 'change_control', 'as_built',
    ]);
  });

  it('labels every board stage', () => {
    for (const s of BOARD_STAGES) {
      expect(STAGE_LABELS[s.key]).toBeTruthy();
    }
    expect(STAGE_LABELS.on_hold).toBe('On Hold');
    expect(STAGE_LABELS.cancelled).toBe('Cancelled');
  });

  it('template has a gate item and at least one activity for every board stage', () => {
    for (const s of BOARD_STAGES) {
      const items = PLANNING_STAGE_TEMPLATE[s.key];
      expect(items.length).toBeGreaterThan(0);
      expect(items.some(i => i.kind === 'gate')).toBe(true);
      expect(items.some(i => i.kind === 'activity')).toBe(true);
    }
  });

  it('buildInitialChecklists returns all items not done and is a deep clone', () => {
    const a = buildInitialChecklists();
    a.intake[0].done = true;
    const b = buildInitialChecklists();
    expect(b.intake[0].done).toBe(false); // not mutated by previous clone
    expect(Object.values(a).flat().every(i => typeof i.id === 'string')).toBe(true);
  });
});
