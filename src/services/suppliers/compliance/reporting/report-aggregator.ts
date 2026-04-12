/**
 * Report Aggregator
 * Handles aggregation and summary report generation for multiple suppliers
 */

import { ComplianceSummaryReport, ComplianceStatus, SupplierDocument } from './report-types';
import { ComplianceChecker } from './compliance-checker';
import { ComplianceCalculator } from './compliance-calculator';
import { log } from '@/lib/logger';

type ComplianceBreakdown = { compliant: number; partial: number; nonCompliant: number };
type BusinessTypeEntry = { total: number; compliant: number; averageScore: number };
type TopIssue = { issue: string; affectedSuppliers: number; severity: 'high' | 'medium' | 'low' };

export class ReportAggregator {
  /**
   * Generate summary report for multiple suppliers
   */
  static async generateSummaryReport(supplierIds: string[]): Promise<ComplianceSummaryReport> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const suppliers = await Promise.all(
        supplierIds.map(id => supplierCrudService.SupplierCrudService.getById(id))
      );

      const validSuppliers = suppliers.filter(s => s !== null);
      const totalSuppliers = validSuppliers.length;

      // Initialize tracking variables
      const complianceBreakdown: ComplianceBreakdown = { compliant: 0, partial: 0, nonCompliant: 0 };
      let totalScore = 0;
      const businessTypeBreakdown: Record<string, BusinessTypeEntry> = {};
      const issueTracker = new Map<string, number>();
      const expirationAlerts = { expiredDocuments: 0, expiringSoon: 0, expiringNextMonth: 0 };

      // Process each supplier
      for (const supplier of validSuppliers) {
        const documents = supplier.documents || [];
        const businessType = supplier.businessType || 'unknown';

        // Calculate compliance status
        const complianceStatus: ComplianceStatus = supplier.complianceStatus ||
          ComplianceCalculator.calculateComplianceFromDocuments(documents, businessType);

        this.updateComplianceBreakdown(complianceStatus, complianceBreakdown);
        totalScore += complianceStatus.score || 0;

        this.updateBusinessTypeBreakdown(businessType, complianceStatus, businessTypeBreakdown);
        this.trackIssues(businessType, documents, issueTracker);
        this.updateExpirationAlerts(documents, expirationAlerts);
      }

      // Calculate averages for business types
      this.calculateBusinessTypeAverages(businessTypeBreakdown);

      // Get top issues
      const topIssues = this.getTopIssues(issueTracker, totalSuppliers);

      const averageComplianceScore = totalSuppliers > 0
        ? Math.round((totalScore / totalSuppliers) * 100) / 100
        : 0;

      return {
        totalSuppliers,
        complianceBreakdown,
        averageComplianceScore,
        topIssues,
        expirationAlerts,
        businessTypeBreakdown,
        reportPeriod: {
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
          endDate: new Date()
        },
        generatedAt: new Date()
      };
    } catch (error) {
      log.error('Error generating summary report:', { data: error }, 'report-aggregator');
      throw new Error(`Failed to generate summary report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static updateComplianceBreakdown(complianceStatus: ComplianceStatus, breakdown: ComplianceBreakdown): void {
    switch (complianceStatus.overall) {
      case 'compliant':
        breakdown.compliant++;
        break;
      case 'partial':
        breakdown.partial++;
        break;
      case 'non-compliant':
        breakdown.nonCompliant++;
        break;
    }
  }

  private static updateBusinessTypeBreakdown(
    businessType: string,
    complianceStatus: ComplianceStatus,
    breakdown: Record<string, BusinessTypeEntry>
  ): void {
    if (!breakdown[businessType]) {
      breakdown[businessType] = { total: 0, compliant: 0, averageScore: 0 };
    }
    breakdown[businessType].total++;
    breakdown[businessType].averageScore += complianceStatus.score ?? 0;

    if (complianceStatus.overall === 'compliant') {
      breakdown[businessType].compliant++;
    }
  }

  private static trackIssues(
    businessType: string,
    documents: SupplierDocument[],
    issueTracker: Map<string, number>
  ): void {
    const requirements = ComplianceChecker.validateRequirements(businessType, documents);
    requirements.missingRequired.forEach(missing => {
      issueTracker.set(missing, (issueTracker.get(missing) || 0) + 1);
    });
  }

  private static updateExpirationAlerts(documents: SupplierDocument[], alerts: { expiredDocuments: number; expiringSoon: number; expiringNextMonth: number }): void {
    const expirationInfo = ComplianceChecker.checkDocumentExpiration(documents);
    expirationInfo.forEach(info => {
      if (info.status === 'expired') {
        alerts.expiredDocuments++;
      } else if (info.daysUntilExpiry <= 30) {
        alerts.expiringSoon++;
      } else if (info.daysUntilExpiry <= 90) {
        alerts.expiringNextMonth++;
      }
    });
  }

  private static calculateBusinessTypeAverages(breakdown: Record<string, BusinessTypeEntry>): void {
    Object.values(breakdown).forEach(typeBreakdown => {
      if (typeBreakdown.total > 0) {
        typeBreakdown.averageScore = Math.round((typeBreakdown.averageScore / typeBreakdown.total) * 100) / 100;
      }
    });
  }

  private static getTopIssues(issueTracker: Map<string, number>, totalSuppliers: number): TopIssue[] {
    return Array.from(issueTracker.entries())
      .map(([issue, count]) => ({
        issue,
        affectedSuppliers: count,
        severity: this.determineSeverity(issue, count, totalSuppliers)
      }))
      .sort((a, b) => b.affectedSuppliers - a.affectedSuppliers)
      .slice(0, 10);
  }

  /**
   * Determine issue severity based on impact
   */
  private static determineSeverity(
    issue: string,
    affectedCount: number,
    totalSuppliers: number
  ): 'high' | 'medium' | 'low' {
    const impactPercentage = (affectedCount / totalSuppliers) * 100;

    // Critical documents
    const criticalDocs = ['tax_certificate', 'insurance_certificate', 'certificate_of_incorporation'];
    if (criticalDocs.includes(issue) && impactPercentage > 20) {
      return 'high';
    }

    if (impactPercentage > 40) {
      return 'high';
    } else if (impactPercentage > 20) {
      return 'medium';
    } else {
      return 'low';
    }
  }
}
