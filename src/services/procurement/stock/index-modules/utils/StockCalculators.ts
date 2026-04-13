/**
 * Stock Calculators
 * Calculation functions for stock metrics
 */

interface StockPosition {
  onHandQuantity?: number;
  averageUnitCost?: number;
  availableQuantity?: number;
  reorderLevel?: number;
}

/**
 * Calculate stock value from position
 */
export function calculatePositionValue(position: StockPosition): number {
  const quantity = position.onHandQuantity || 0;
  const cost = position.averageUnitCost || 0;
  return quantity * cost;
}

/**
 * Determine if item needs reordering
 */
export function needsReorder(position: StockPosition): boolean {
  const availableQuantity = position.availableQuantity || 0;
  const reorderLevel = position.reorderLevel || 0;
  return reorderLevel > 0 && availableQuantity <= reorderLevel;
}

/**
 * Calculate stock coverage in days
 */
export function calculateStockCoverage(position: StockPosition, dailyUsage: number): number {
  if (dailyUsage <= 0) return 0;
  const availableQuantity = position.availableQuantity || 0;
  return Math.floor(availableQuantity / dailyUsage);
}

/**
 * Calculate fill rate for items
 */
export function calculateFillRate(demanded: number, supplied: number): number {
  if (demanded <= 0) return 0;
  return Math.round((supplied / demanded) * 100);
}
