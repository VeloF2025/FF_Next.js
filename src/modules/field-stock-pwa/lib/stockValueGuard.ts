/**
 * stockValueGuard — pure module for R5,000 pending-tech issue cap.
 *
 * No React, no fetch, no DOM. Safe to import server-side (Task 2.6).
 *
 * Design decision:
 *   The cap is STRICTLY GREATER THAN (>) not >=. A picking of exactly R5,000
 *   is allowed; R5,000.01 is blocked. This matches the plan wording "limit to
 *   R5 000" which conventionally means up-to-and-including. The server-side
 *   enforcement in Task 2.6 must use the same > semantics.
 *
 * Precision:
 *   Multiplications use Math.round(unitValueZar * quantity * 100) / 100 to
 *   avoid IEEE 754 drift when values are non-integer (e.g. R1,234.56).
 */

// 🟢 WORKING: pure, no side-effects, covered by stockValueGuard.test.ts

/** R5,000 ZAR cap applied while issuing tech has `account_status = 'pending'`. */
export const PENDING_TECH_VALUE_CAP_ZAR = 5000;

/** One line in an issue picking — a single stock-item class with a quantity. */
export interface StockValueLine {
  /**
   * Per-unit value in ZAR (excl VAT), matching `stock_items.standard_cost`
   * as the procurement module stores it.
   */
  unitValueZar: number;
  /** Number of units (serials) being issued. */
  quantity: number;
}

export interface StockValueGuardResult {
  /** Sum of (unitValueZar × quantity) across all lines, rounded to 2 dp. */
  totalZar: number;
  /** The cap that was checked against (PENDING_TECH_VALUE_CAP_ZAR or Infinity). */
  capZar: number;
  /**
   * True only when `accountStatus === 'pending'` AND `totalZar > capZar`.
   * Always false for active/suspended technicians — cap does not apply.
   */
  over: boolean;
}

/**
 * Calculate total ZAR value of an issue and decide whether it exceeds the
 * pending-tech cap.
 *
 * @param lines       One entry per stock-item class in the picking.
 * @param accountStatus  The technician's account_status from the staff table.
 * @returns StockValueGuardResult with totalZar, capZar, and over flag.
 *
 * @example
 * checkPendingValueCap([{ unitValueZar: 1200, quantity: 3 }], 'pending')
 * // => { totalZar: 3600, capZar: 5000, over: false }
 *
 * checkPendingValueCap([{ unitValueZar: 1200, quantity: 5 }], 'pending')
 * // => { totalZar: 6000, capZar: 5000, over: true }
 *
 * checkPendingValueCap([{ unitValueZar: 9999, quantity: 1 }], 'active')
 * // => { totalZar: 9999, capZar: Infinity, over: false }
 */
export function checkPendingValueCap(
  lines: StockValueLine[],
  accountStatus: 'pending' | 'active' | 'suspended',
): StockValueGuardResult {
  // Sum with IEEE-drift guard: round each line to 2 decimal places first.
  const totalZar = lines.reduce<number>((acc, line) => {
    const lineTotal = Math.round(line.unitValueZar * line.quantity * 100) / 100;
    return Math.round((acc + lineTotal) * 100) / 100;
  }, 0);

  if (accountStatus !== 'pending') {
    return { totalZar, capZar: Infinity, over: false };
  }

  return {
    totalZar,
    capZar: PENDING_TECH_VALUE_CAP_ZAR,
    over: totalZar > PENDING_TECH_VALUE_CAP_ZAR,
  };
}
