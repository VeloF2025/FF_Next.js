import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApprovalDetailPanel } from '../ApprovalDetailPanel';
import type { ApprovalRequestRecord, WorkflowType } from '../types';

const rec = (t: WorkflowType): ApprovalRequestRecord => ({
  id: 'a', documentType: t, documentId: 'd', documentNumber: 'X-1', documentAmount: 1,
  status: 'pending', requestedBy: null, requestedByName: null, requestedAt: null, requestNotes: null,
  dueDate: null, isOverdue: false, workflowName: null, levelName: null, levelNumber: 1,
  approverType: 'role', approverName: null, canAct: true,
});

describe('ApprovalDetailPanel', () => {
  it('renders fallback for a type without a rich panel', () => {
    render(<ApprovalDetailPanel record={rec('payment_request')} />);
    expect(screen.getByTestId('summary-fallback-panel')).toBeInTheDocument();
  });
});
