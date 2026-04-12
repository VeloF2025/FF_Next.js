/**
 * Stock Movement and Tracking Errors
 * Errors related to stock movements, transfers, and tracking operations
 */

import { StockError } from './inventory';
import type { 
  MovementType, 
  AdjustmentType, 
  MovementOptions, 
  TransferOptions, 
  AdjustmentOptions,
  TrackingOptions 
} from './types';

/**
 * Stock movement error for tracking issues
 */
export class StockMovementError extends StockError {
  public readonly movementType: MovementType;
  public readonly fromLocation?: string;
  public readonly toLocation?: string;
  public readonly itemCode: string;
  public readonly quantity: number;
  public readonly movementId?: string;

  constructor(
    message: string,
    movementType: MovementType,
    itemCode: string,
    quantity: number,
    options?: MovementOptions,
    context?: Record<string, unknown>
  ) {
    super(message, 'STOCK_MOVEMENT_FAILED', 400, context);
    this.name = 'StockMovementError';
    this.movementType = movementType;
    this.itemCode = itemCode;
    this.quantity = quantity;
    if (options?.fromLocation !== undefined) this.fromLocation = options.fromLocation;
    if (options?.toLocation !== undefined) this.toLocation = options.toLocation;
    if (options?.movementId !== undefined) this.movementId = options.movementId;
    Object.setPrototypeOf(this, StockMovementError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      movementType: this.movementType,
      itemCode: this.itemCode,
      quantity: this.quantity,
      fromLocation: this.fromLocation,
      toLocation: this.toLocation,
      movementId: this.movementId
    };
  }

  /**
   * Get movement description
   */
  getMovementDescription(): string {
    switch (this.movementType) {
      case 'inbound':
        return `Receiving ${this.quantity} units of ${this.itemCode}${this.toLocation ? ` to ${this.toLocation}` : ''}`;
      case 'outbound':
        return `Issuing ${this.quantity} units of ${this.itemCode}${this.fromLocation ? ` from ${this.fromLocation}` : ''}`;
      case 'transfer':
        return `Transferring ${this.quantity} units of ${this.itemCode} from ${this.fromLocation} to ${this.toLocation}`;
      case 'adjustment':
        return `Adjusting ${this.quantity} units of ${this.itemCode}${this.fromLocation ? ` at ${this.fromLocation}` : ''}`;
      default:
        return `Stock movement of ${this.quantity} units of ${this.itemCode}`;
    }
  }
}

/**
 * Stock transfer error for location-to-location movement issues
 */
export class StockTransferError extends StockError {
  public readonly itemCode: string;
  public readonly fromLocation: string;
  public readonly toLocation: string;
  public readonly quantity: number;
  public readonly transferId?: string;
  public readonly reason: string;

  constructor(
    itemCode: string,
    fromLocation: string,
    toLocation: string,
    quantity: number,
    reason: string,
    options?: TransferOptions,
    context?: Record<string, unknown>
  ) {
    const message = `Stock transfer failed: ${reason}`;
    super(message, 'STOCK_TRANSFER_FAILED', 400, context);
    this.name = 'StockTransferError';
    this.itemCode = itemCode;
    this.fromLocation = fromLocation;
    this.toLocation = toLocation;
    this.quantity = quantity;
    this.reason = reason;
    if (options?.transferId !== undefined) this.transferId = options.transferId;
    Object.setPrototypeOf(this, StockTransferError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      itemCode: this.itemCode,
      fromLocation: this.fromLocation,
      toLocation: this.toLocation,
      quantity: this.quantity,
      reason: this.reason,
      transferId: this.transferId,
      transferDescription: this.getTransferDescription()
    };
  }

  /**
   * Get transfer description
   */
  getTransferDescription(): string {
    return `Transfer ${this.quantity} units of ${this.itemCode} from ${this.fromLocation} to ${this.toLocation}`;
  }
}

/**
 * Stock adjustment error for inventory adjustments
 */
export class StockAdjustmentError extends StockError {
  public readonly itemCode: string;
  public readonly location: string;
  public readonly adjustmentType: AdjustmentType;
  public readonly adjustmentQuantity: number;
  public readonly currentQuantity: number;
  public readonly adjustmentReason?: string;

  constructor(
    itemCode: string,
    location: string,
    adjustmentType: AdjustmentType,
    adjustmentQuantity: number,
    currentQuantity: number,
    message: string,
    options?: AdjustmentOptions,
    context?: Record<string, unknown>
  ) {
    super(message, 'STOCK_ADJUSTMENT_FAILED', 400, context);
    this.name = 'StockAdjustmentError';
    this.itemCode = itemCode;
    this.location = location;
    this.adjustmentType = adjustmentType;
    this.adjustmentQuantity = adjustmentQuantity;
    this.currentQuantity = currentQuantity;
    if (options?.adjustmentReason !== undefined) this.adjustmentReason = options.adjustmentReason;
    Object.setPrototypeOf(this, StockAdjustmentError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      itemCode: this.itemCode,
      location: this.location,
      adjustmentType: this.adjustmentType,
      adjustmentQuantity: this.adjustmentQuantity,
      currentQuantity: this.currentQuantity,
      adjustmentReason: this.adjustmentReason,
      projectedQuantity: this.getProjectedQuantity(),
      adjustmentDescription: this.getAdjustmentDescription()
    };
  }

  /**
   * Get projected quantity after adjustment
   */
  getProjectedQuantity(): number {
    switch (this.adjustmentType) {
      case 'increase':
        return this.currentQuantity + this.adjustmentQuantity;
      case 'decrease':
        return Math.max(0, this.currentQuantity - this.adjustmentQuantity);
      case 'recount':
        return this.adjustmentQuantity;
      default:
        return this.currentQuantity;
    }
  }

  /**
   * Get adjustment description
   */
  getAdjustmentDescription(): string {
    switch (this.adjustmentType) {
      case 'increase':
        return `Increase stock of ${this.itemCode} at ${this.location} by ${this.adjustmentQuantity} units`;
      case 'decrease':
        return `Decrease stock of ${this.itemCode} at ${this.location} by ${this.adjustmentQuantity} units`;
      case 'recount':
        return `Recount stock of ${this.itemCode} at ${this.location} to ${this.adjustmentQuantity} units`;
      default:
        return `Adjust stock of ${this.itemCode} at ${this.location}`;
    }
  }
}

/**
 * Stock tracking error for general tracking issues
 */
export class StockTrackingError extends StockError {
  public readonly itemCode: string;
  public readonly trackingId?: string;
  public readonly operationType: string;
  public readonly details: Record<string, unknown>;

  constructor(
    message: string,
    itemCode: string,
    operationType: string,
    details: Record<string, unknown> = {},
    options?: TrackingOptions,
    context?: Record<string, unknown>
  ) {
    super(message, 'STOCK_TRACKING_FAILED', 400, context);
    this.name = 'StockTrackingError';
    this.itemCode = itemCode;
    this.operationType = operationType;
    this.details = details;
    if (options?.trackingId !== undefined) this.trackingId = options.trackingId;
    Object.setPrototypeOf(this, StockTrackingError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      itemCode: this.itemCode,
      operationType: this.operationType,
      details: this.details,
      trackingId: this.trackingId
    };
  }
}