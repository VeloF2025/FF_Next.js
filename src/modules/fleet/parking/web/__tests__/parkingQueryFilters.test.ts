import { parkingQueryFilters } from '../parkingQueryFilters';

describe('parkingQueryFilters', () => {
  it('accepts a single valid date and result', () => {
    expect(parkingQueryFilters({ date: '2026-08-12', result: 'violation' })).toEqual({
      date: '2026-08-12',
      result: 'violation',
    });
  });

  it('rejects invalid calendar dates and result values', () => {
    expect(parkingQueryFilters({ date: '2026-02-30', result: 'late' })).toEqual({});
  });

  it('rejects repeated query values', () => {
    expect(parkingQueryFilters({
      date: ['2026-08-11', '2026-08-12'],
      result: ['violation', 'unknown'],
    })).toEqual({});
  });
});
