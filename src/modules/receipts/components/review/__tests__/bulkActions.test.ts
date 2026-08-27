import { describe, it, expect } from 'vitest';

import { commonBulkActions, commonBulkStatus, actionLabel, ACTIONS_BY_STATUS } from '../bulkActions';
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

  it('returns approve only when every selected item is reconciled', () => {
    expect(commonBulkActions([item('reconciled', '1'), item('reconciled', '2')])).toEqual(['approve']);
  });

  it('returns no actions for a mixed-status selection', () => {
    expect(commonBulkActions([item('submitted', '1'), item('approved', '2')])).toEqual([]);
  });

  it('covers every status ACTIONS_BY_STATUS defines — fails if a status is added without a test', () => {
    const statuses = Object.keys(ACTIONS_BY_STATUS) as ReviewListItem['status'][];
    for (const status of statuses) {
      expect(commonBulkActions([item(status, '1')])).toEqual(ACTIONS_BY_STATUS[status]);
    }
  });
});

describe('commonBulkStatus', () => {
  it('returns null for an empty selection', () => {
    expect(commonBulkStatus([])).toBeNull();
  });

  it('returns the shared status for a uniform selection', () => {
    expect(commonBulkStatus([item('reconciled', '1'), item('reconciled', '2')])).toBe('reconciled');
  });

  it('returns null for a mixed-status selection', () => {
    expect(commonBulkStatus([item('submitted', '1'), item('reconciled', '2')])).toBeNull();
  });
});

describe('actionLabel', () => {
  it('overrides approve to "Undo reconcile" for reconciled receipts', () => {
    expect(actionLabel('reconciled', 'approve', 'Approve')).toBe('Undo reconcile');
  });

  it('falls back to the default label for statuses with no override', () => {
    expect(actionLabel('submitted', 'approve', 'Approve')).toBe('Approve');
    expect(actionLabel('approved', 'reject', 'Reject')).toBe('Reject');
  });
});
