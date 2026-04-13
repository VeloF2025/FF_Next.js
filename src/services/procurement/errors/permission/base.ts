/**
 * Base Permission Errors
 * Core permission error classes
 */

import { ProcurementError } from '../base.errors';
import { PermissionErrorOptions } from './types';

/**
 * Base permission/authorization error with detailed permission context
 */
export class ProcurementPermissionError extends ProcurementError {
  public readonly requiredPermission: string;
  public readonly userPermissions: string[];
  public readonly resourceType?: string | undefined;
  public readonly resourceId?: string | undefined;
  public readonly operation?: string | undefined;

  constructor(
    requiredPermission: string,
    userPermissions: string[],
    options?: PermissionErrorOptions,
    context?: Record<string, unknown>
  ) {
    const message = options?.customMessage || 
      `Access denied. Required permission: ${requiredPermission}${
        options?.operation ? ` for operation: ${options.operation}` : ''
      }${
        options?.resourceType && options?.resourceId 
          ? ` on ${options.resourceType}: ${options.resourceId}` 
          : ''
      }`;

    super(message, 'INSUFFICIENT_PERMISSIONS', 403, context);
    this.name = 'ProcurementPermissionError';
    this.requiredPermission = requiredPermission;
    this.userPermissions = userPermissions;
    this.resourceType = options?.resourceType || undefined;
    this.resourceId = options?.resourceId || undefined;
    this.operation = options?.operation || undefined;
    Object.setPrototypeOf(this, ProcurementPermissionError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      requiredPermission: this.requiredPermission,
      userPermissions: this.userPermissions,
      resourceType: this.resourceType,
      resourceId: this.resourceId,
      operation: this.operation,
      permissionGap: this.getPermissionGap(),
      suggestedActions: this.getSuggestedActions()
    };
  }

  /**
   * Get permissions that user is missing
   */
  getPermissionGap(): string[] {
    return [this.requiredPermission].filter(permission => 
      !this.userPermissions.includes(permission)
    );
  }

  /**
   * Check if user has specific permission
   */
  hasPermission(permission: string): boolean {
    return this.userPermissions.includes(permission);
  }

  /**
   * Get suggested actions to resolve permission issue
   */
  getSuggestedActions(): string[] {
    const actions = [];
    
    if (!this.hasPermission(this.requiredPermission)) {
      actions.push(`Request '${this.requiredPermission}' permission from administrator`);
    }

    if (this.resourceType === 'project') {
      actions.push('Verify you are assigned to this project');
      actions.push('Check if project access permissions have changed');
    }

    if (this.operation) {
      actions.push(`Ensure you have the correct role to perform '${this.operation}' operations`);
    }

    actions.push('Contact system administrator if you believe this is an error');

    return actions;
  }
}
