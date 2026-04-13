/**
 * Error Aggregator
 * Aggregate and summarize errors for batch operations
 */

import { getErrorSeverity } from '../error.constants';
import { BatchErrorItem, ErrorAggregationResult, IErrorAggregator } from './types';
import { ProcurementErrorProcessor } from './errorProcessor';

export class ProcurementErrorAggregator implements IErrorAggregator {
  private errorProcessor: ProcurementErrorProcessor;

  constructor() {
    this.errorProcessor = new ProcurementErrorProcessor();
  }

  /**
   * Aggregate errors for batch operations with detailed analysis
   */
  aggregateErrors(errors: BatchErrorItem[]): ErrorAggregationResult {
    const errorSummary = {
      total: errors.length,
      byType: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>
    };

    const detailedErrors = errors.map(({ item, error }) => {
      const errorResponse = this.errorProcessor.handleError(error);
      const errorCode = errorResponse.error.code;
      const severity = getErrorSeverity(errorCode);

      // Count by type
      errorSummary.byType[errorCode] = (errorSummary.byType[errorCode] || 0) + 1;
      
      // Count by severity
      errorSummary.bySeverity[severity] = (errorSummary.bySeverity[severity] || 0) + 1;

      return {
        item,
        error: errorResponse.error
      };
    });

    return {
      hasErrors: errors.length > 0,
      errorSummary,
      detailedErrors
    };
  }

  /**
   * Simple error summary for quick analysis
   */
  summarizeErrors(errors: unknown[]): { total: number; byType: Record<string, number> } {
    const summary = {
      total: errors.length,
      byType: {} as Record<string, number>
    };

    errors.forEach(error => {
      const errorResponse = this.errorProcessor.handleError(error);
      const errorCode = errorResponse.error.code;
      summary.byType[errorCode] = (summary.byType[errorCode] || 0) + 1;
    });

    return summary;
  }

  /**
   * Get most common error types
   */
  getMostCommonErrors(
    errors: BatchErrorItem[], 
    limit: number = 5
  ): Array<{ code: string; message: string; count: number; }> {
    const aggregation = this.aggregateErrors(errors);
    
    return Object.entries(aggregation.errorSummary.byType)
      .map(([code, count]) => ({
        code,
        message: `Common error type: ${code}`,
        count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get error distribution by severity
   */
  getErrorDistributionBySeverity(errors: BatchErrorItem[]): Array<{
    severity: string;
    count: number;
    percentage: number;
    types: string[];
  }> {
    const aggregation = this.aggregateErrors(errors);
    const total = aggregation.errorSummary.total;
    
    return Object.entries(aggregation.errorSummary.bySeverity)
      .map(([severity, count]) => {
        // Get error types for this severity
        const types = Object.keys(aggregation.errorSummary.byType)
          .filter(type => getErrorSeverity(type) === severity);
        
        return {
          severity,
          count,
          percentage: Math.round((count / total) * 100),
          types
        };
      })
      .sort((a, b) => {
        // Sort by severity priority
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        return (severityOrder[b.severity as keyof typeof severityOrder] || 0) - 
               (severityOrder[a.severity as keyof typeof severityOrder] || 0);
      });
  }

  /**
   * Create error report for batch operations
   */
  createErrorReport(errors: BatchErrorItem[]): {
    summary: ErrorAggregationResult['errorSummary'];
    mostCommon: Array<{ code: string; message: string; count: number; }>;
    bySeverity: Record<string, number>;
    recommendations: string[];
    criticalIssues: Array<{ item: unknown; error: { code: string; [key: string]: unknown } }>;
  } {
    const aggregation = this.aggregateErrors(errors);
    const mostCommon = this.getMostCommonErrors(errors);
    const bySeverity = aggregation.errorSummary.bySeverity;
    
    // Extract critical issues
    const criticalIssues = aggregation.detailedErrors.filter(
      ({ error }) => getErrorSeverity(error.code) === 'critical'
    );

    // Generate recommendations based on error patterns
    const recommendations = this.generateRecommendations(mostCommon, bySeverity);

    return {
      summary: aggregation.errorSummary,
      mostCommon,
      bySeverity,
      recommendations,
      criticalIssues
    };
  }

  /**
   * Generate recommendations based on error patterns
   */
  private generateRecommendations(
    mostCommon: Array<{ code: string; message: string; count: number; }>,
    bySeverity: Record<string, number>
  ): string[] {
    const recommendations: string[] = [];

    // Check for high validation error rate
    const validationErrors = mostCommon.find(e => e.code === 'VALIDATION_ERROR');
    if (validationErrors && validationErrors.count > 10) {
      recommendations.push('High validation error rate detected. Review input data quality and validation rules.');
    }

    // Check for network/service errors
    const serviceErrors = mostCommon.find(e => 
      e.code === 'EXTERNAL_SERVICE_ERROR' || e.code === 'API_RATE_LIMIT'
    );
    if (serviceErrors && serviceErrors.count > 5) {
      recommendations.push('External service issues detected. Consider implementing retry logic and circuit breakers.');
    }

    // Check for permission errors
    const permissionErrors = mostCommon.find(e => e.code === 'INSUFFICIENT_PERMISSIONS');
    if (permissionErrors && permissionErrors.count > 3) {
      recommendations.push('Permission errors detected. Review user access controls and role assignments.');
    }

    // Check for critical severity
    const criticalCount = bySeverity.critical || 0;
    if (criticalCount > 2) {
      recommendations.push('Critical errors detected. Immediate investigation and resolution required.');
    }

    // Check for high error rate overall
    if (mostCommon.length > 0 && mostCommon[0]!.count > 20) {
      recommendations.push('Single error type dominates failures. Focus on resolving the primary issue first.');
    }

    // Default recommendation if no specific patterns
    if (recommendations.length === 0) {
      recommendations.push('Review error patterns and implement appropriate error handling strategies.');
    }

    return recommendations;
  }

  /**
   * Filter errors by severity
   */
  filterErrorsBySeverity(
    errors: BatchErrorItem[], 
    severityFilter: string | string[]
  ): BatchErrorItem[] {
    const severities = Array.isArray(severityFilter) ? severityFilter : [severityFilter];
    
    return errors.filter(({ error }) => {
      const errorResponse = this.errorProcessor.handleError(error);
      const severity = getErrorSeverity(errorResponse.error.code);
      return severities.includes(severity);
    });
  }

  /**
   * Group errors by type
   */
  groupErrorsByType(errors: BatchErrorItem[]): Record<string, BatchErrorItem[]> {
    const groups: Record<string, BatchErrorItem[]> = {};
    
    errors.forEach(errorItem => {
      const errorResponse = this.errorProcessor.handleError(errorItem.error);
      const errorType = errorResponse.error.code;
      
      if (!groups[errorType]) {
        groups[errorType] = [];
      }
      groups[errorType].push(errorItem);
    });
    
    return groups;
  }
}