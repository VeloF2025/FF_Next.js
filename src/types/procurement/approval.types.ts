// ============= Approval Workflow Types =============
// PRD-050: Comprehensive Procurement Portal - Phase 1

// Status and type enums
export type WorkflowType =
  | 'purchase_requisition'
  | 'purchase_order'
  | 'boq'
  | 'rfq'
  | 'goods_receipt'
  | 'supplier_registration'
  | 'payment_request';

export type ApproverType =
  | 'user'
  | 'role'
  | 'department_head'
  | 'project_manager'
  | 'any_of_group';

export type ApprovalRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'escalated'
  | 'skipped'
  | 'cancelled';

export type ApprovalHistoryAction =
  | 'created'
  | 'assigned'
  | 'viewed'
  | 'approved'
  | 'rejected'
  | 'escalated'
  | 'delegated'
  | 'skipped'
  | 'cancelled'
  | 'reminded';

// ============= Approval Workflow =============

export interface ApprovalWorkflow {
  id: string;

  // Workflow identification
  workflowType: WorkflowType;
  name: string;
  description?: string;

  // Workflow settings
  isActive: boolean;
  isMandatory: boolean;
  allowSkip: boolean;
  autoApproveIfNoLevels: boolean;

  // Notification settings
  notifyOnSubmit: boolean;
  notifyOnApprove: boolean;
  notifyOnReject: boolean;
  notifyEscalation: boolean;

  // Escalation settings
  escalationEnabled: boolean;
  escalationHours: number;
  escalationTo?: string;

  createdBy?: string;
  createdAt: string;
  updatedAt: string;

  // Levels
  levels?: ApprovalLevel[];
}

// ============= Approval Level =============

export interface ApprovalLevel {
  id: string;
  workflowId: string;

  // Level configuration
  levelNumber: number;
  name: string;
  description?: string;

  // Threshold (when this level applies)
  minAmount: number;
  maxAmount?: number; // NULL means no upper limit

  // Who can approve
  approverType: ApproverType;
  approverUserId?: string;
  approverRole?: string;
  approverGroupIds?: string[];

  // Level settings
  isRequired: boolean;
  canDelegate: boolean;
  autoApprove: boolean;
  autoApproveCondition?: string; // JSON condition

  // Ordering
  sortOrder: number;

  createdAt: string;
}

// ============= Approval Request =============

export interface ApprovalRequest {
  id: string;
  workflowId: string;
  levelId: string;

  // Document being approved
  documentType: string;
  documentId: string;
  documentNumber?: string;
  documentAmount?: number;

  // Request details
  requestedBy: string;
  requestedByName?: string;
  requestedAt: string;
  requestNotes?: string;

  // Current assignee
  assignedTo?: string;
  assignedToName?: string;
  assignedAt?: string;

  // Response
  status: ApprovalRequestStatus;
  respondedBy?: string;
  respondedByName?: string;
  respondedAt?: string;
  responseNotes?: string;

  // Delegation
  delegatedFrom?: string;
  delegatedAt?: string;
  delegationReason?: string;

  // Escalation
  escalatedTo?: string;
  escalatedAt?: string;
  escalationReason?: string;

  // Due date
  dueDate?: string;
  isOverdue: boolean;

  // Tracking
  reminderSentAt?: string;
  reminderCount: number;

  // Related data
  workflow?: ApprovalWorkflow;
  level?: ApprovalLevel;
  history?: ApprovalHistory[];

  createdAt: string;
  updatedAt: string;
}

// ============= Approval History =============

export interface ApprovalHistory {
  id: string;
  approvalRequestId: string;

  // Action
  action: ApprovalHistoryAction;

  // Actor
  performedBy: string;
  performedByName?: string;
  performedAt: string;

  // Details
  fromStatus?: string;
  toStatus?: string;
  notes?: string;
  metadata?: Record<string, unknown>;

  createdAt: string;
}

// ============= Form Types =============

export interface CreateWorkflowRequest {
  workflowType: WorkflowType;
  name: string;
  description?: string;
  isMandatory?: boolean;
  allowSkip?: boolean;
  notifyOnSubmit?: boolean;
  notifyOnApprove?: boolean;
  notifyOnReject?: boolean;
  escalationEnabled?: boolean;
  escalationHours?: number;
  escalationTo?: string;
  levels?: CreateApprovalLevelRequest[];
}

export interface CreateApprovalLevelRequest {
  levelNumber: number;
  name: string;
  description?: string;
  minAmount: number;
  maxAmount?: number;
  approverType: ApproverType;
  approverUserId?: string;
  approverRole?: string;
  approverGroupIds?: string[];
  isRequired?: boolean;
  canDelegate?: boolean;
  autoApprove?: boolean;
  autoApproveCondition?: string;
}

export interface SubmitForApprovalRequest {
  documentType: WorkflowType;
  documentId: string;
  documentNumber?: string;
  documentAmount?: number;
  notes?: string;
}

export interface ApproveRequest {
  requestId: string;
  notes?: string;
}

export interface RejectRequest {
  requestId: string;
  reason: string;
}

export interface DelegateRequest {
  requestId: string;
  delegateTo: string;
  reason: string;
}

export interface EscalateRequest {
  requestId: string;
  escalateTo: string;
  reason: string;
}

// ============= List & Filter Types =============

export interface ApprovalRequestFilters {
  workflowType?: WorkflowType;
  documentType?: string;
  status?: ApprovalRequestStatus[];
  assignedTo?: string;
  requestedBy?: string;
  isOverdue?: boolean;
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface ApprovalRequestListItem {
  id: string;
  workflowName: string;
  levelName: string;
  documentType: string;
  documentNumber?: string;
  documentAmount?: number;
  requestedByName?: string;
  requestedAt: string;
  assignedToName?: string;
  status: ApprovalRequestStatus;
  dueDate?: string;
  isOverdue: boolean;
}

export interface PendingApprovalsCount {
  total: number;
  byType: Record<WorkflowType, number>;
  overdue: number;
}

// ============= My Approvals View =============

export interface MyApprovalTask {
  id: string;
  documentType: WorkflowType;
  documentId: string;
  documentNumber?: string;
  documentAmount?: number;
  documentTitle?: string;

  workflowName: string;
  levelName: string;
  levelNumber: number;

  requestedBy: string;
  requestedByName?: string;
  requestedAt: string;
  requestNotes?: string;

  dueDate?: string;
  isOverdue: boolean;
  reminderCount: number;

  // Quick actions
  canApprove: boolean;
  canReject: boolean;
  canDelegate: boolean;
  canEscalate: boolean;
}

// ============= Workflow Configuration =============

export interface WorkflowConfig {
  workflowType: WorkflowType;
  displayName: string;
  description: string;
  icon: string;
  color: string;
  defaultLevels: DefaultLevelConfig[];
}

export interface DefaultLevelConfig {
  name: string;
  minAmount: number;
  maxAmount?: number;
  approverRole: string;
}

// Predefined workflow configurations
export const WORKFLOW_CONFIGS: Record<WorkflowType, WorkflowConfig> = {
  purchase_requisition: {
    workflowType: 'purchase_requisition',
    displayName: 'Purchase Requisition',
    description: 'Approval for material/service requests',
    icon: 'FileText',
    color: 'blue',
    defaultLevels: [
      { name: 'Auto-approve (Low Value)', minAmount: 0, maxAmount: 10000, approverRole: 'auto' },
      { name: 'Manager Approval', minAmount: 10000, maxAmount: 50000, approverRole: 'manager' },
      { name: 'Director Approval', minAmount: 50000, approverRole: 'director' },
    ],
  },
  purchase_order: {
    workflowType: 'purchase_order',
    displayName: 'Purchase Order',
    description: 'Approval for purchase orders to suppliers',
    icon: 'ShoppingCart',
    color: 'green',
    defaultLevels: [
      { name: 'Manager Approval', minAmount: 0, maxAmount: 25000, approverRole: 'manager' },
      { name: 'Director Approval', minAmount: 25000, maxAmount: 100000, approverRole: 'director' },
      { name: 'Executive Approval', minAmount: 100000, approverRole: 'executive' },
    ],
  },
  boq: {
    workflowType: 'boq',
    displayName: 'Bill of Quantities',
    description: 'Approval for project BOQs',
    icon: 'List',
    color: 'purple',
    defaultLevels: [
      { name: 'Project Manager', minAmount: 0, approverRole: 'project_manager' },
    ],
  },
  rfq: {
    workflowType: 'rfq',
    displayName: 'Request for Quotation',
    description: 'Approval for RFQ submissions',
    icon: 'Send',
    color: 'orange',
    defaultLevels: [
      { name: 'Procurement Manager', minAmount: 0, approverRole: 'procurement_manager' },
    ],
  },
  goods_receipt: {
    workflowType: 'goods_receipt',
    displayName: 'Goods Receipt',
    description: 'Approval for goods receipt with discrepancies',
    icon: 'Package',
    color: 'teal',
    defaultLevels: [
      { name: 'Warehouse Manager', minAmount: 0, approverRole: 'warehouse_manager' },
    ],
  },
  supplier_registration: {
    workflowType: 'supplier_registration',
    displayName: 'Supplier Registration',
    description: 'Approval for new supplier onboarding',
    icon: 'Users',
    color: 'indigo',
    defaultLevels: [
      { name: 'Procurement Manager', minAmount: 0, approverRole: 'procurement_manager' },
      { name: 'Finance Review', minAmount: 0, approverRole: 'finance' },
    ],
  },
  payment_request: {
    workflowType: 'payment_request',
    displayName: 'Payment Request',
    description: 'Approval for supplier payments',
    icon: 'DollarSign',
    color: 'emerald',
    defaultLevels: [
      { name: 'Finance Officer', minAmount: 0, maxAmount: 50000, approverRole: 'finance_officer' },
      { name: 'Finance Manager', minAmount: 50000, maxAmount: 200000, approverRole: 'finance_manager' },
      { name: 'CFO Approval', minAmount: 200000, approverRole: 'cfo' },
    ],
  },
};
