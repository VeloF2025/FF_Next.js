/**
 * Project Permission Errors
 * Project-specific access and permission errors
 */

import { ProcurementPermissionError } from './base';
import { ProjectAccessOptions, AccessLevel, PermissionErrorOptions } from './types';

/**
 * Project-specific access denied error
 */
export class ProjectAccessDeniedError extends ProcurementPermissionError {
  public readonly projectId: string;
  public readonly projectName?: string | undefined;
  public readonly userRole?: string | undefined;
  public readonly requiredRole?: string | undefined;

  constructor(
    projectId: string,
    requiredPermission: string,
    userPermissions: string[],
    options?: ProjectAccessOptions,
    context?: Record<string, unknown>
  ) {
    const message = `Access denied to project '${options?.projectName || projectId}'. ${
      options?.requiredRole ? `Required role: ${options.requiredRole}` : `Required permission: ${requiredPermission}`
    }${options?.userRole ? `. Current role: ${options.userRole}` : ''}`;

    const permissionOptions: PermissionErrorOptions = {
      resourceType: 'project',
      resourceId: projectId,
      customMessage: message
    };
    if (options?.operation) {
      permissionOptions.operation = options.operation;
    }
    
    super(requiredPermission, userPermissions, permissionOptions, context);

    this.name = 'ProjectAccessDeniedError';
    this.projectId = projectId;
    this.projectName = options?.projectName || undefined;
    this.userRole = options?.userRole || undefined;
    this.requiredRole = options?.requiredRole || undefined;
    Object.setPrototypeOf(this, ProjectAccessDeniedError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      projectId: this.projectId,
      projectName: this.projectName,
      userRole: this.userRole,
      requiredRole: this.requiredRole,
      accessLevel: this.getAccessLevel()
    };
  }

  /**
   * Get user's access level for the project
   */
  getAccessLevel(): AccessLevel {
    if (this.userPermissions.includes('project:admin')) return 'admin';
    if (this.userPermissions.includes('project:write')) return 'write';
    if (this.userPermissions.includes('project:read')) return 'read';
    return 'none';
  }

  /**
   * Check if user can perform read operations
   */
  canRead(): boolean {
    return this.getAccessLevel() !== 'none';
  }

  /**
   * Check if user can perform write operations
   */
  canWrite(): boolean {
    const level = this.getAccessLevel();
    return level === 'write' || level === 'admin';
  }

  /**
   * Check if user has admin access
   */
  canAdmin(): boolean {
    return this.getAccessLevel() === 'admin';
  }

  /**
   * Get minimum required permission level
   */
  getMinimumRequiredLevel(): AccessLevel {
    if (this.requiredPermission.includes('admin')) return 'admin';
    if (this.requiredPermission.includes('write')) return 'write';
    if (this.requiredPermission.includes('read')) return 'read';
    return 'none';
  }
}
