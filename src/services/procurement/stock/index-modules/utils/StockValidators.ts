/**
 * Stock Validators
 * Validation functions for stock data
 */

/**
 * Validate stock movement data
 */
interface MovementData {
  projectId?: unknown;
  movementType?: unknown;
  referenceNumber?: unknown;
  movementDate?: unknown;
}

export function validateMovementData(movementData: MovementData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!movementData.projectId) errors.push('Project ID is required');
  if (!movementData.movementType) errors.push('Movement type is required');
  if (!movementData.referenceNumber) errors.push('Reference number is required');
  if (!movementData.movementDate) errors.push('Movement date is required');

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate stock position data
 */
interface PositionData {
  projectId?: unknown;
  itemCode?: unknown;
  itemName?: unknown;
  uom?: unknown;
  onHandQuantity?: number;
  reorderLevel?: number;
}

export function validatePositionData(positionData: PositionData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!positionData.projectId) errors.push('Project ID is required');
  if (!positionData.itemCode) errors.push('Item code is required');
  if (!positionData.itemName) errors.push('Item name is required');
  if (!positionData.uom) errors.push('Unit of measure is required');

  if (positionData.onHandQuantity && positionData.onHandQuantity < 0) {
    errors.push('On-hand quantity cannot be negative');
  }

  if (positionData.reorderLevel && positionData.reorderLevel < 0) {
    errors.push('Reorder level cannot be negative');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
