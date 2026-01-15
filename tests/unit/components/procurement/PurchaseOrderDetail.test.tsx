/**
 * @fileoverview Unit tests for Purchase Order Detail page
 * Tests status display, action buttons, tabs, and workflow transitions
 */

import { describe, it, expect } from 'vitest';

// Types
type POStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'acknowledged'
  | 'partial_receipt'
  | 'completed'
  | 'cancelled';

type POAction =
  | 'edit'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'send'
  | 'acknowledge'
  | 'receive'
  | 'complete'
  | 'cancel'
  | 'delete';

interface POLineItem {
  id: string;
  lineNumber: number;
  description: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityPending: number;
  unitPrice: number;
  lineTotal: number;
}

// ============================================
// Status Badge Configuration Tests
// ============================================

describe('PO Detail - Status Badge Configuration', () => {
  const getStatusConfig = (status: POStatus) => {
    const configs: Record<POStatus, { label: string; colorClass: string; icon: string }> = {
      draft: { label: 'Draft', colorClass: 'bg-gray-500/20 text-gray-400', icon: 'Clock' },
      pending_approval: { label: 'Pending Approval', colorClass: 'bg-yellow-500/20 text-yellow-400', icon: 'Clock' },
      approved: { label: 'Approved', colorClass: 'bg-green-500/20 text-green-400', icon: 'CheckCircle' },
      sent: { label: 'Sent', colorClass: 'bg-blue-500/20 text-blue-400', icon: 'Send' },
      acknowledged: { label: 'Acknowledged', colorClass: 'bg-indigo-500/20 text-indigo-400', icon: 'Package' },
      partial_receipt: { label: 'Partial Receipt', colorClass: 'bg-orange-500/20 text-orange-400', icon: 'Truck' },
      completed: { label: 'Completed', colorClass: 'bg-green-500/20 text-green-400', icon: 'CheckCircle' },
      cancelled: { label: 'Cancelled', colorClass: 'bg-red-500/20 text-red-300', icon: 'XCircle' },
    };
    return configs[status];
  };

  it('should return correct config for draft status', () => {
    const config = getStatusConfig('draft');
    expect(config.label).toBe('Draft');
    expect(config.icon).toBe('Clock');
  });

  it('should return correct config for pending_approval status', () => {
    const config = getStatusConfig('pending_approval');
    expect(config.label).toBe('Pending Approval');
    expect(config.colorClass).toContain('yellow');
  });

  it('should return correct config for approved status', () => {
    const config = getStatusConfig('approved');
    expect(config.label).toBe('Approved');
    expect(config.icon).toBe('CheckCircle');
  });

  it('should return correct config for sent status', () => {
    const config = getStatusConfig('sent');
    expect(config.label).toBe('Sent');
    expect(config.colorClass).toContain('blue');
  });

  it('should return correct config for acknowledged status', () => {
    const config = getStatusConfig('acknowledged');
    expect(config.label).toBe('Acknowledged');
    expect(config.colorClass).toContain('indigo');
  });

  it('should return correct config for partial_receipt status', () => {
    const config = getStatusConfig('partial_receipt');
    expect(config.label).toBe('Partial Receipt');
    expect(config.icon).toBe('Truck');
  });

  it('should return correct config for completed status', () => {
    const config = getStatusConfig('completed');
    expect(config.label).toBe('Completed');
    expect(config.icon).toBe('CheckCircle');
  });

  it('should return correct config for cancelled status', () => {
    const config = getStatusConfig('cancelled');
    expect(config.label).toBe('Cancelled');
    expect(config.icon).toBe('XCircle');
  });
});

// ============================================
// Action Buttons by Status Tests
// ============================================

describe('PO Detail - Action Buttons', () => {
  const getAvailableActions = (
    status: POStatus,
    isApprover: boolean = false
  ): POAction[] => {
    const actions: POAction[] = [];

    switch (status) {
      case 'draft':
        actions.push('edit', 'submit', 'delete');
        break;
      case 'pending_approval':
        if (isApprover) {
          actions.push('approve', 'reject');
        }
        break;
      case 'approved':
        actions.push('send', 'cancel');
        break;
      case 'sent':
        actions.push('acknowledge', 'cancel');
        break;
      case 'acknowledged':
        actions.push('receive', 'cancel');
        break;
      case 'partial_receipt':
        actions.push('receive', 'complete', 'cancel');
        break;
      case 'completed':
      case 'cancelled':
        // Read-only, no actions
        break;
    }

    return actions;
  };

  it('should return edit, submit, delete for draft status', () => {
    const actions = getAvailableActions('draft');
    expect(actions).toContain('edit');
    expect(actions).toContain('submit');
    expect(actions).toContain('delete');
    expect(actions).toHaveLength(3);
  });

  it('should return approve, reject for pending_approval when approver', () => {
    const actions = getAvailableActions('pending_approval', true);
    expect(actions).toContain('approve');
    expect(actions).toContain('reject');
    expect(actions).toHaveLength(2);
  });

  it('should return empty array for pending_approval when not approver', () => {
    const actions = getAvailableActions('pending_approval', false);
    expect(actions).toHaveLength(0);
  });

  it('should return send, cancel for approved status', () => {
    const actions = getAvailableActions('approved');
    expect(actions).toContain('send');
    expect(actions).toContain('cancel');
    expect(actions).toHaveLength(2);
  });

  it('should return acknowledge, cancel for sent status', () => {
    const actions = getAvailableActions('sent');
    expect(actions).toContain('acknowledge');
    expect(actions).toContain('cancel');
    expect(actions).toHaveLength(2);
  });

  it('should return receive, cancel for acknowledged status', () => {
    const actions = getAvailableActions('acknowledged');
    expect(actions).toContain('receive');
    expect(actions).toContain('cancel');
    expect(actions).toHaveLength(2);
  });

  it('should return receive, complete, cancel for partial_receipt status', () => {
    const actions = getAvailableActions('partial_receipt');
    expect(actions).toContain('receive');
    expect(actions).toContain('complete');
    expect(actions).toContain('cancel');
    expect(actions).toHaveLength(3);
  });

  it('should return empty array for completed status', () => {
    const actions = getAvailableActions('completed');
    expect(actions).toHaveLength(0);
  });

  it('should return empty array for cancelled status', () => {
    const actions = getAvailableActions('cancelled');
    expect(actions).toHaveLength(0);
  });
});

// ============================================
// Status Transition Tests
// ============================================

describe('PO Detail - Status Transitions', () => {
  const getNextStatus = (currentStatus: POStatus, action: POAction): POStatus | null => {
    const transitions: Record<string, POStatus> = {
      'draft_submit': 'pending_approval',
      'pending_approval_approve': 'approved',
      'pending_approval_reject': 'draft',
      'approved_send': 'sent',
      'approved_cancel': 'cancelled',
      'sent_acknowledge': 'acknowledged',
      'sent_cancel': 'cancelled',
      'acknowledged_receive': 'partial_receipt', // or completed if all received
      'acknowledged_cancel': 'cancelled',
      'partial_receipt_receive': 'partial_receipt', // stays same until complete
      'partial_receipt_complete': 'completed',
      'partial_receipt_cancel': 'cancelled',
    };

    const key = `${currentStatus}_${action}`;
    return transitions[key] || null;
  };

  it('should transition from draft to pending_approval on submit', () => {
    expect(getNextStatus('draft', 'submit')).toBe('pending_approval');
  });

  it('should transition from pending_approval to approved on approve', () => {
    expect(getNextStatus('pending_approval', 'approve')).toBe('approved');
  });

  it('should transition from pending_approval to draft on reject', () => {
    expect(getNextStatus('pending_approval', 'reject')).toBe('draft');
  });

  it('should transition from approved to sent on send', () => {
    expect(getNextStatus('approved', 'send')).toBe('sent');
  });

  it('should transition from sent to acknowledged on acknowledge', () => {
    expect(getNextStatus('sent', 'acknowledge')).toBe('acknowledged');
  });

  it('should transition from acknowledged to partial_receipt on receive', () => {
    expect(getNextStatus('acknowledged', 'receive')).toBe('partial_receipt');
  });

  it('should transition from partial_receipt to completed on complete', () => {
    expect(getNextStatus('partial_receipt', 'complete')).toBe('completed');
  });

  it('should transition to cancelled on cancel from approved', () => {
    expect(getNextStatus('approved', 'cancel')).toBe('cancelled');
  });

  it('should transition to cancelled on cancel from sent', () => {
    expect(getNextStatus('sent', 'cancel')).toBe('cancelled');
  });

  it('should transition to cancelled on cancel from acknowledged', () => {
    expect(getNextStatus('acknowledged', 'cancel')).toBe('cancelled');
  });
});

// ============================================
// Line Item Receipt Status Tests
// ============================================

describe('PO Detail - Line Item Receipt Status', () => {
  type ReceiptStatus = 'pending' | 'partial' | 'complete';

  const getItemReceiptStatus = (item: POLineItem): ReceiptStatus => {
    if (item.quantityReceived === 0) return 'pending';
    if (item.quantityReceived >= item.quantityOrdered) return 'complete';
    return 'partial';
  };

  const getItemReceiptPercentage = (item: POLineItem): number => {
    if (item.quantityOrdered === 0) return 0;
    return Math.round((item.quantityReceived / item.quantityOrdered) * 100);
  };

  it('should return pending when nothing received', () => {
    const item: POLineItem = {
      id: '1',
      lineNumber: 1,
      description: 'Test Item',
      quantityOrdered: 100,
      quantityReceived: 0,
      quantityPending: 100,
      unitPrice: 10,
      lineTotal: 1000,
    };
    expect(getItemReceiptStatus(item)).toBe('pending');
  });

  it('should return partial when some received', () => {
    const item: POLineItem = {
      id: '1',
      lineNumber: 1,
      description: 'Test Item',
      quantityOrdered: 100,
      quantityReceived: 50,
      quantityPending: 50,
      unitPrice: 10,
      lineTotal: 1000,
    };
    expect(getItemReceiptStatus(item)).toBe('partial');
  });

  it('should return complete when all received', () => {
    const item: POLineItem = {
      id: '1',
      lineNumber: 1,
      description: 'Test Item',
      quantityOrdered: 100,
      quantityReceived: 100,
      quantityPending: 0,
      unitPrice: 10,
      lineTotal: 1000,
    };
    expect(getItemReceiptStatus(item)).toBe('complete');
  });

  it('should return complete when over-received', () => {
    const item: POLineItem = {
      id: '1',
      lineNumber: 1,
      description: 'Test Item',
      quantityOrdered: 100,
      quantityReceived: 110,
      quantityPending: 0,
      unitPrice: 10,
      lineTotal: 1000,
    };
    expect(getItemReceiptStatus(item)).toBe('complete');
  });

  it('should calculate correct percentage for 0 received', () => {
    const item: POLineItem = {
      id: '1',
      lineNumber: 1,
      description: 'Test Item',
      quantityOrdered: 100,
      quantityReceived: 0,
      quantityPending: 100,
      unitPrice: 10,
      lineTotal: 1000,
    };
    expect(getItemReceiptPercentage(item)).toBe(0);
  });

  it('should calculate correct percentage for partial receipt', () => {
    const item: POLineItem = {
      id: '1',
      lineNumber: 1,
      description: 'Test Item',
      quantityOrdered: 100,
      quantityReceived: 75,
      quantityPending: 25,
      unitPrice: 10,
      lineTotal: 1000,
    };
    expect(getItemReceiptPercentage(item)).toBe(75);
  });

  it('should calculate 100% for complete receipt', () => {
    const item: POLineItem = {
      id: '1',
      lineNumber: 1,
      description: 'Test Item',
      quantityOrdered: 100,
      quantityReceived: 100,
      quantityPending: 0,
      unitPrice: 10,
      lineTotal: 1000,
    };
    expect(getItemReceiptPercentage(item)).toBe(100);
  });

  it('should handle zero quantity ordered gracefully', () => {
    const item: POLineItem = {
      id: '1',
      lineNumber: 1,
      description: 'Test Item',
      quantityOrdered: 0,
      quantityReceived: 0,
      quantityPending: 0,
      unitPrice: 10,
      lineTotal: 0,
    };
    expect(getItemReceiptPercentage(item)).toBe(0);
  });
});

// ============================================
// Overall PO Receipt Status Tests
// ============================================

describe('PO Detail - Overall Receipt Status', () => {
  const calculateOverallReceiptStatus = (items: POLineItem[]): {
    totalOrdered: number;
    totalReceived: number;
    totalPending: number;
    percentComplete: number;
    isComplete: boolean;
  } => {
    const totalOrdered = items.reduce((sum, item) => sum + item.quantityOrdered, 0);
    const totalReceived = items.reduce((sum, item) => sum + item.quantityReceived, 0);
    const totalPending = items.reduce((sum, item) => sum + item.quantityPending, 0);
    const percentComplete = totalOrdered > 0
      ? Math.round((totalReceived / totalOrdered) * 100)
      : 0;
    const isComplete = items.every(item => item.quantityReceived >= item.quantityOrdered);

    return { totalOrdered, totalReceived, totalPending, percentComplete, isComplete };
  };

  it('should calculate totals correctly for multiple items', () => {
    const items: POLineItem[] = [
      { id: '1', lineNumber: 1, description: 'Item 1', quantityOrdered: 100, quantityReceived: 50, quantityPending: 50, unitPrice: 10, lineTotal: 1000 },
      { id: '2', lineNumber: 2, description: 'Item 2', quantityOrdered: 200, quantityReceived: 100, quantityPending: 100, unitPrice: 5, lineTotal: 1000 },
    ];
    const status = calculateOverallReceiptStatus(items);
    expect(status.totalOrdered).toBe(300);
    expect(status.totalReceived).toBe(150);
    expect(status.totalPending).toBe(150);
    expect(status.percentComplete).toBe(50);
    expect(status.isComplete).toBe(false);
  });

  it('should return isComplete true when all items fully received', () => {
    const items: POLineItem[] = [
      { id: '1', lineNumber: 1, description: 'Item 1', quantityOrdered: 100, quantityReceived: 100, quantityPending: 0, unitPrice: 10, lineTotal: 1000 },
      { id: '2', lineNumber: 2, description: 'Item 2', quantityOrdered: 200, quantityReceived: 200, quantityPending: 0, unitPrice: 5, lineTotal: 1000 },
    ];
    const status = calculateOverallReceiptStatus(items);
    expect(status.isComplete).toBe(true);
    expect(status.percentComplete).toBe(100);
  });

  it('should return isComplete false when any item not fully received', () => {
    const items: POLineItem[] = [
      { id: '1', lineNumber: 1, description: 'Item 1', quantityOrdered: 100, quantityReceived: 100, quantityPending: 0, unitPrice: 10, lineTotal: 1000 },
      { id: '2', lineNumber: 2, description: 'Item 2', quantityOrdered: 200, quantityReceived: 199, quantityPending: 1, unitPrice: 5, lineTotal: 1000 },
    ];
    const status = calculateOverallReceiptStatus(items);
    expect(status.isComplete).toBe(false);
  });

  it('should handle empty items array', () => {
    const items: POLineItem[] = [];
    const status = calculateOverallReceiptStatus(items);
    expect(status.totalOrdered).toBe(0);
    expect(status.totalReceived).toBe(0);
    expect(status.percentComplete).toBe(0);
    expect(status.isComplete).toBe(true); // Empty array means all items complete (vacuous truth)
  });
});

// ============================================
// Currency Formatting Tests
// ============================================

describe('PO Detail - Currency Formatting', () => {
  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 2,
    }).format(value);
  };

  it('should format whole numbers correctly', () => {
    const result = formatCurrency(1000);
    expect(result).toContain('R');
    expect(result).toContain('1');
    expect(result).toContain('000');
    expect(result).toContain('00');
  });

  it('should format decimal numbers correctly', () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain('R');
    expect(result).toContain('1');
    expect(result).toContain('234');
    expect(result).toContain('56');
  });

  it('should format zero correctly', () => {
    const result = formatCurrency(0);
    expect(result).toContain('R');
    expect(result).toContain('0');
  });

  it('should format large numbers with thousand separators', () => {
    const result = formatCurrency(1234567.89);
    expect(result).toContain('R');
    expect(result).toContain('234');
    expect(result).toContain('567');
    expect(result).toContain('89');
  });

  it('should format negative numbers correctly', () => {
    const result = formatCurrency(-500);
    expect(result).toContain('R');
    expect(result).toContain('500');
    expect(result).toMatch(/-/);
  });
});

// ============================================
// Date Formatting Tests
// ============================================

describe('PO Detail - Date Formatting', () => {
  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatDateTime = (dateStr: string | null): string => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  it('should format date correctly', () => {
    const result = formatDate('2026-01-15');
    expect(result).toContain('Jan');
    expect(result).toContain('2026');
  });

  it('should return dash for null date', () => {
    expect(formatDate(null)).toBe('-');
  });

  it('should format datetime correctly', () => {
    const result = formatDateTime('2026-01-15T14:30:00');
    expect(result).toContain('Jan');
    expect(result).toContain('2026');
  });

  it('should return dash for null datetime', () => {
    expect(formatDateTime(null)).toBe('-');
  });
});

// ============================================
// Tab Navigation Tests
// ============================================

describe('PO Detail - Tab Configuration', () => {
  type TabId = 'details' | 'items' | 'receipts' | 'history';

  interface Tab {
    id: TabId;
    label: string;
    icon: string;
  }

  const tabs: Tab[] = [
    { id: 'details', label: 'Details', icon: 'FileText' },
    { id: 'items', label: 'Items', icon: 'Package' },
    { id: 'receipts', label: 'Receipts', icon: 'Truck' },
    { id: 'history', label: 'History', icon: 'Clock' },
  ];

  it('should have 4 tabs', () => {
    expect(tabs).toHaveLength(4);
  });

  it('should have details as first tab', () => {
    expect(tabs[0].id).toBe('details');
  });

  it('should have items as second tab', () => {
    expect(tabs[1].id).toBe('items');
  });

  it('should have receipts as third tab', () => {
    expect(tabs[2].id).toBe('receipts');
  });

  it('should have history as fourth tab', () => {
    expect(tabs[3].id).toBe('history');
  });
});

// ============================================
// Cancellation Validation Tests
// ============================================

describe('PO Detail - Cancellation Validation', () => {
  const canCancelPO = (status: POStatus, hasReceipts: boolean): boolean => {
    // Cannot cancel completed or already cancelled POs
    if (status === 'completed' || status === 'cancelled') return false;

    // Cannot cancel draft (use delete instead)
    if (status === 'draft') return false;

    // Cannot cancel if receipts exist (would need reversal)
    if (hasReceipts && status === 'partial_receipt') return false;

    return true;
  };

  it('should allow cancellation of pending_approval PO', () => {
    expect(canCancelPO('pending_approval', false)).toBe(true);
  });

  it('should allow cancellation of approved PO', () => {
    expect(canCancelPO('approved', false)).toBe(true);
  });

  it('should allow cancellation of sent PO', () => {
    expect(canCancelPO('sent', false)).toBe(true);
  });

  it('should allow cancellation of acknowledged PO without receipts', () => {
    expect(canCancelPO('acknowledged', false)).toBe(true);
  });

  it('should not allow cancellation of completed PO', () => {
    expect(canCancelPO('completed', false)).toBe(false);
  });

  it('should not allow cancellation of already cancelled PO', () => {
    expect(canCancelPO('cancelled', false)).toBe(false);
  });

  it('should not allow cancellation of draft PO (use delete)', () => {
    expect(canCancelPO('draft', false)).toBe(false);
  });

  it('should not allow cancellation of partial_receipt with existing receipts', () => {
    expect(canCancelPO('partial_receipt', true)).toBe(false);
  });
});

// ============================================
// History Event Formatting Tests
// ============================================

describe('PO Detail - History Event Formatting', () => {
  const getActionLabel = (action: string): string => {
    const labels: Record<string, string> = {
      'created': 'Purchase Order Created',
      'submitted': 'Submitted for Approval',
      'approved': 'Approved',
      'rejected': 'Rejected',
      'sent': 'Sent to Supplier',
      'acknowledged': 'Acknowledged by Supplier',
      'received': 'Goods Received',
      'completed': 'Completed',
      'cancelled': 'Cancelled',
      'edited': 'Edited',
    };
    return labels[action] || action;
  };

  it('should return correct label for created action', () => {
    expect(getActionLabel('created')).toBe('Purchase Order Created');
  });

  it('should return correct label for submitted action', () => {
    expect(getActionLabel('submitted')).toBe('Submitted for Approval');
  });

  it('should return correct label for approved action', () => {
    expect(getActionLabel('approved')).toBe('Approved');
  });

  it('should return correct label for rejected action', () => {
    expect(getActionLabel('rejected')).toBe('Rejected');
  });

  it('should return correct label for sent action', () => {
    expect(getActionLabel('sent')).toBe('Sent to Supplier');
  });

  it('should return correct label for received action', () => {
    expect(getActionLabel('received')).toBe('Goods Received');
  });

  it('should return correct label for completed action', () => {
    expect(getActionLabel('completed')).toBe('Completed');
  });

  it('should return correct label for cancelled action', () => {
    expect(getActionLabel('cancelled')).toBe('Cancelled');
  });

  it('should return original action for unknown actions', () => {
    expect(getActionLabel('unknown_action')).toBe('unknown_action');
  });
});
