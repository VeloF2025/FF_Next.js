// Main procurement types based on the spec
// Following FibreFlow Universal Module Structure

import { ProcurementBase, ProjectScoped, Money } from './base.types';

/** Procurement-specific project shape (extends ProcurementBase + ProjectScoped) */
export interface ProcurementProject extends ProcurementBase, ProjectScoped {
  name: string;
  code: string;
  status: ProjectStatus;
  budget: ProjectBudget;
  procurement: ProcurementConfig;
}

/** @deprecated Use ProcurementProject instead */
export type Project = ProcurementProject;

export interface ProjectBudget {
  total: Money;
  allocated: Money;
  spent: Money;
  committed: Money;
  available: Money;
}

export interface ProcurementConfig {
  approvalLimits: ApprovalLimits;
  defaultTerms: DefaultTerms;
  requiredDocuments: string[];
  autoApprovalRules: AutoApprovalRule[];
}

export interface ApprovalLimits {
  managerLimit: Money;
  directorLimit: Money;
  boardLimit: Money;
}

export interface DefaultTerms {
  paymentTerms: string;
  deliveryTerms: string;
  warrantyPeriod: number;
  retentionPercentage: number;
}

export interface AutoApprovalRule {
  id: string;
  name: string;
  conditions: ApprovalCondition[];
  approvalLevel: ApprovalLevel;
  isActive: boolean;
}

export interface ApprovalCondition {
  field: string;
  operator: 'equals' | 'greater' | 'less' | 'contains';
  value: any;
}

export enum ProjectStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export enum ApprovalLevel {
  AUTOMATIC = 'AUTOMATIC',
  MANAGER = 'MANAGER',
  DIRECTOR = 'DIRECTOR',
  BOARD = 'BOARD'
}

// Context and State Management
export interface ProcurementContextState {
  currentProject: Project | null;
  permissions: ProcurementPermissions;
  boqs: any[]; // Will be properly typed
  rfqs: any[]; // Will be properly typed
  stockPositions: any[]; // Will be properly typed
  loading: {
    boqs: boolean;
    rfqs: boolean;
    stock: boolean;
    projects: boolean;
  };
  errors: {
    boqs: string | null;
    rfqs: string | null;
    stock: string | null;
    projects: string | null;
  };
}

export interface ProcurementPermissions {
  canViewBOQ: boolean;
  canEditBOQ: boolean;
  canViewRFQ: boolean;
  canCreateRFQ: boolean;
  canViewQuotes: boolean;
  canEvaluateQuotes: boolean;
  canViewPurchaseOrders: boolean;
  canCreatePurchaseOrders: boolean;
  canAccessStock: boolean;
  canManageStock: boolean;
  canApproveOrders: boolean;
  canViewSuppliers: boolean;
  canEditSuppliers: boolean;
  canManageSuppliers: boolean;
  canAccessReports: boolean;
  role: 'admin' | 'manager' | 'user' | 'viewer';
  approvalLimit: number;
}

export type ProcurementAction = 
  | { type: 'SET_PROJECT'; payload: Project }
  | { type: 'SET_PERMISSIONS'; payload: ProcurementPermissions }
  | { type: 'LOAD_BOQS_START' }
  | { type: 'LOAD_BOQS_SUCCESS'; payload: any[] }
  | { type: 'LOAD_BOQS_ERROR'; payload: string }
  | { type: 'LOAD_RFQS_START' }
  | { type: 'LOAD_RFQS_SUCCESS'; payload: any[] }
  | { type: 'LOAD_RFQS_ERROR'; payload: string }
  | { type: 'LOAD_STOCK_START' }
  | { type: 'LOAD_STOCK_SUCCESS'; payload: any[] }
  | { type: 'LOAD_STOCK_ERROR'; payload: string };

// Navigation and routing types
export interface ProcurementRouteParams {
  projectId?: string;
  boqId?: string;
  rfqId?: string;
  quoteId?: string;
  supplierId?: string;
  orderId?: string;
}

export interface ProcurementBreadcrumb {
  label: string;
  path?: string;
  isActive?: boolean;
}

export interface ProcurementPageMeta {
  title: string;
  breadcrumbs: ProcurementBreadcrumb[];
  actions?: React.ReactNode;
  helpText?: string;
}

// Dashboard and analytics types
export interface ProcurementKPI {
  id: string;
  name: string;
  value: number | string;
  trend: 'up' | 'down' | 'stable';
  trendValue: number;
  format: 'number' | 'currency' | 'percentage' | 'text';
  description?: string;
}

export interface ProcurementAlert {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
  dismissible: boolean;
  createdAt: Date;
}

export interface ProcurementQuickAction {
  id: string;
  label: string;
  icon: React.ComponentType;
  url: string;
  description?: string;
  permissions?: string[];
}