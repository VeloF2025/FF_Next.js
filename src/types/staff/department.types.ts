/**
 * Department Types
 * Type definitions for department management
 */

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  managerId?: string;
  managerName?: string;
  isActive: boolean;
  staffCount: number;
  activeCount: number;
  onLeaveCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentListItem extends Department {
  complianceRate?: number;
}

export interface DepartmentDetail extends Department {
  staff: DepartmentStaffMember[];
  report?: DepartmentReport;
}

export interface DepartmentStaffMember {
  id: string;
  employeeId: string;
  name: string;
  position?: string;
  status: string;
  email?: string;
  phone?: string;
  joinDate?: string;
  projectCount?: number;
}

export interface DepartmentReport {
  staffByStatus: Record<string, number>;
  complianceRate: number;
  projectCount: number;
  avgTenureDays: number;
  certifications: {
    total: number;
    expiringSoon: number;
    expired: number;
  };
  recentActivity: DepartmentActivity[];
}

export interface DepartmentActivity {
  type: 'joined' | 'left' | 'status_change' | 'project_assigned';
  staffId: string;
  staffName: string;
  date: string;
  details?: string;
}

export interface CreateDepartmentRequest {
  name: string;
  code: string;
  description?: string;
  managerId?: string;
}

export interface UpdateDepartmentRequest {
  name?: string;
  code?: string;
  description?: string;
  managerId?: string | null;
  isActive?: boolean;
}

export interface DepartmentFilters {
  search?: string;
  isActive?: boolean;
  hasManager?: boolean;
}
