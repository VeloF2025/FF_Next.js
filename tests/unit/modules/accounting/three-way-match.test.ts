/**
 * PRD-060: FibreFlow Accounting Module
 * Unit Tests: 3-Way Match Validation (PO ↔ GRN ↔ Invoice)
 *
 * TDD Status: RED - Tests written before implementation
 */

import { describe, it, expect } from 'vitest';
import { validateThreeWayMatch } from '@/modules/accounting/utils/threeWayMatch';

describe('Three-Way Match Validation', () => {
  // UT-018: All match perfectly
  it('should return fully_matched when PO, GRN, and Invoice align', () => {
    const result = validateThreeWayMatch({
      poQuantity: 100,
      poUnitPrice: 50,
      grnQuantityReceived: 100,
      invoiceQuantity: 100,
      invoiceUnitPrice: 50,
    });

    expect(result.status).toBe('fully_matched');
    expect(result.quantityMatch).toBe(true);
    expect(result.priceMatch).toBe(true);
    expect(result.grnMatch).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  // UT-019: GRN short
  it('should flag mismatch when GRN received less than PO', () => {
    const result = validateThreeWayMatch({
      poQuantity: 100,
      poUnitPrice: 50,
      grnQuantityReceived: 90,
      invoiceQuantity: 100,
      invoiceUnitPrice: 50,
    });

    expect(result.status).not.toBe('fully_matched');
    expect(result.grnMatch).toBe(false);
    expect(result.mismatches).toEqual(expect.arrayContaining([expect.stringMatching(/grn|received|quantity/i)]));
  });

  // UT-020: Invoice amount over
  it('should flag mismatch when invoice total exceeds PO', () => {
    const result = validateThreeWayMatch({
      poQuantity: 100,
      poUnitPrice: 50,
      grnQuantityReceived: 100,
      invoiceQuantity: 100,
      invoiceUnitPrice: 55, // 10% over
    });

    expect(result.status).not.toBe('fully_matched');
    expect(result.priceMatch).toBe(false);
    expect(result.mismatches).toEqual(expect.arrayContaining([expect.stringMatching(/price|amount|invoice/i)]));
  });

  // UT-021: Within tolerance
  it('should accept match within 2% tolerance', () => {
    const result = validateThreeWayMatch({
      poQuantity: 100,
      poUnitPrice: 50,
      grnQuantityReceived: 100,
      invoiceQuantity: 100,
      invoiceUnitPrice: 50.75, // 1.5% over, within 2% default tolerance
      tolerancePercent: 2,
    });

    expect(result.status).toBe('fully_matched');
    expect(result.priceMatch).toBe(true);
  });

  it('should reject match outside tolerance', () => {
    const result = validateThreeWayMatch({
      poQuantity: 100,
      poUnitPrice: 50,
      grnQuantityReceived: 100,
      invoiceQuantity: 100,
      invoiceUnitPrice: 52, // 4% over, outside 2% tolerance
      tolerancePercent: 2,
    });

    expect(result.status).not.toBe('fully_matched');
    expect(result.priceMatch).toBe(false);
  });

  it('should handle partial GRN receipt (PO matched only)', () => {
    const result = validateThreeWayMatch({
      poQuantity: 100,
      poUnitPrice: 50,
      grnQuantityReceived: 50, // only half received
      invoiceQuantity: 50,
      invoiceUnitPrice: 50,
    });

    // Invoice matches GRN but not full PO
    expect(result.grnMatch).toBe(true);
    expect(result.quantityMatch).toBe(false); // PO qty != Invoice qty
  });

  it('should handle zero quantity gracefully', () => {
    const result = validateThreeWayMatch({
      poQuantity: 100,
      poUnitPrice: 50,
      grnQuantityReceived: 0,
      invoiceQuantity: 100,
      invoiceUnitPrice: 50,
    });

    expect(result.grnMatch).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
  });
});
