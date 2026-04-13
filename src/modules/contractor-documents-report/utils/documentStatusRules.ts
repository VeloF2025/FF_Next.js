/**
 * Document Status Rules
 *
 * Business logic for determining document status and urgency levels
 */

import type {
  DocumentVerificationStatus,
  DocumentUrgencyLevel,
  DocumentDisplayStatus,
  DocumentType,
} from '../types/documentReport.types';
import { getExpiryWarningDays } from '../types/documentCategories';
import { formatDisplayDate } from '@/utils/dateFormat';

/**
 * Calculate days until expiry from an expiry date
 */
export function calculateDaysUntilExpiry(expiryDate: string | null | undefined): number | null {
  if (!expiryDate) return null;

  const expiry = new Date(expiryDate);
  const today = new Date();

  // Reset time to start of day for accurate day calculation
  expiry.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Determine urgency level based on expiry date
 */
export function calculateUrgencyLevel(
  expiryDate: string | null | undefined,
  documentType: string
): DocumentUrgencyLevel {
  if (!expiryDate) return 'ok';

  const daysUntilExpiry = calculateDaysUntilExpiry(expiryDate);
  if (daysUntilExpiry === null) return 'ok';

  const warningDays = getExpiryWarningDays(documentType as DocumentType);

  if (daysUntilExpiry < 0) {
    return 'expired';
  } else if (daysUntilExpiry <= warningDays) {
    return 'expiring';
  } else {
    return 'ok';
  }
}

/**
 * Determine display status (combines verification status and urgency)
 */
export function calculateDisplayStatus(
  verificationStatus: DocumentVerificationStatus,
  urgencyLevel: DocumentUrgencyLevel
): DocumentDisplayStatus {
  // Missing takes precedence
  if (verificationStatus === 'missing') {
    return 'missing';
  }

  // Rejected takes precedence over expiry
  if (verificationStatus === 'rejected') {
    return 'rejected';
  }

  // Pending takes precedence over expiry
  if (verificationStatus === 'pending') {
    return 'pending';
  }

  // For verified documents, check urgency
  if (verificationStatus === 'verified') {
    if (urgencyLevel === 'expired') {
      return 'expired';
    } else if (urgencyLevel === 'expiring') {
      return 'expiring';
    } else {
      return 'verified';
    }
  }

  return 'missing';
}

/**
 * Get status badge properties (icon, color, label)
 */
export function getStatusBadgeProps(status: DocumentDisplayStatus) {
  const statusConfig = {
    verified: {
      icon: 'CheckCircle',
      color: 'green',
      label: 'Verified',
      bgColor: 'bg-green-100',
      textColor: 'text-green-800',
      borderColor: 'border-green-200',
    },
    pending: {
      icon: 'Clock',
      color: 'yellow',
      label: 'Pending',
      bgColor: 'bg-yellow-100',
      textColor: 'text-yellow-800',
      borderColor: 'border-yellow-200',
    },
    expiring: {
      icon: 'AlertTriangle',
      color: 'orange',
      label: 'Expiring Soon',
      bgColor: 'bg-orange-100',
      textColor: 'text-orange-800',
      borderColor: 'border-orange-200',
    },
    expired: {
      icon: 'XCircle',
      color: 'red',
      label: 'Expired',
      bgColor: 'bg-red-100',
      textColor: 'text-red-800',
      borderColor: 'border-red-200',
    },
    rejected: {
      icon: 'RefreshCw',
      color: 'purple',
      label: 'Rejected',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-800',
      borderColor: 'border-purple-200',
    },
    missing: {
      icon: 'Square',
      color: 'gray',
      label: 'Missing',
      bgColor: 'bg-secondary',
      textColor: 'text-foreground',
      borderColor: 'border-border',
    },
  };

  return statusConfig[status];
}

/**
 * Format expiry date for display
 */
export function formatExpiryDate(
  expiryDate: string | null | undefined,
  daysUntilExpiry: number | null
): string {
  if (!expiryDate) return 'N/A';

  const formatted = formatDisplayDate(expiryDate);

  if (daysUntilExpiry !== null) {
    if (daysUntilExpiry < 0) {
      return `${formatted} (Expired ${Math.abs(daysUntilExpiry)} days ago)`;
    } else if (daysUntilExpiry === 0) {
      return `${formatted} (Expires today)`;
    } else if (daysUntilExpiry <= 30) {
      return `${formatted} (${daysUntilExpiry} days remaining)`;
    }
  }

  return formatted;
}

/**
 * Determine action button text based on status
 */
export function getActionButtonText(status: DocumentDisplayStatus): string {
  const actionMap = {
    verified: 'View',
    pending: 'Review',
    expiring: 'View',
    expired: 'Upload New',
    rejected: 'Resubmit',
    missing: 'Upload',
  };

  return actionMap[status];
}

/**
 * Check if status requires user action
 */
export function requiresAction(status: DocumentDisplayStatus): boolean {
  return ['missing', 'expired', 'rejected', 'expiring'].includes(status);
}
