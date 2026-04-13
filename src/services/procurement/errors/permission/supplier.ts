/**
 * Supplier Permission Errors
 * Supplier portal access and invitation-related errors
 */

import { ProcurementPermissionError } from './base';
import { SupplierAccessOptions, InvitationStatus, PermissionErrorOptions } from './types';

/**
 * Supplier portal access error
 */
export class SupplierAccessError extends ProcurementPermissionError {
  public readonly supplierId: string;
  public readonly supplierName?: string | undefined;
  public readonly invitationStatus?: InvitationStatus | undefined;
  public readonly expirationDate?: Date | undefined;

  constructor(
    supplierId: string,
    requiredPermission: string,
    userPermissions: string[],
    options?: SupplierAccessOptions,
    context?: Record<string, unknown>
  ) {
    let message = `Supplier access denied for '${options?.supplierName || supplierId}'`;
    
    if (options?.invitationStatus === 'expired') {
      message += `. Invitation expired${options.expirationDate ? ` on ${options.expirationDate.toDateString()}` : ''}`;
    } else if (options?.invitationStatus === 'revoked') {
      message += '. Access has been revoked';
    } else if (options?.invitationStatus === 'not_invited') {
      message += '. No invitation found for this supplier';
    }

    const permissionOptions: PermissionErrorOptions = {
      resourceType: 'supplier',
      resourceId: supplierId,
      customMessage: message
    };
    if (options?.operation) {
      permissionOptions.operation = options.operation;
    }
    
    super(requiredPermission, userPermissions, permissionOptions, context);

    this.name = 'SupplierAccessError';
    this.supplierId = supplierId;
    this.supplierName = options?.supplierName || undefined;
    this.invitationStatus = options?.invitationStatus || undefined;
    this.expirationDate = options?.expirationDate || undefined;
    Object.setPrototypeOf(this, SupplierAccessError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      supplierId: this.supplierId,
      supplierName: this.supplierName,
      invitationStatus: this.invitationStatus,
      expirationDate: this.expirationDate?.toISOString(),
      daysUntilExpiration: this.getDaysUntilExpiration(),
      canRenewInvitation: this.canRenewInvitation()
    };
  }

  /**
   * Get days until invitation expires (negative if already expired)
   */
  getDaysUntilExpiration(): number | null {
    if (!this.expirationDate) return null;
    
    const now = new Date();
    const timeDiff = this.expirationDate.getTime() - now.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
  }

  /**
   * Check if invitation can be renewed
   */
  canRenewInvitation(): boolean {
    return this.invitationStatus === 'expired' || this.invitationStatus === 'revoked';
  }

  /**
   * Check if invitation is still valid
   */
  isInvitationValid(): boolean {
    if (this.invitationStatus === 'revoked' || this.invitationStatus === 'not_invited') {
      return false;
    }
    
    if (this.invitationStatus === 'expired') {
      return false;
    }
    
    if (this.expirationDate) {
      return this.expirationDate > new Date();
    }
    
    return true;
  }

  /**
   * Get invitation renewal suggestions
   */
  getRenewalSuggestions(): string[] {
    const suggestions = [];
    
    if (this.invitationStatus === 'expired') {
      suggestions.push('Request invitation renewal from procurement team');
      suggestions.push('Verify supplier contact information is current');
    }
    
    if (this.invitationStatus === 'revoked') {
      suggestions.push('Contact procurement team to understand revocation reason');
      suggestions.push('Address any compliance issues before requesting new invitation');
    }
    
    if (this.invitationStatus === 'not_invited') {
      suggestions.push('Request initial invitation from procurement team');
      suggestions.push('Complete supplier registration process');
    }
    
    return suggestions;
  }

  /**
   * Check if invitation is expiring soon (within 7 days)
   */
  isExpiringSoon(): boolean {
    const daysUntilExpiration = this.getDaysUntilExpiration();
    return daysUntilExpiration !== null && daysUntilExpiration > 0 && daysUntilExpiration <= 7;
  }
}
