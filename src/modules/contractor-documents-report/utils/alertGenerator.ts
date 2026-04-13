/**
 * Alert Generator
 *
 * Generates user-facing alerts for document issues
 */

import type {
  DocumentInfo,
  TeamMemberDocuments,
  DocumentAlert,
  ContractorDocumentSummary,
} from '../types/documentReport.types';
import { formatExpiryDate } from './documentStatusRules';

/**
 * Generate alerts for a contractor's document report
 */
export function generateDocumentAlerts(
  companyDocuments: DocumentInfo[],
  teamDocuments: TeamMemberDocuments[],
  summary: ContractorDocumentSummary
): DocumentAlert[] {
  const alerts: DocumentAlert[] = [];

  // Check for expired company documents
  companyDocuments.forEach((doc) => {
    if (doc.displayStatus === 'expired') {
      alerts.push({
        type: 'expired',
        message: `${doc.type} has expired${doc.expiryDate ? ` on ${formatExpiryDate(doc.expiryDate, null)}` : ''}`,
        severity: 'error',
        documentId: doc.id,
        documentType: doc.type,
      });
    }
  });

  // Check for expiring company documents (within 30 days)
  companyDocuments.forEach((doc) => {
    if (doc.displayStatus === 'expiring' && doc.daysUntilExpiry !== null) {
      alerts.push({
        type: 'expiring',
        message: `${doc.type} expires in ${doc.daysUntilExpiry} day${doc.daysUntilExpiry !== 1 ? 's' : ''}`,
        severity: 'warning',
        documentId: doc.id,
        documentType: doc.type,
      });
    }
  });

  // Check for rejected documents
  companyDocuments.forEach((doc) => {
    if (doc.displayStatus === 'rejected') {
      alerts.push({
        type: 'rejected',
        message: `${doc.type} was rejected${doc.rejectionReason ? `: ${doc.rejectionReason}` : ' and needs resubmission'}`,
        severity: 'warning',
        documentId: doc.id,
        documentType: doc.type,
      });
    }
  });

  // Check for pending verification
  if (summary.pending > 0) {
    alerts.push({
      type: 'pending',
      message: `${summary.pending} document${summary.pending !== 1 ? 's' : ''} pending verification`,
      severity: 'info',
    });
  }

  // Check for missing team member IDs
  const missingTeamIds = teamDocuments.filter((member) => member.displayStatus === 'missing');
  if (missingTeamIds.length > 0) {
    alerts.push({
      type: 'missing',
      message: `${missingTeamIds.length} team member${missingTeamIds.length !== 1 ? 's' : ''} missing ID document${missingTeamIds.length !== 1 ? 's' : ''}`,
      severity: 'warning',
    });
  }

  // Check for missing company documents
  const missingCompanyDocs = companyDocuments.filter((doc) => doc.displayStatus === 'missing');
  if (missingCompanyDocs.length > 0) {
    const docNames = missingCompanyDocs.map((doc) => doc.type).join(', ');
    alerts.push({
      type: 'missing',
      message: `Missing company documents: ${docNames}`,
      severity: 'warning',
    });
  }

  // Sort alerts by severity (error > warning > info)
  const severityOrder = { error: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

/**
 * Check if contractor has any urgent alerts
 */
export function hasUrgentAlerts(alerts: DocumentAlert[]): boolean {
  return alerts.some((alert) => alert.severity === 'error' || alert.severity === 'warning');
}

/**
 * Count alerts by severity
 */
export function countAlertsBySeverity(alerts: DocumentAlert[]): {
  error: number;
  warning: number;
  info: number;
} {
  return {
    error: alerts.filter((a) => a.severity === 'error').length,
    warning: alerts.filter((a) => a.severity === 'warning').length,
    info: alerts.filter((a) => a.severity === 'info').length,
  };
}
