/**
 * Permission Checking Operations
 * Core permission checking logic and validation
 */

import { ProcurementPermission } from '../permissions';
import { UserPermissionCache } from '../permissionChecker';
import type { ServiceResponse } from '@/services/core/BaseService';

/**
 * Core permission checking operations
 */
export class CorePermissionChecker {
  /**
   * Check if user has a single permission
   */
  static checkSinglePermission(
    userPermissions: UserPermissionCache,
    permission: ProcurementPermission | string
  ): boolean {
    return userPermissions.permissions.has(permission as ProcurementPermission);
  }

  /**
   * Check if user has all specified permissions
   */
  static checkAllPermissions(
    userPermissions: UserPermissionCache,
    permissions: (ProcurementPermission | string)[]
  ): boolean {
    return permissions.every(permission => 
      userPermissions.permissions.has(permission as ProcurementPermission)
    );
  }

  /**
   * Check if user has any of the specified permissions
   */
  static checkAnyPermission(
    userPermissions: UserPermissionCache,
    permissions: (ProcurementPermission | string)[]
  ): boolean {
    return permissions.some(permission => 
      userPermissions.permissions.has(permission as ProcurementPermission)
    );
  }

  /**
   * Create error response for permission failures
   */
  static createPermissionErrorResponse<T>(
    error: unknown,
    defaultMessage: string,
    defaultCode: string
  ): ServiceResponse<T> {
    return {
      success: false,
      error: error instanceof Error ? error.message : defaultMessage,
      code: defaultCode
    };
  }

  /**
   * Get permission summary for user
   */
  static getPermissionSummary(userPermissions: UserPermissionCache) {
    return {
      userId: userPermissions.userId,
      roles: userPermissions.roles,
      accessLevel: userPermissions.projectAccessLevel,
      permissions: Array.from(userPermissions.permissions),
      permissionCount: userPermissions.permissions.size,
      timestamp: userPermissions.timestamp
    };
  }

  /**
   * Check if user can perform bulk operations
   */
  static canPerformBulkOperations(userPermissions: UserPermissionCache): boolean {
    const requiredPermissions = [
      ProcurementPermission.BOQ_DELETE,
      ProcurementPermission.RFQ_DELETE,
      ProcurementPermission.BOQ_BULK_UPDATE
    ];
    
    return requiredPermissions.some(permission => 
      userPermissions.permissions.has(permission as ProcurementPermission)
    );
  }
}