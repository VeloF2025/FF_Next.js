/**
 * Base Types for Procurement Module
 * Shared interfaces and types used across procurement components
 */

export interface ProcurementContext {
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  permissions: ProcurementPermissions;
  metadata?: Record<string, unknown>;
}

export interface ProcurementPermissions {
  canCreateBOQ: boolean;
  canEditBOQ: boolean;
  canDeleteBOQ: boolean;
  canApproveBOQ: boolean;
  canCreateRFQ: boolean;
  canEditRFQ: boolean;
  canDeleteRFQ: boolean;
  canCreatePO: boolean;
  canEditPO: boolean;
  canDeletePO: boolean;
  canApprovePO: boolean;
  canManageStock: boolean;
  canViewReports: boolean;
  isAdmin: boolean;
}

export interface ProcurementUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department?: string;
}

export interface ProcurementMetadata {
  createdAt: Date;
  createdBy: string;
  updatedAt?: Date;
  updatedBy?: string;
  version?: string;
  tags?: string[];
  notes?: string;
}

export interface ProcurementFilter {
  projectId?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  searchTerm?: string;
  tags?: string[];
  createdBy?: string;
  [key: string]: unknown;
}

export interface ProcurementSortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ProcurementPaginationOptions {
  page: number;
  pageSize: number;
  total?: number;
}

export interface ProcurementResponse<T> {
  data: T;
  success: boolean;
  message?: string;
  error?: string;
  metadata?: {
    page?: number;
    pageSize?: number;
    total?: number;
    timestamp?: Date;
  };
}

export type GeneralProcurementStatus = 
  | 'draft'
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled'
  | 'archived';

export type ProcurementAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'archive'
  | 'restore';

export interface ProcurementAuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: ProcurementAction;
  userId: string;
  userName: string;
  timestamp: Date;
  details?: Record<string, unknown>;
  previousValue?: unknown;
  newValue?: unknown;
}