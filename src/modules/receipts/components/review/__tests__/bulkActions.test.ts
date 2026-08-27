import { describe, it, expect } from 'vitest';

import { commonBulkActions } from '../bulkActions';
import type { ReviewListItem } from '../types';

function item(status: ReviewListItem['status'], id = '1'): ReviewListItem {
  return { id, status } as ReviewListItem;
}

describe('commonBulkActions', () => {
  it('returns no actions for an empty selection', () => {
    expect(commonBulkActions([])).toEqual([]);
  });

  it('returns approve + reject when every selected item is submitted', () => {
    expect(commonBulkActions([item('submitted', '1'), item('submitted', '2')])).toEqual([
      'approve',
      'reject',
    ]);
  });

  it('returns reconcile + reject when every selected item is approved', () => {
    expect(commonBulkActions([item('approved', '1'), item('approved', '2')])).toEqual([
      'reconcile',
      'reject',
    ]);
  });

  it('returns approve only when every selected item is rejected', () => {
    expect(commonBulkActions([item('rejected', '1')])).toEqual(['approve']);
  });

  it('returns no actions for a mixed-status selection', () => {
    expect(commonBulkActions([item('submitted', '1'), item('approved', '2')])).toEqual([]);
  });
});
