// Base types for procurement module
// Following FibreFlow Universal Module Structure

export interface ProcurementBase {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy?: string;
}

export interface ProjectScoped {
  projectId: string;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface ProjectScope {
  projectId: string;
  siteIds?: string[];
  phaseIds?: string[];
}

export interface AuditTrail {
  action: string;
  timestamp: Date;
  userId: string;
  changes?: Record<string, unknown>;
  reason?: string;
}

export interface Versioned {
  version: string;
  previousVersion?: string;
  versionNotes?: string;
}

export interface StatusTracked {
  status: string;
  statusChangedAt: Date;
  statusChangedBy: string;
  statusReason?: string;
}

export interface DocumentReference {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedAt: Date;
  uploadedBy: string;
}

export interface ContactInfo {
  name: string;
  email: string;
  phone?: string;
  role?: string;
}

export interface Address {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

// Common enums
export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT'
}

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REQUIRES_REVISION = 'REQUIRES_REVISION'
}

export enum NotificationStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  FAILED = 'FAILED'
}

// Base pagination interface
export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Base filter interface
export interface BaseFilter {
  search?: string;
  status?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  createdBy?: string[];
}

// Common state patterns
export interface LoadingState {
  isLoading: boolean;
  error: string | null;
}

export interface AsyncState<T> extends LoadingState {
  data: T | null;
}

export interface ListState<T> extends LoadingState {
  items: T[];
  total: number;
  filters: Record<string, unknown>;
}

// Action patterns for reducers
export interface Action<T = unknown> {
  type: string;
  payload?: T;
}