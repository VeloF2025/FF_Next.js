/**
 * Compliance Report Generator - Backward Compatibility Layer
 * @deprecated Use ./reporting/index.ts for improved modular compliance reporting
 * 
 * This file provides backward compatibility for existing imports.
 * New code should use the modular compliance reporting system in ./reporting/
 */

// Re-export everything from the new modular structure
export * from './reporting';

// Import classes for backward compatibility
import { ComplianceReportBuilder } from './reporting/report-builder';
import { ComplianceReportFormatter } from './reporting/report-formatter';
import type { ComplianceReport } from './reporting/report-types';

/**
 * Legacy ComplianceReportGenerator class for backward compatibility
 */
export class ComplianceReportGenerator {
  /**
   * Generate comprehensive compliance report for a supplier
   * @deprecated Use ComplianceReportBuilder.generateComplianceReport instead
   */
  static async generateComplianceReport(supplierId: string) {
    return ComplianceReportBuilder.generateComplianceReport(supplierId);
  }

  /**
   * Generate summary report for multiple suppliers
   * @deprecated Use ComplianceReportBuilder.generateSummaryReport instead
   */
  static async generateSummaryReport(supplierIds: string[]) {
    return ComplianceReportBuilder.generateSummaryReport(supplierIds);
  }

  /**
   * Export report in specified format
   * @deprecated Use ComplianceReportFormatter.exportReport instead
   */
  static exportReport(report: ComplianceReport, format: 'json' | 'csv' | 'text' = 'json') {
    return ComplianceReportFormatter.exportReport(report, format);
  }
}