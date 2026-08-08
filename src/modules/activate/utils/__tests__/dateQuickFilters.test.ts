import { describe, it, expect } from 'vitest';

import { getMonthToDateRange } from '../dateQuickFilters';

describe('getMonthToDateRange', () => {
  it('spans the 1st of the month through the given day', () => {
    expect(getMonthToDateRange('2026-08-08')).toEqual({ from: '2026-08-01', to: '2026-08-08' });
  });

  it('is inclusive on the 1st, so the range is that single day', () => {
    expect(getMonthToDateRange('2026-08-01')).toEqual({ from: '2026-08-01', to: '2026-08-01' });
  });

  it('stays inside the month at a year boundary', () => {
    expect(getMonthToDateRange('2026-01-15')).toEqual({ from: '2026-01-01', to: '2026-01-15' });
    expect(getMonthToDateRange('2025-12-31')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('derives the month from the SAST date string, never from the host clock', () => {
    // The input is already SAST-normalised by getTodaySAST(); slicing the string
    // keeps it that way. Constructing a Date here would re-apply the host offset
    // and could roll the month back a day near midnight.
    expect(getMonthToDateRange('2026-03-01').from).toBe('2026-03-01');
  });
});
