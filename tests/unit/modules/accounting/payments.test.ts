/**
 * PRD-060: FibreFlow Accounting Module
 * Unit Tests: Payment Allocation Logic
 *
 * TDD Status: RED - Tests written before implementation
 */

import { describe, it, expect } from 'vitest';
import { validatePaymentAllocations } from '@/modules/accounting/utils/paymentAllocation';
import type { InvoiceForAllocation } from '@/modules/accounting/types/ap.types';

describe('Payment Allocation', () => {
  const invoices: InvoiceForAllocation[] = [
    { id: 'inv-1', invoiceNumber: 'INV-001', totalAmount: 10000, amountPaid: 0, balance: 10000 },
    { id: 'inv-2', invoiceNumber: 'INV-002', totalAmount: 5000, amountPaid: 2000, balance: 3000 },
    { id: 'inv-3', invoiceNumber: 'INV-003', totalAmount: 8000, amountPaid: 0, balance: 8000 },
  ];

  // UT-035: Partial payment
  it('should allocate partial payment to single invoice', () => {
    const result = validatePaymentAllocations(
      6000,
      [{ invoiceId: 'inv-1', amount: 6000 }],
      invoices
    );

    expect(result.valid).toBe(true);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].amount).toBe(6000);
    expect(result.allocations[0].newBalance).toBe(4000);
    expect(result.allocations[0].fullyPaid).toBe(false);
    expect(result.totalAllocated).toBe(6000);
    expect(result.unallocated).toBe(0);
  });

  it('should allocate full payment to single invoice', () => {
    const result = validatePaymentAllocations(
      10000,
      [{ invoiceId: 'inv-1', amount: 10000 }],
      invoices
    );

    expect(result.valid).toBe(true);
    expect(result.allocations[0].fullyPaid).toBe(true);
    expect(result.allocations[0].newBalance).toBe(0);
  });

  // UT-036: Overpayment rejected
  it('should reject allocation exceeding invoice balance', () => {
    const result = validatePaymentAllocations(
      12000,
      [{ invoiceId: 'inv-1', amount: 12000 }],
      invoices
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/exceed|overpayment|balance/i)]));
  });

  it('should reject allocation exceeding remaining balance (partially paid invoice)', () => {
    const result = validatePaymentAllocations(
      5000,
      [{ invoiceId: 'inv-2', amount: 5000 }], // balance is only 3000
      invoices
    );

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // UT-037: Multi-invoice allocation
  it('should allocate payment across multiple invoices', () => {
    const result = validatePaymentAllocations(
      15000,
      [
        { invoiceId: 'inv-1', amount: 10000 },
        { invoiceId: 'inv-2', amount: 3000 },
        { invoiceId: 'inv-3', amount: 2000 },
      ],
      invoices
    );

    expect(result.valid).toBe(true);
    expect(result.allocations).toHaveLength(3);
    expect(result.totalAllocated).toBe(15000);
    expect(result.unallocated).toBe(0);

    // First invoice fully paid
    expect(result.allocations[0].fullyPaid).toBe(true);
    // Second invoice fully paid (was 3000 remaining)
    expect(result.allocations[1].fullyPaid).toBe(true);
    // Third invoice partially paid
    expect(result.allocations[2].fullyPaid).toBe(false);
    expect(result.allocations[2].newBalance).toBe(6000);
  });

  it('should reject when total allocations exceed payment amount', () => {
    const result = validatePaymentAllocations(
      5000,
      [
        { invoiceId: 'inv-1', amount: 3000 },
        { invoiceId: 'inv-2', amount: 3000 }, // total 6000 > payment 5000
      ],
      invoices
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/exceed.*payment|allocation.*total/i)]));
  });

  it('should allow under-allocation (unallocated amount)', () => {
    const result = validatePaymentAllocations(
      15000,
      [{ invoiceId: 'inv-1', amount: 10000 }],
      invoices
    );

    expect(result.valid).toBe(true);
    expect(result.totalAllocated).toBe(10000);
    expect(result.unallocated).toBe(5000);
  });

  it('should reject allocation to non-existent invoice', () => {
    const result = validatePaymentAllocations(
      1000,
      [{ invoiceId: 'inv-999', amount: 1000 }],
      invoices
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/not found|invalid.*invoice/i)]));
  });

  it('should reject zero or negative allocation amount', () => {
    const result = validatePaymentAllocations(
      1000,
      [{ invoiceId: 'inv-1', amount: 0 }],
      invoices
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/zero|positive|amount/i)]));
  });

  it('should reject duplicate invoice allocations', () => {
    const result = validatePaymentAllocations(
      5000,
      [
        { invoiceId: 'inv-1', amount: 3000 },
        { invoiceId: 'inv-1', amount: 2000 }, // duplicate invoice
      ],
      invoices
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/duplicate/i)]));
  });
});
