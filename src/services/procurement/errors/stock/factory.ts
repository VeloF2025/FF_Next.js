/**
 * Stock Error Factory
 * Factory for creating appropriate error instances
 */

import { InsufficientStockError, StockReservationError } from './inventory';
import { StockMovementError, StockTransferError, StockAdjustmentError, StockTrackingError } from './tracking';
import type {
  MovementType,
  AdjustmentType,
  InsufficientStockOptions,
  MovementOptions,
  TransferOptions,
  AdjustmentOptions,
  TrackingOptions,
  ExistingReservation
} from './types';

/**
 * Stock error factory for creating appropriate error instances
 */
export class StockErrorFactory {
  /**
   * Create an insufficient stock error
   */
  static createInsufficientStockError(
    itemCode: string,
    requestedQuantity: number,
    availableQuantity: number,
    options?: InsufficientStockOptions,
    context?: Record<string, unknown>
  ): InsufficientStockError {
    return new InsufficientStockError(itemCode, requestedQuantity, availableQuantity, options, context);
  }

  /**
   * Create a stock movement error
   */
  static createMovementError(
    message: string,
    movementType: MovementType,
    itemCode: string,
    quantity: number,
    options?: MovementOptions,
    context?: Record<string, unknown>
  ): StockMovementError {
    return new StockMovementError(message, movementType, itemCode, quantity, options, context);
  }

  /**
   * Create a stock reservation error
   */
  static createReservationError(
    itemCode: string,
    requestedQuantity: number,
    availableQuantity: number,
    existingReservations: ExistingReservation[],
    context?: Record<string, unknown>
  ): StockReservationError {
    return new StockReservationError(itemCode, requestedQuantity, availableQuantity, existingReservations, context);
  }

  /**
   * Create a stock transfer error
   */
  static createTransferError(
    itemCode: string,
    fromLocation: string,
    toLocation: string,
    quantity: number,
    reason: string,
    options?: TransferOptions,
    context?: Record<string, unknown>
  ): StockTransferError {
    return new StockTransferError(itemCode, fromLocation, toLocation, quantity, reason, options, context);
  }

  /**
   * Create a stock adjustment error
   */
  static createAdjustmentError(
    itemCode: string,
    location: string,
    adjustmentType: AdjustmentType,
    adjustmentQuantity: number,
    currentQuantity: number,
    message: string,
    options?: AdjustmentOptions,
    context?: Record<string, unknown>
  ): StockAdjustmentError {
    return new StockAdjustmentError(
      itemCode,
      location,
      adjustmentType,
      adjustmentQuantity,
      currentQuantity,
      message,
      options,
      context
    );
  }

  /**
   * Create a stock tracking error
   */
  static createTrackingError(
    message: string,
    itemCode: string,
    operationType: string,
    details: Record<string, unknown> = {},
    options?: TrackingOptions,
    context?: Record<string, unknown>
  ): StockTrackingError {
    return new StockTrackingError(message, itemCode, operationType, details, options, context);
  }

  /**
   * Create error from generic parameters
   */
  static createFromType(
    errorType: string,
    parameters: Record<string, unknown>
  ): InsufficientStockError | StockMovementError | StockReservationError | StockTransferError | StockAdjustmentError | StockTrackingError {
    switch (errorType) {
      case 'InsufficientStockError':
        return this.createInsufficientStockError(
          parameters.itemCode as string,
          parameters.requestedQuantity as number,
          parameters.availableQuantity as number,
          parameters.options as InsufficientStockOptions | undefined,
          parameters.context as Record<string, unknown> | undefined
        );

      case 'StockMovementError':
        return this.createMovementError(
          parameters.message as string,
          parameters.movementType as MovementType,
          parameters.itemCode as string,
          parameters.quantity as number,
          parameters.options as MovementOptions | undefined,
          parameters.context as Record<string, unknown> | undefined
        );

      case 'StockReservationError':
        return this.createReservationError(
          parameters.itemCode as string,
          parameters.requestedQuantity as number,
          parameters.availableQuantity as number,
          parameters.existingReservations as ExistingReservation[],
          parameters.context as Record<string, unknown> | undefined
        );

      case 'StockTransferError':
        return this.createTransferError(
          parameters.itemCode as string,
          parameters.fromLocation as string,
          parameters.toLocation as string,
          parameters.quantity as number,
          parameters.reason as string,
          parameters.options as TransferOptions | undefined,
          parameters.context as Record<string, unknown> | undefined
        );

      case 'StockAdjustmentError':
        return this.createAdjustmentError(
          parameters.itemCode as string,
          parameters.location as string,
          parameters.adjustmentType as AdjustmentType,
          parameters.adjustmentQuantity as number,
          parameters.currentQuantity as number,
          parameters.message as string,
          parameters.options as AdjustmentOptions | undefined,
          parameters.context as Record<string, unknown> | undefined
        );

      case 'StockTrackingError':
        return this.createTrackingError(
          parameters.message as string,
          parameters.itemCode as string,
          parameters.operationType as string,
          (parameters.details as Record<string, unknown>) || {},
          parameters.options as TrackingOptions | undefined,
          parameters.context as Record<string, unknown> | undefined
        );

      default:
        throw new Error(`Unknown error type: ${errorType}`);
    }
  }

  /**
   * Validate error creation parameters
   */
  static validateParameters(errorType: string, parameters: Record<string, unknown>): boolean {
    const requiredFields = {
      InsufficientStockError: ['itemCode', 'requestedQuantity', 'availableQuantity'],
      StockMovementError: ['message', 'movementType', 'itemCode', 'quantity'],
      StockReservationError: ['itemCode', 'requestedQuantity', 'availableQuantity', 'existingReservations'],
      StockTransferError: ['itemCode', 'fromLocation', 'toLocation', 'quantity', 'reason'],
      StockAdjustmentError: ['itemCode', 'location', 'adjustmentType', 'adjustmentQuantity', 'currentQuantity', 'message'],
      StockTrackingError: ['message', 'itemCode', 'operationType']
    };

    const required = requiredFields[errorType as keyof typeof requiredFields];
    if (!required) {
      return false;
    }

    return required.every(field => Object.prototype.hasOwnProperty.call(parameters, field) && parameters[field] !== undefined);
  }

  /**
   * Create error with validation
   */
  static createValidated(
    errorType: string,
    parameters: Record<string, unknown>
  ): InsufficientStockError | StockMovementError | StockReservationError | StockTransferError | StockAdjustmentError | StockTrackingError {
    if (!this.validateParameters(errorType, parameters)) {
      throw new Error(`Invalid parameters for error type: ${errorType}`);
    }

    return this.createFromType(errorType, parameters);
  }
}
