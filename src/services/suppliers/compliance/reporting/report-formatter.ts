/**
 * Compliance Report Formatter
 * Export and format compliance reports in various formats
 */

import { ComplianceReport, ComplianceSummaryReport, ReportExportOptions } from './report-types';

export class ComplianceReportFormatter {
  /**
   * Export compliance report in specified format
   */
  static exportReport(
    report: ComplianceReport, 
    format: 'json' | 'csv' | 'text' | 'xlsx' = 'json'
  ): string {
    switch (format) {
      case 'json':
        return JSON.stringify(report, null, 2);
      case 'csv':
        return this.reportToCSV(report);
      case 'text':
        return this.reportToText(report);
      case 'xlsx':
        // Would typically return binary data or file path
        return this.reportToCSV(report); // Fallback to CSV for now
      default:
        throw new Error('Unsupported export format');
    }
  }

  /**
   * Export summary report in specified format
   */
  static exportSummaryReport(
    report: ComplianceSummaryReport,
    options: ReportExportOptions = { format: 'json' }
  ): string {
    switch (options.format) {
      case 'json':
        return JSON.stringify(report, null, 2);
      case 'csv':
        return this.summaryToCSV(report);
      case 'text':
        return this.summaryToText(report);
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  }

  /**
   * Convert compliance report to CSV format
   */
  private static reportToCSV(report: ComplianceReport): string {
    const headers = [
      'Supplier ID', 'Supplier Name', 'Business Type', 'Overall Status', 'Overall Score',
      'Total Documents', 'Required Documents', 'Provided Documents', 'Missing Documents',
      'Expiring Documents', 'Last Updated', 'Report Generated'
    ];

    const row = [
      report.supplierId,
      `"${report.supplierName}"`,
      report.businessType,
      report.overallStatus,
      report.overallScore.toString(),
      report.totalDocuments.toString(),
      report.requiredDocuments.toString(),
      report.providedDocuments.toString(),
      `"${report.missingDocuments.join(', ')}"`,
      `"${report.expiringDocuments.map(d => `${d.type} (${d.daysUntilExpiry} days)`).join(', ')}"`,
      report.lastUpdated.toISOString(),
      report.reportGeneratedAt.toISOString()
    ];

    return [headers.join(','), row.join(',')].join('\n');
  }

  /**
   * Convert compliance report to text format
   */
  private static reportToText(report: ComplianceReport): string {
    let text = `COMPLIANCE REPORT\n`;
    text += `${'='.repeat(50)}\n\n`;

    text += `Supplier: ${report.supplierName} (${report.supplierId})\n`;
    text += `Business Type: ${report.businessType}\n`;
    text += `Overall Status: ${report.overallStatus.toUpperCase()}\n`;
    text += `Compliance Score: ${report.overallScore}%\n`;
    text += `Last Updated: ${report.lastUpdated.toDateString()}\n`;
    text += `Report Generated: ${report.reportGeneratedAt.toDateString()}\n\n`;

    text += `DOCUMENT SUMMARY:\n`;
    text += `- Total Documents: ${report.totalDocuments}\n`;
    text += `- Required Documents: ${report.requiredDocuments}\n`;
    text += `- Provided Documents: ${report.providedDocuments}\n\n`;

    if (report.missingDocuments.length > 0) {
      text += `MISSING DOCUMENTS:\n`;
      report.missingDocuments.forEach(doc => {
        text += `- ${doc}\n`;
      });
      text += `\n`;
    }

    if (report.expiringDocuments.length > 0) {
      text += `EXPIRING DOCUMENTS:\n`;
      report.expiringDocuments.forEach(doc => {
        text += `- ${doc.type}: ${doc.expiryDate.toDateString()} (${doc.daysUntilExpiry} days)\n`;
      });
      text += `\n`;
    }

    if (report.recommendations.length > 0) {
      text += `RECOMMENDATIONS:\n`;
      report.recommendations.forEach((rec, index) => {
        text += `${index + 1}. ${rec}\n`;
      });
      text += `\n`;
    }

    if (report.nextActions.length > 0) {
      text += `NEXT ACTIONS:\n`;
      report.nextActions.forEach((action, index) => {
        text += `${index + 1}. ${action}\n`;
      });
    }

    return text;
  }

  /**
   * Convert summary report to CSV format
   */
  private static summaryToCSV(report: ComplianceSummaryReport): string {
    const headers = [
      'Metric', 'Value', 'Percentage'
    ];

    const rows = [
      ['Total Suppliers', report.totalSuppliers.toString(), '100%'],
      ['Compliant Suppliers', report.complianceBreakdown.compliant.toString(), 
       `${((report.complianceBreakdown.compliant / report.totalSuppliers) * 100).toFixed(1)}%`],
      ['Partial Compliance', report.complianceBreakdown.partial.toString(),
       `${((report.complianceBreakdown.partial / report.totalSuppliers) * 100).toFixed(1)}%`],
      ['Non-Compliant', report.complianceBreakdown.nonCompliant.toString(),
       `${((report.complianceBreakdown.nonCompliant / report.totalSuppliers) * 100).toFixed(1)}%`],
      ['Average Compliance Score', report.averageComplianceScore.toString(), ''],
      ['Expired Documents', report.expirationAlerts.expiredDocuments.toString(), ''],
      ['Expiring Soon (30 days)', report.expirationAlerts.expiringSoon.toString(), ''],
      ['Expiring Next Month', report.expirationAlerts.expiringNextMonth.toString(), '']
    ];

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * Convert summary report to text format
   */
  private static summaryToText(report: ComplianceSummaryReport): string {
    let text = `COMPLIANCE SUMMARY REPORT\n`;
    text += `${'='.repeat(50)}\n`;
    text += `Generated: ${report.generatedAt.toDateString()}\n`;
    text += `Report Period: ${report.reportPeriod.startDate.toDateString()} - ${report.reportPeriod.endDate.toDateString()}\n\n`;

    text += `OVERALL STATISTICS:\n`;
    text += `- Total Suppliers: ${report.totalSuppliers}\n`;
    text += `- Average Compliance Score: ${report.averageComplianceScore}%\n\n`;

    text += `COMPLIANCE BREAKDOWN:\n`;
    text += `- Compliant: ${report.complianceBreakdown.compliant} (${((report.complianceBreakdown.compliant / report.totalSuppliers) * 100).toFixed(1)}%)\n`;
    text += `- Partial Compliance: ${report.complianceBreakdown.partial} (${((report.complianceBreakdown.partial / report.totalSuppliers) * 100).toFixed(1)}%)\n`;
    text += `- Non-Compliant: ${report.complianceBreakdown.nonCompliant} (${((report.complianceBreakdown.nonCompliant / report.totalSuppliers) * 100).toFixed(1)}%)\n\n`;

    text += `EXPIRATION ALERTS:\n`;
    text += `- Expired Documents: ${report.expirationAlerts.expiredDocuments}\n`;
    text += `- Expiring Soon (30 days): ${report.expirationAlerts.expiringSoon}\n`;
    text += `- Expiring Next Month: ${report.expirationAlerts.expiringNextMonth}\n\n`;

    if (report.topIssues.length > 0) {
      text += `TOP COMPLIANCE ISSUES:\n`;
      report.topIssues.slice(0, 5).forEach((issue, index) => {
        text += `${index + 1}. ${issue.issue} - ${issue.affectedSuppliers} suppliers (${issue.severity} severity)\n`;
      });
      text += `\n`;
    }

    if (Object.keys(report.businessTypeBreakdown).length > 0) {
      text += `BUSINESS TYPE BREAKDOWN:\n`;
      Object.entries(report.businessTypeBreakdown).forEach(([type, data]) => {
        const complianceRate = data.total > 0 ? (data.compliant / data.total * 100).toFixed(1) : '0';
        text += `- ${type}: ${data.total} total, ${data.compliant} compliant (${complianceRate}%), avg score: ${data.averageScore}%\n`;
      });
    }

    return text;
  }

  /**
   * Generate dashboard-friendly data structure
   */
  static generateDashboardData(report: ComplianceSummaryReport): {
    kpis: Array<{
      title: string;
      value: string | number;
      change?: string;
      trend?: 'up' | 'down' | 'stable';
    }>;
    charts: {
      complianceBreakdown: Array<{ name: string; value: number; color: string }>;
      businessTypePerformance: Array<{ name: string; compliant: number; total: number; rate: number }>;
      expirationTimeline: Array<{ period: string; count: number; type: 'expired' | 'expiring' | 'future' }>;
    };
    alerts: Array<{
      type: 'error' | 'warning' | 'info';
      title: string;
      message: string;
      count?: number;
    }>;
  } {
    const kpis = [
      {
        title: 'Total Suppliers',
        value: report.totalSuppliers
      },
      {
        title: 'Compliance Rate',
        value: `${((report.complianceBreakdown.compliant / report.totalSuppliers) * 100).toFixed(1)}%`
      },
      {
        title: 'Average Score',
        value: `${report.averageComplianceScore}%`
      },
      {
        title: 'At Risk',
        value: report.complianceBreakdown.nonCompliant + report.complianceBreakdown.partial
      }
    ];

    const complianceBreakdown = [
      { 
        name: 'Compliant', 
        value: report.complianceBreakdown.compliant,
        color: '#10B981' // green
      },
      { 
        name: 'Partial', 
        value: report.complianceBreakdown.partial,
        color: '#D97706' // yellow
      },
      { 
        name: 'Non-Compliant', 
        value: report.complianceBreakdown.nonCompliant,
        color: '#EF4444' // red
      }
    ];

    const businessTypePerformance = Object.entries(report.businessTypeBreakdown).map(([type, data]) => ({
      name: type,
      compliant: data.compliant,
      total: data.total,
      rate: data.total > 0 ? Math.round((data.compliant / data.total) * 100) : 0
    }));

    const expirationTimeline = [
      {
        period: 'Expired',
        count: report.expirationAlerts.expiredDocuments,
        type: 'expired' as const
      },
      {
        period: 'Next 30 Days',
        count: report.expirationAlerts.expiringSoon,
        type: 'expiring' as const
      },
      {
        period: 'Next 90 Days',
        count: report.expirationAlerts.expiringNextMonth,
        type: 'expiring' as const
      }
    ];

    const alerts = [];
    
    if (report.expirationAlerts.expiredDocuments > 0) {
      alerts.push({
        type: 'error' as const,
        title: 'Expired Documents',
        message: `${report.expirationAlerts.expiredDocuments} documents have expired`,
        count: report.expirationAlerts.expiredDocuments
      });
    }

    if (report.expirationAlerts.expiringSoon > 0) {
      alerts.push({
        type: 'warning' as const,
        title: 'Expiring Soon',
        message: `${report.expirationAlerts.expiringSoon} documents expire within 30 days`,
        count: report.expirationAlerts.expiringSoon
      });
    }

    if (report.complianceBreakdown.nonCompliant > report.totalSuppliers * 0.2) {
      alerts.push({
        type: 'warning' as const,
        title: 'High Non-Compliance',
        message: `${report.complianceBreakdown.nonCompliant} suppliers are non-compliant`,
        count: report.complianceBreakdown.nonCompliant
      });
    }

    return {
      kpis,
      charts: {
        complianceBreakdown,
        businessTypePerformance,
        expirationTimeline
      },
      alerts
    };
  }

  /**
   * Generate executive summary for stakeholders
   */
  static generateExecutiveSummary(report: ComplianceSummaryReport): string {
    const complianceRate = ((report.complianceBreakdown.compliant / report.totalSuppliers) * 100).toFixed(1);
    const riskSuppliers = report.complianceBreakdown.nonCompliant + report.complianceBreakdown.partial;
    const riskPercentage = ((riskSuppliers / report.totalSuppliers) * 100).toFixed(1);

    let summary = `EXECUTIVE SUMMARY - SUPPLIER COMPLIANCE\n`;
    summary += `${'='.repeat(45)}\n`;
    summary += `Report Date: ${report.generatedAt.toDateString()}\n\n`;

    summary += `KEY METRICS:\n`;
    summary += `• Supplier Network: ${report.totalSuppliers} active suppliers\n`;
    summary += `• Compliance Rate: ${complianceRate}% (${report.complianceBreakdown.compliant} suppliers)\n`;
    summary += `• Average Score: ${report.averageComplianceScore}%\n`;
    summary += `• At-Risk Suppliers: ${riskSuppliers} (${riskPercentage}%)\n\n`;

    // Risk assessment
    let riskLevel = 'LOW';
    if (parseFloat(riskPercentage) > 30) {
      riskLevel = 'HIGH';
    } else if (parseFloat(riskPercentage) > 15) {
      riskLevel = 'MEDIUM';
    }

    summary += `RISK ASSESSMENT: ${riskLevel}\n`;
    if (riskLevel === 'HIGH') {
      summary += `⚠️  IMMEDIATE ACTION REQUIRED\n`;
      summary += `High percentage of non-compliant suppliers poses significant risk\n`;
    } else if (riskLevel === 'MEDIUM') {
      summary += `⚠️  ATTENTION NEEDED\n`;
      summary += `Monitor and improve compliance levels\n`;
    } else {
      summary += `✅ ACCEPTABLE COMPLIANCE LEVELS\n`;
      summary += `Maintain current standards and processes\n`;
    }

    // Critical issues
    if (report.expirationAlerts.expiredDocuments > 0) {
      summary += `\nCRITICAL ISSUES:\n`;
      summary += `• ${report.expirationAlerts.expiredDocuments} EXPIRED documents require immediate renewal\n`;
    }

    if (report.expirationAlerts.expiringSoon > 0) {
      summary += `• ${report.expirationAlerts.expiringSoon} documents expire within 30 days\n`;
    }

    // Top recommendations
    summary += `\nRECOMMENDations:\n`;
    if (report.topIssues.length > 0) {
      summary += `• Address top compliance gap: ${report.topIssues[0]!.issue} (${report.topIssues[0]!.affectedSuppliers} suppliers affected)\n`;
    }
    
    if (parseFloat(complianceRate) < 85) {
      summary += `• Implement compliance improvement program to reach 85% target\n`;
    }
    
    summary += `• Establish proactive document renewal process\n`;
    summary += `• Regular compliance reviews for at-risk suppliers\n`;

    return summary;
  }
}