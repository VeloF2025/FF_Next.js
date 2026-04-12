/**
 * Tracking Error Handlers
 * Specialized handlers for stock tracking and adjustment errors
 */

import { StockTrackingError, StockAdjustmentError } from '../tracking';
import { HandlerUtils } from './handler-utils';

export interface RetryStrategy {
  type: string;
  description: string;
  action: string;
  data: Record<string, unknown>;
  maxAttempts?: number;
  backoffMs?: number;
  estimatedTime?: string;
}

/**
 * Handlers for tracking and adjustment stock errors
 */
export class TrackingHandlers {
  /**
   * Handle stock tracking errors with correction strategies
   */
  static handleTrackingError(error: StockTrackingError): {
    error: StockTrackingError;
    retryStrategies: RetryStrategy[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    autoRecoverable: boolean;
  } {
    const retryStrategies: RetryStrategy[] = [];

    // Resync tracking data
    retryStrategies.push({
      type: 'data_resync',
      description: 'Resynchronize tracking data with master inventory',
      action: 'resync_tracking_data',
      maxAttempts: 2,
      backoffMs: 5000,
      estimatedTime: '2-5 minutes',
      data: {
        itemCode: error.itemCode || 'unknown',
        location: (error.details['location'] as string) || 'unknown',
        syncScope: 'full',
        includeHistory: true
      }
    });

    // Rebuild tracking indexes
    if (error.message.includes('index') || error.message.includes('corruption')) {
      retryStrategies.push({
        type: 'rebuild_indexes',
        description: 'Rebuild tracking data indexes',
        action: 'rebuild_tracking_indexes',
        maxAttempts: 1,
        estimatedTime: '5-10 minutes',
        data: {
          scope: 'affected_items',
          verifyIntegrity: true,
          backupBeforeRebuild: true
        }
      });
    }

    // Manual verification fallback
    retryStrategies.push({
      type: 'manual_verification',
      description: 'Request manual verification of stock levels',
      action: 'request_manual_verification',
      maxAttempts: 1,
      estimatedTime: '30-60 minutes',
      data: {
        itemCode: error.itemCode,
        location: (error.details['location'] as string) || 'unknown',
        discrepancyType: 'tracking_mismatch',
        priority: 'high'
      }
    });

    const severity = HandlerUtils.determineSeverity(error);
    const autoRecoverable = !error.message.includes('corruption') && !error.message.includes('critical');

    return {
      error,
      retryStrategies,
      severity,
      autoRecoverable
    };
  }

  /**
   * Handle stock adjustment errors with validation strategies
   */
  static handleAdjustmentError(error: StockAdjustmentError): {
    error: StockAdjustmentError;
    retryStrategies: RetryStrategy[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    autoRecoverable: boolean;
  } {
    const retryStrategies: RetryStrategy[] = [];

    // Physical recount before adjustment (if not already done)
    if (error.adjustmentType !== 'recount') {
      retryStrategies.push({
        type: 'physical_recount',
        description: 'Perform physical recount before processing adjustment',
        action: 'initiate_physical_recount',
        maxAttempts: 1,
        estimatedTime: '15-30 minutes',
        data: {
          itemCode: error.itemCode,
          location: error.location,
          currentSystemQuantity: error.currentQuantity,
          proposedAdjustment: error.adjustmentQuantity,
          countMethod: 'systematic_audit'
        }
      });
    }

    // Supervisor approval for large adjustments
    const adjustmentSize = Math.abs(error.adjustmentQuantity);
    const adjustmentPercentage = Math.abs(error.adjustmentQuantity / error.currentQuantity * 100);

    if (adjustmentSize > 10 || adjustmentPercentage > 25) {
      retryStrategies.push({
        type: 'supervisor_approval',
        description: `Request supervisor approval for ${adjustmentSize} unit adjustment (${adjustmentPercentage.toFixed(1)}%)`,
        action: 'request_supervisor_approval',
        maxAttempts: 1,
        estimatedTime: '10-30 minutes',
        data: {
          itemCode: error.itemCode,
          location: error.location,
          adjustmentType: error.adjustmentType,
          adjustmentQuantity: error.adjustmentQuantity,
          adjustmentPercentage: adjustmentPercentage.toFixed(1),
          currentQuantity: error.currentQuantity,
          reason: error.adjustmentReason || 'System adjustment',
          approvalLevel: adjustmentPercentage > 50 ? 'manager' : 'supervisor'
        }
      });
    }

    // Split large adjustments into smaller increments
    if (adjustmentSize > 20) {
      const incrementSize = Math.sign(error.adjustmentQuantity) * Math.min(10, Math.floor(adjustmentSize / 3));
      const numberOfIncrements = Math.ceil(adjustmentSize / Math.abs(incrementSize));

      retryStrategies.push({
        type: 'incremental_adjustment',
        description: `Split adjustment into ${numberOfIncrements} increments of ${Math.abs(incrementSize)} units`,
        action: 'split_adjustment_increments',
        maxAttempts: 1,
        estimatedTime: `${numberOfIncrements * 2}-${numberOfIncrements * 5} minutes`,
        data: {
          itemCode: error.itemCode,
          location: error.location,
          totalAdjustment: error.adjustmentQuantity,
          incrementSize,
          numberOfIncrements,
          verifyBetweenIncrements: true,
          pauseBetweenIncrements: 30000 // 30 seconds
        }
      });
    }

    // Audit trail documentation
    retryStrategies.push({
      type: 'enhanced_documentation',
      description: 'Create detailed audit trail for adjustment',
      action: 'create_adjustment_audit_trail',
      maxAttempts: 1,
      estimatedTime: '5-10 minutes',
      data: {
        itemCode: error.itemCode,
        location: error.location,
        adjustmentDetails: {
          type: error.adjustmentType,
          quantity: error.adjustmentQuantity,
          reason: error.adjustmentReason || 'System adjustment',
          beforeQuantity: error.currentQuantity,
          afterQuantity: error.currentQuantity + error.adjustmentQuantity
        },
        requiresPhotographic: adjustmentSize > 50,
        requiresWitnessSignature: adjustmentPercentage > 50
      }
    });

    // System validation retry
    retryStrategies.push({
      type: 'validation_retry',
      description: 'Retry with enhanced system validation',
      action: 'retry_with_validation',
      maxAttempts: 3,
      backoffMs: 2000,
      estimatedTime: '1-3 minutes',
      data: {
        itemCode: error.itemCode,
        location: error.location,
        adjustmentType: error.adjustmentType,
        adjustmentQuantity: error.adjustmentQuantity,
        validateInventoryRules: true,
        checkBusinessConstraints: true,
        verifyDataIntegrity: true
      }
    });

    const severity = this.determineAdjustmentSeverity(error, adjustmentPercentage);
    const autoRecoverable = adjustmentSize <= 5 && adjustmentPercentage <= 10;

    return {
      error,
      retryStrategies,
      severity,
      autoRecoverable
    };
  }

  /**
   * Determine severity for adjustment errors
   */
  private static determineAdjustmentSeverity(error: StockAdjustmentError, adjustmentPercentage: number): 'low' | 'medium' | 'high' | 'critical' {
    // Critical for very large percentage adjustments or high-value items
    if (adjustmentPercentage > 75) {
      return 'critical';
    }

    // High for significant adjustments
    if (adjustmentPercentage > 50 || Math.abs(error.adjustmentQuantity) > 100) {
      return 'high';
    }

    // Medium for moderate adjustments
    if (adjustmentPercentage > 25 || Math.abs(error.adjustmentQuantity) > 20) {
      return 'medium';
    }

    // Low for small adjustments
    return 'low';
  }

  /**
   * Execute tracking retry strategy
   */
  static async executeRetry(retryStrategy: RetryStrategy): Promise<{
    success: boolean;
    result: Record<string, unknown> | undefined;
    error: string | undefined;
    shouldRetry: boolean | undefined;
  }> {
    try {

      switch (retryStrategy.action) {
        case 'resync_tracking_data':
          return {
            success: true,
            result: {
              syncedRecords: Math.floor(Math.random() * 100) + 50,
              discrepanciesFound: Math.floor(Math.random() * 5),
              syncDuration: `${Math.floor(Math.random() * 3) + 1} minutes`,
              integrityVerified: true
            },
            error: undefined,
            shouldRetry: undefined
          };

        case 'rebuild_tracking_indexes':
          return {
            success: true,
            result: {
              indexesRebuilt: ['item_location_idx', 'movement_history_idx', 'quantity_tracking_idx'],
              recordsProcessed: Math.floor(Math.random() * 10000) + 5000,
              integrityScore: 99.8,
              backupCreated: true
            },
            error: undefined,
            shouldRetry: undefined
          };

        case 'initiate_physical_recount': {
          // Simulate recount process
          const sysQty = retryStrategy.data['currentSystemQuantity'] as number;
          const actualCount = sysQty + Math.floor(Math.random() * 10 - 5);
          return {
            success: true,
            result: {
              recountId: `RC-${Date.now()}`,
              systemQuantity: sysQty,
              actualQuantity: actualCount,
              discrepancy: actualCount - sysQty,
              countMethod: retryStrategy.data['countMethod'],
              countedBy: 'warehouse-staff',
              countTimestamp: new Date().toISOString()
            },
            error: undefined,
            shouldRetry: undefined
          };
        }

        case 'request_supervisor_approval':
          return {
            success: true,
            result: {
              approvalRequestId: `APR-${Date.now()}`,
              approvalLevel: retryStrategy.data['approvalLevel'],
              estimatedApprovalTime: retryStrategy.estimatedTime,
              autoNotificationSent: true,
              status: 'pending_approval'
            },
            error: undefined,
            shouldRetry: undefined
          };

        case 'split_adjustment_increments':
          return {
            success: true,
            result: {
              incrementPlan: {
                totalIncrements: retryStrategy.data['numberOfIncrements'],
                incrementSize: retryStrategy.data['incrementSize'],
                estimatedDuration: retryStrategy.estimatedTime
              },
              scheduledExecution: new Date(Date.now() + 60000).toISOString(), // 1 minute from now
              verificationEnabled: retryStrategy.data['verifyBetweenIncrements']
            },
            error: undefined,
            shouldRetry: undefined
          };

        case 'create_adjustment_audit_trail':
          return {
            success: true,
            result: {
              auditId: `AUD-${Date.now()}`,
              documentationComplete: true,
              photographicEvidence: retryStrategy.data['requiresPhotographic'],
              witnessRequired: retryStrategy.data['requiresWitnessSignature'],
              complianceScore: 95
            },
            error: undefined,
            shouldRetry: undefined
          };

        case 'retry_with_validation': {
          // Simulate validation retry with 80% success rate
          const success = Math.random() > 0.2;
          return {
            success,
            result: success ? {
              validationPassed: true,
              adjustmentProcessed: true,
              newQuantity: (retryStrategy.data['adjustmentQuantity'] as number) + (retryStrategy.data['currentQuantity'] as number)
            } : undefined,
            error: success ? undefined : 'Validation failed - data integrity issues detected',
            shouldRetry: !success && (retryStrategy.maxAttempts || 1) > 1
          };
        }

        default:
          return {
            success: true,
            result: { action: retryStrategy.action, executed: true },
            error: undefined,
            shouldRetry: undefined
          };
      }
    } catch (error) {
      return {
        success: false,
        result: undefined,
        error: error instanceof Error ? error.message : 'Unknown error during tracking retry',
        shouldRetry: true
      };
    }
  }

  /**
   * Validate adjustment business rules
   */
  static validateAdjustmentRules(error: StockAdjustmentError): {
    isValid: boolean;
    violations: string[];
    warnings: string[];
  } {
    const violations: string[] = [];
    const warnings: string[] = [];

    // Check for negative stock
    const resultingQuantity = error.currentQuantity + error.adjustmentQuantity;
    if (resultingQuantity < 0) {
      violations.push(`Adjustment would result in negative stock: ${resultingQuantity}`);
    }

    // Check adjustment size limits
    const adjustmentSize = Math.abs(error.adjustmentQuantity);
    const adjustmentPercentage = Math.abs(error.adjustmentQuantity / error.currentQuantity * 100);

    if (adjustmentSize > 1000) {
      violations.push(`Adjustment size exceeds limit: ${adjustmentSize} > 1000`);
    }

    if (adjustmentPercentage > 100) {
      violations.push(`Adjustment percentage exceeds limit: ${adjustmentPercentage.toFixed(1)}% > 100%`);
    }

    // Warnings for large adjustments
    if (adjustmentSize > 50) {
      warnings.push(`Large adjustment detected: ${adjustmentSize} units`);
    }

    if (adjustmentPercentage > 25) {
      warnings.push(`Significant percentage change: ${adjustmentPercentage.toFixed(1)}%`);
    }

    return {
      isValid: violations.length === 0,
      violations,
      warnings
    };
  }
}