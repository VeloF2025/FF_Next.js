export type WorkflowType =
  | 'purchase_requisition'
  | 'purchase_order'
  | 'boq'
  | 'rfq'
  | 'goods_receipt'
  | 'supplier_registration'
  | 'payment_request';

/** One row from approval_requests, as returned by GET /api/procurement/approvals/[id]. */
export interface ApprovalRequestRecord {
  id: string;
  documentType: WorkflowType;
  documentId: string;
  documentNumber: string | null;
  documentAmount: number | null;
  status: 'pending' | 'waiting' | 'approved' | 'rejected' | 'on_hold' | 'cancelled';
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string | null;
  requestNotes: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  workflowName: string | null;
  levelName: string | null;
  levelNumber: number | null;
  approverType: 'user' | 'role' | 'department_head' | 'project_manager' | 'any_of_group';
  approverName: string | null;
  /** Server-computed: may the current user act on this request right now? */
  canAct: boolean;
}

export type ApprovalActionType = 'approve' | 'reject' | 'park';
