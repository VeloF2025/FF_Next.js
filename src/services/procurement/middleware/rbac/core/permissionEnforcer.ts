/**
 * Permission Enforcement Operations
 * Handles permission enforcement and throws errors for unauthorized access
 */

import { ProcurementPermissionError } from '../../../procurementErrors';
import { ProcurementPermission } from '../permissions';

interface PermissionCheckResult {
  success: boolean;
  data?: boolean;
}

/**
 * Permission enforcement operations
 */
export class PermissionEnforcer {
  /**
   * Enforce permission requirement (throws error if not authorized)
   */
  static async enforcePermission(
    checkPermissionFn: (userId: string, permission: ProcurementPermission | string, projectId: string) => Promise<PermissionCheckResult>,
    userId: string,
    permission: ProcurementPermission | string,
    projectId: string
  ): Promise<void> {
    const hasPermission = await checkPermissionFn(userId, permission, projectId);
    
    if (!hasPermission.success || !hasPermission.data) {
      throw new ProcurementPermissionError(
        permission,
        [], // We don't expose user permissions for security
        {
          userId,
          projectId,
          requiredPermission: permission
        }
      );
    }
  }

  /**
   * Enforce multiple permissions requirement
   */
  static async enforceAllPermissions(
    checkAllPermissionsFn: (userId: string, permissions: (ProcurementPermission | string)[], projectId: string) => Promise<PermissionCheckResult>,
    userId: string,
    permissions: (ProcurementPermission | string)[],
    projectId: string
  ): Promise<void> {
    const hasAllPermissions = await checkAllPermissionsFn(userId, permissions, projectId);
    
    if (!hasAllPermissions.success || !hasAllPermissions.data) {
      throw new ProcurementPermissionError(
        permissions.join(', '),
        [], // We don't expose user permissions for security
        {
          userId,
          projectId,
          requiredPermission: permissions.join(', ')
        }
      );
    }
  }
}