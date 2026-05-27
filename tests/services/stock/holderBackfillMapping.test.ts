import { describe, it, expect } from 'vitest';
import { eligibleHolderInput, type TechLocationRow } from '@/modules/procurement/field-stock/services/holderBackfillMapping';

const row = (over: Partial<TechLocationRow> = {}): TechLocationRow => ({
  assigned_to_id: 's1', assigned_to_name: 'Tech One', assigned_to_phone: '0810000000', staff_exists: true, ...over,
});

describe('eligibleHolderInput', () => {
  it('maps a technician location backed by a real staff row', () => {
    expect(eligibleHolderInput(row())).toEqual({ staffId: 's1', name: 'Tech One', phone: '0810000000' });
  });
  it('skips a row with no assigned_to_id', () => {
    expect(eligibleHolderInput(row({ assigned_to_id: null }))).toBeNull();
  });
  it('skips a row whose assigned_to_id is not a staff member', () => {
    expect(eligibleHolderInput(row({ staff_exists: false }))).toBeNull();
  });
  it('falls back to a placeholder name only when the staff name is blank', () => {
    expect(eligibleHolderInput(row({ assigned_to_name: null }))?.name).toBe('Unknown (s1)');
  });
});
