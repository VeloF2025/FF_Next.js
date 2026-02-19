import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Permission, UserRole } from '@/types/auth.types';
import type { ProcurementPermissions } from '@/types/procurement/portal.types';

/**
 * Hook for procurement-specific permissions
 * Uses real AuthContext RBAC to determine capabilities
 */
export function useProcurementPermissions(projectId?: string): ProcurementPermissions {
  const { currentUser, hasPermission, hasAnyRole } = useAuth();

  return useMemo(() => {
    // Determine role mapping for procurement context
    const isAdmin = hasAnyRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]);
    const isManager = hasAnyRole([UserRole.PROJECT_MANAGER]);
    const isSupervisor = hasAnyRole([UserRole.SITE_SUPERVISOR]);
    const isTechnician = hasAnyRole([UserRole.FIELD_TECHNICIAN]);
    const isContractor = hasAnyRole([UserRole.CONTRACTOR]);

    const canReadStock = hasPermission(Permission.STOCK_READ);
    const canWriteStock = hasPermission(Permission.STOCK_CREATE) || hasPermission(Permission.STOCK_UPDATE);
    const canReadBOQ = hasPermission(Permission.BOQ_READ);
    const canWriteBOQ = hasPermission(Permission.BOQ_CREATE) || hasPermission(Permission.BOQ_UPDATE);
    const canReadReports = hasPermission(Permission.REPORTS_READ);

    // Determine procurement role
    let role: ProcurementPermissions['role'] = 'viewer';
    if (isAdmin) role = 'admin';
    else if (isManager) role = 'manager';
    else if (isSupervisor || isTechnician) role = 'user';

    // Approval limits by role
    let approvalLimit = 0;
    if (isAdmin) approvalLimit = 1000000;
    else if (isManager) approvalLimit = 500000;
    else if (isSupervisor) approvalLimit = 100000;

    // When no project is selected (All Projects view), allow VIEW permissions
    // so tabs are visible. Edit/create permissions require a project.
    if (!projectId) {
      return {
        canViewBOQ: canReadBOQ || isAdmin || isManager,
        canEditBOQ: false,
        canViewRFQ: canReadBOQ || isAdmin || isManager,
        canCreateRFQ: false,
        canViewQuotes: canReadBOQ || isAdmin || isManager,
        canEvaluateQuotes: false,
        canViewPurchaseOrders: canReadStock || isAdmin || isManager,
        canCreatePurchaseOrders: false,
        canAccessStock: canReadStock || isAdmin || isManager || isSupervisor,
        canManageStock: false,
        canAccessFieldStock: canReadStock || isAdmin || isManager || isTechnician,
        canManageFieldStock: false,
        canApproveOrders: false,
        canAccessReports: canReadReports || isAdmin || isManager,
        canViewSuppliers: isAdmin || isManager,
        canEditSuppliers: false,
        canManageSuppliers: false,
        canOverrideMovements: false,
        canViewRequisitions: canReadStock || isAdmin || isManager,
        canCreateRequisitions: false,
        canApproveRequisitions: false,
        canViewGRN: canReadStock || isAdmin || isManager,
        canCreateGRN: false,
        role: 'viewer',
        approvalLimit: 0,
      };
    }

    // With project selected - full RBAC
    return {
      canViewBOQ: canReadBOQ || isAdmin || isManager,
      canEditBOQ: canWriteBOQ || isAdmin || isManager,
      canViewRFQ: canReadBOQ || isAdmin || isManager,
      canCreateRFQ: canWriteBOQ || isAdmin || isManager,
      canViewQuotes: canReadBOQ || isAdmin || isManager,
      canEvaluateQuotes: isAdmin || isManager,
      canViewPurchaseOrders: canReadStock || isAdmin || isManager || isSupervisor,
      canCreatePurchaseOrders: isAdmin || isManager,
      canAccessStock: canReadStock || isAdmin || isManager || isSupervisor,
      canManageStock: canWriteStock || isAdmin || isManager,
      canAccessFieldStock: canReadStock || isAdmin || isManager || isTechnician || isContractor,
      canManageFieldStock: canWriteStock || isAdmin || isManager || isSupervisor,
      canApproveOrders: isAdmin || isManager,
      canAccessReports: canReadReports || isAdmin || isManager,
      canViewSuppliers: isAdmin || isManager || isSupervisor,
      canEditSuppliers: isAdmin || isManager,
      canManageSuppliers: isAdmin,
      canOverrideMovements: isAdmin || isManager,
      canViewRequisitions: canReadStock || isAdmin || isManager || isSupervisor,
      canCreateRequisitions: isAdmin || isManager || isSupervisor,
      canApproveRequisitions: isAdmin || isManager,
      canViewGRN: canReadStock || isAdmin || isManager || isSupervisor,
      canCreateGRN: isAdmin || isManager || isSupervisor,
      role,
      approvalLimit,
    };
  }, [projectId, currentUser, hasPermission, hasAnyRole]);
}