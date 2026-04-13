/**
 * Role Permission Errors
 * Role-based access control errors with hierarchy support
 */

import { ProcurementPermissionError } from './base';
import { RoleAccessOptions, PermissionErrorOptions } from './types';

/**
 * Role-based access error with hierarchy information
 */
export class RoleAccessError extends ProcurementPermissionError {
  public readonly userRole: string;
  public readonly requiredRole: string;
  public readonly roleHierarchy?: string[] | undefined;
  public readonly departmentRestriction?: string | undefined;

  constructor(
    userRole: string,
    requiredRole: string,
    requiredPermission: string,
    userPermissions: string[],
    options?: RoleAccessOptions,
    context?: Record<string, unknown>
  ) {
    const message = `Insufficient role level. Required: ${requiredRole}, Current: ${userRole}${
      options?.departmentRestriction ? ` (Department: ${options.departmentRestriction})` : ''
    }`;

    const permissionOptions: PermissionErrorOptions = {
      customMessage: message
    };
    if (options?.operation) {
      permissionOptions.operation = options.operation;
    }
    
    super(requiredPermission, userPermissions, permissionOptions, context);

    this.name = 'RoleAccessError';
    this.userRole = userRole;
    this.requiredRole = requiredRole;
    this.roleHierarchy = options?.roleHierarchy || undefined;
    this.departmentRestriction = options?.departmentRestriction || undefined;
    Object.setPrototypeOf(this, RoleAccessError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      userRole: this.userRole,
      requiredRole: this.requiredRole,
      roleHierarchy: this.roleHierarchy,
      departmentRestriction: this.departmentRestriction,
      roleGap: this.getRoleGap(),
      eligibleRoles: this.getEligibleRoles(),
      promotionPath: this.getPromotionPath()
    };
  }

  /**
   * Get the gap between user role and required role in hierarchy
   */
  getRoleGap(): number {
    if (!this.roleHierarchy) return 0;
    
    const userIndex = this.roleHierarchy.indexOf(this.userRole);
    const requiredIndex = this.roleHierarchy.indexOf(this.requiredRole);
    
    if (userIndex === -1 || requiredIndex === -1) return 0;
    
    return Math.max(0, requiredIndex - userIndex);
  }

  /**
   * Get roles that would satisfy the requirement
   */
  getEligibleRoles(): string[] {
    if (!this.roleHierarchy) return [this.requiredRole];
    
    const requiredIndex = this.roleHierarchy.indexOf(this.requiredRole);
    if (requiredIndex === -1) return [this.requiredRole];
    
    return this.roleHierarchy.slice(requiredIndex);
  }

  /**
   * Get the promotion path from current role to required role
   */
  getPromotionPath(): string[] {
    if (!this.roleHierarchy) return [];
    
    const userIndex = this.roleHierarchy.indexOf(this.userRole);
    const requiredIndex = this.roleHierarchy.indexOf(this.requiredRole);
    
    if (userIndex === -1 || requiredIndex === -1 || userIndex >= requiredIndex) {
      return [];
    }
    
    return this.roleHierarchy.slice(userIndex + 1, requiredIndex + 1);
  }

  /**
   * Check if user role is in the same department
   */
  isInSameDepartment(): boolean {
    return !this.departmentRestriction; // No restriction means same department
  }

  /**
   * Get suggested actions for role elevation
   */
  getRoleElevationSuggestions(): string[] {
    const suggestions = [];
    const promotionPath = this.getPromotionPath();
    
    if (promotionPath.length > 0) {
      suggestions.push(`Request role elevation to: ${promotionPath[0]}`);
      if (promotionPath.length > 1) {
        suggestions.push(`Full promotion path: ${this.userRole} → ${promotionPath.join(' → ')}`);
      }
    }
    
    if (this.departmentRestriction) {
      suggestions.push(`Ensure you are assigned to department: ${this.departmentRestriction}`);
    }
    
    suggestions.push('Contact HR or system administrator for role assignment');
    suggestions.push('Complete any required training or certification');
    
    return suggestions;
  }

  /**
   * Check if role promotion is possible within hierarchy
   */
  canBePromoted(): boolean {
    return this.getPromotionPath().length > 0;
  }
}
