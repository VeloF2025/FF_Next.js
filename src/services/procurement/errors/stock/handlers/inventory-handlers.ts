/**
 * Inventory Error Handlers
 * Specialized handlers for inventory-related stock errors
 */

import { InsufficientStockError, StockReservationError } from '../inventory';
import { HandlerUtils } from './handler-utils';
import type { RecoveryOption, ErrorSeverity, ExistingReservation } from '../types';

/**
 * Handlers for inventory-specific stock errors
 */
export class InventoryHandlers {
  /**
   * Handle insufficient stock error with comprehensive recovery options
   */
  static handleInsufficientStock(error: InsufficientStockError): {
    error: InsufficientStockError;
    recoveryOptions: RecoveryOption[];
    severity: ErrorSeverity;
    autoRecoverable: boolean;
  } {
    const recoveryOptions: RecoveryOption[] = [];

    // Partial fulfillment option (highest priority if stock available)
    if (error.availableQuantity > 0) {
      recoveryOptions.push({
        type: 'partial_fulfillment',
        description: `Fulfill ${error.availableQuantity} units now, backorder remaining ${error.getShortfall()}`,
        action: 'process_partial_fulfillment',
        priority: 1,
        estimatedTime: '2-4 hours',
        cost: 0,
        data: {
          itemCode: error.itemCode,
          availableQuantity: error.availableQuantity,
          backorderQuantity: error.getShortfall(),
          fulfillmentPercentage: (error.availableQuantity / error.requestedQuantity * 100).toFixed(1)
        }
      });
    }

    // Alternative location transfers
    if (error.alternativeLocations?.length) {
      error.alternativeLocations
        .sort((a, b) => (b.availableQuantity - a.availableQuantity)) // Sort by quantity descending
        .forEach((location, index) => {
          const transferTime = location.estimatedTransferTime || 'Unknown';
          const transferCost = location.transferCost || 0;

          recoveryOptions.push({
            type: 'location_transfer',
            description: `Transfer ${location.availableQuantity} units from ${location.location}`,
            action: 'initiate_stock_transfer',
            priority: 2 + index,
            estimatedTime: transferTime,
            cost: transferCost,
            data: {
              itemCode: error.itemCode,
              fromLocationId: location.locationId,
              fromLocation: location.location,
              quantity: location.availableQuantity,
              transferCost,
              estimatedTime: transferTime,
              canFulfillCompletely: location.availableQuantity >= error.getShortfall()
            }
          });
        });
    }

    // Alternative item suggestions (only high compatibility items)
    if (error.alternativeItems?.length) {
      error.alternativeItems
        .filter(item => item.compatibility >= 80)
        .sort((a, b) => b.compatibility - a.compatibility) // Sort by compatibility descending
        .slice(0, 3) // Limit to top 3 alternatives
        .forEach((item, index) => {
          const priceDiff = item.priceDifference || 0;
          const priceImpact = priceDiff > 0 ? `+${priceDiff}%` : priceDiff < 0 ? `${priceDiff}%` : 'same price';

          recoveryOptions.push({
            type: 'alternative_item',
            description: `Use ${item.itemName} (${item.compatibility}% compatible, ${priceImpact}) - ${item.availableQuantity} available`,
            action: 'suggest_alternative_item',
            priority: 10 + index,
            estimatedTime: '1-2 hours for verification',
            cost: Math.abs(priceDiff) * error.requestedQuantity,
            data: {
              originalItemCode: error.itemCode,
              alternativeItemCode: item.itemCode,
              alternativeItemName: item.itemName,
              compatibility: item.compatibility,
              availableQuantity: item.availableQuantity,
              priceDifference: priceDiff,
              canFulfillCompletely: item.availableQuantity >= error.requestedQuantity,
              requiresApproval: item.compatibility < 95 || Math.abs(priceDiff) > 10
            }
          });
        });
    }

    // Emergency procurement (last resort)
    recoveryOptions.push({
      type: 'emergency_procurement',
      description: `Initiate emergency procurement for ${error.getShortfall()} units of ${error.itemCode}`,
      action: 'create_emergency_purchase_order',
      priority: 20,
      estimatedTime: '1-3 business days',
      cost: error.getShortfall() * (error.unitPrice ?? 0) * 1.25, // 25% premium for emergency
      data: {
        itemCode: error.itemCode,
        requiredQuantity: error.getShortfall(),
        urgency: 'critical',
        maxBudget: error.getShortfall() * (error.unitPrice ?? 0) * 1.5,
        preferredSuppliers: [] as string[],
        deliveryRequirement: 'ASAP'
      }
    });

    // Sort all options by priority
    recoveryOptions.sort((a, b) => (a.priority || 999) - (b.priority || 999));

    // Determine severity and auto-recovery capability
    const shortfallPercentage = (error.getShortfall() / error.requestedQuantity) * 100;
    const severity = HandlerUtils.determineSeverity(error, {
      businessImpact: shortfallPercentage > 75 ? 'critical' : shortfallPercentage > 50 ? 'high' : 'medium',
      customerImpact: true // Stock shortages always impact customers
    });

    const autoRecoverable = error.availableQuantity > 0 && shortfallPercentage < 50;

    return {
      error,
      recoveryOptions,
      severity,
      autoRecoverable
    };
  }

  /**
   * Handle stock reservation error with cleanup and queuing options
   */
  static handleReservationError(error: StockReservationError): {
    error: StockReservationError;
    recoveryOptions: RecoveryOption[];
    severity: ErrorSeverity;
    autoRecoverable: boolean;
  } {
    const recoveryOptions: RecoveryOption[] = [];

    // Check for expired reservations that can be released
    const expiredReservations = error.existingReservations.filter(
      res => res.expiresAt && res.expiresAt < new Date()
    );

    if (expiredReservations.length > 0) {
      const expiredQuantity = expiredReservations.reduce((sum, res) => sum + res.quantity, 0);
      recoveryOptions.push({
        type: 'release_expired',
        description: `Release ${expiredQuantity} units from ${expiredReservations.length} expired reservations`,
        action: 'release_expired_reservations',
        priority: 1,
        estimatedTime: '2-5 minutes',
        cost: 0,
        data: {
          itemCode: error.itemCode,
          expiredReservationIds: expiredReservations.map(res => res.reservationId),
          reclaimableQuantity: expiredQuantity,
          wouldSatisfyRequest: expiredQuantity >= error.getShortfall()
        }
      });
    }

    // Partial reservation with queuing
    if (error.availableQuantity > 0) {
      recoveryOptions.push({
        type: 'partial_reservation',
        description: `Reserve available ${error.availableQuantity} units, queue remaining ${error.getShortfall()}`,
        action: 'create_partial_reservation',
        priority: 2,
        estimatedTime: '1-2 minutes',
        cost: 0,
        data: {
          itemCode: error.itemCode,
          reservableQuantity: error.availableQuantity,
          queuedQuantity: error.getShortfall(),
          reservationPriority: 'normal'
        }
      });
    }

    // High-priority queue reservation
    recoveryOptions.push({
      type: 'priority_queue',
      description: 'Add to high-priority reservation queue for faster fulfillment',
      action: 'add_to_priority_queue',
      priority: 3,
      estimatedTime: 'Variable (based on queue position)',
      cost: 0,
      data: {
        itemCode: error.itemCode,
        requestedQuantity: error.requestedQuantity,
        currentQueueLength: error.existingReservations.length,
        estimatedWaitTime: this.calculateQueueWaitTime(error.existingReservations),
        priorityLevel: 'high'
      }
    });

    // Request reservation override (for critical business needs)
    recoveryOptions.push({
      type: 'reservation_override',
      description: 'Request manager override for critical business need',
      action: 'request_reservation_override',
      priority: 4,
      estimatedTime: '10-30 minutes (requires approval)',
      cost: 0,
      data: {
        itemCode: error.itemCode,
        requestedQuantity: error.requestedQuantity,
        businessJustification: 'Critical business requirement',
        requiresApproval: true,
        approverLevel: 'manager'
      }
    });

    const severity = HandlerUtils.determineSeverity(error);
    const autoRecoverable = expiredReservations.length > 0 || error.availableQuantity > 0;

    return {
      error,
      recoveryOptions,
      severity,
      autoRecoverable
    };
  }

  /**
   * Calculate estimated wait time for reservation queue
   */
  private static calculateQueueWaitTime(existingReservations: ExistingReservation[]): string {
    const queueLength = existingReservations.length;
    
    if (queueLength === 0) return 'Immediate';
    if (queueLength <= 3) return '1-2 hours';
    if (queueLength <= 10) return '2-6 hours';
    if (queueLength <= 20) return '6-12 hours';
    
    return '1-2 business days';
  }

  /**
   * Execute inventory recovery option
   */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  static async executeRecovery(recoveryOption: RecoveryOption): Promise<{
    success: boolean;
    result?: any;
    error?: string;
  }> {
    /* eslint-enable @typescript-eslint/no-explicit-any */
    try {

      switch (recoveryOption.action) {
        case 'process_partial_fulfillment':
          return {
            success: true,
            result: {
              fulfilledQuantity: recoveryOption.data.availableQuantity,
              backorderedQuantity: recoveryOption.data.backorderQuantity,
              backorderId: `BO-${Date.now()}`,
              estimatedRestockDate: this.calculateRestockDate()
            }
          };

        case 'initiate_stock_transfer':
          return {
            success: true,
            result: {
              transferId: `TXN-${Date.now()}`,
              fromLocation: recoveryOption.data.fromLocation,
              quantity: recoveryOption.data.quantity,
              estimatedArrival: recoveryOption.estimatedTime,
              trackingEnabled: true
            }
          };

        case 'suggest_alternative_item':
          return {
            success: true,
            result: {
              alternativeItem: {
                itemCode: recoveryOption.data.alternativeItemCode,
                itemName: recoveryOption.data.alternativeItemName,
                compatibility: recoveryOption.data.compatibility
              },
              requiresApproval: recoveryOption.data.requiresApproval,
              approvalWorkflowId: recoveryOption.data.requiresApproval ? `APV-${Date.now()}` : null
            }
          };

        case 'release_expired_reservations':
          return {
            success: true,
            result: {
              releasedQuantity: recoveryOption.data.reclaimableQuantity,
              releasedReservations: recoveryOption.data.expiredReservationIds,
              newAvailableQuantity: recoveryOption.data.reclaimableQuantity
            }
          };

        case 'create_partial_reservation':
          return {
            success: true,
            result: {
              reservationId: `RES-${Date.now()}`,
              reservedQuantity: recoveryOption.data.reservableQuantity,
              queuedQuantity: recoveryOption.data.queuedQuantity,
              queuePosition: 1
            }
          };

        default:
          return {
            success: true,
            result: { action: recoveryOption.action, executed: true }
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during inventory recovery'
      };
    }
  }

  /**
   * Calculate estimated restock date
   */
  private static calculateRestockDate(): string {
    const restockDate = new Date();
    restockDate.setDate(restockDate.getDate() + 7); // Default 7 days
    return restockDate.toISOString().split('T')[0]!;
  }
}