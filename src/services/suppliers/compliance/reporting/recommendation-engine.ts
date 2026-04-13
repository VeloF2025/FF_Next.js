/**
 * Recommendation Engine
 * Generates recommendations and next actions based on compliance analysis
 */

import { ComplianceStatus as ReportComplianceStatus } from './report-types';

export class RecommendationEngine {
  /**
   * Generate recommendations based on compliance status
   */
  static generateRecommendations(
    complianceStatus: ReportComplianceStatus,
    missingDocuments: string[],
    expiringDocuments: Array<{ type: string; expiryDate: Date; daysUntilExpiry: number }>,
    businessType: string
  ): string[] {
    const recommendations: string[] = [];

    // Missing documents recommendations
    if (missingDocuments.length > 0) {
      recommendations.push(`Submit missing required documents: ${missingDocuments.join(', ')}`);
    }

    // Expiring documents recommendations
    const urgentExpiring = expiringDocuments.filter(doc => doc.daysUntilExpiry <= 30);
    if (urgentExpiring.length > 0) {
      recommendations.push(`Urgent: Renew documents expiring within 30 days: ${urgentExpiring.map(d => d.type).join(', ')}`);
    }

    const soonExpiring = expiringDocuments.filter(doc => doc.daysUntilExpiry > 30 && doc.daysUntilExpiry <= 90);
    if (soonExpiring.length > 0) {
      recommendations.push(`Plan renewal for documents expiring in 30-90 days: ${soonExpiring.map(d => d.type).join(', ')}`);
    }

    // Score-based recommendations
    const score = (complianceStatus as { score?: number }).score || 0;
    if (score < 60) {
      recommendations.push('Critical: Compliance score below minimum threshold. Immediate action required.');
    } else if (score < 80) {
      recommendations.push('Improve compliance score by addressing missing and expiring documents.');
    }

    // Business type specific recommendations
    if (businessType === 'corporation' || businessType === 'pty_ltd') {
      if (missingDocuments.includes('bbbee_certificate')) {
        recommendations.push('Submit valid BBBEE certificate to improve procurement opportunities.');
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('Maintain current compliance level and monitor document expiration dates.');
    }

    return recommendations;
  }

  /**
   * Generate next actions based on compliance status
   */
  static generateNextActions(
    _overallStatus: 'compliant' | 'partial' | 'non-compliant',
    missingDocuments: string[],
    expiringDocuments: Array<{ type: string; expiryDate: Date; daysUntilExpiry: number }>,
    _recommendations: string[]
  ): string[] {
    const nextActions: string[] = [];

    // Prioritize by urgency
    const expiredDocs = expiringDocuments.filter(doc => doc.daysUntilExpiry < 0);
    const urgentDocs = expiringDocuments.filter(doc => doc.daysUntilExpiry >= 0 && doc.daysUntilExpiry <= 30);

    if (expiredDocs.length > 0) {
      nextActions.push(`URGENT: Replace expired documents: ${expiredDocs.map(d => d.type).join(', ')}`);
    }

    if (urgentDocs.length > 0) {
      nextActions.push(`HIGH PRIORITY: Renew expiring documents: ${urgentDocs.map(d => d.type).join(', ')}`);
    }

    if (missingDocuments.length > 0) {
      nextActions.push(`MEDIUM PRIORITY: Submit missing documents: ${missingDocuments.slice(0, 3).join(', ')}`);
    }

    const soonExpiring = expiringDocuments.filter(doc => doc.daysUntilExpiry > 30 && doc.daysUntilExpiry <= 90);
    if (soonExpiring.length > 0) {
      nextActions.push(`LOW PRIORITY: Plan renewal: ${soonExpiring.map(d => d.type).join(', ')}`);
    }

    if (nextActions.length === 0) {
      nextActions.push('Monitor compliance status and document expiration dates');
    }

    return nextActions;
  }
}