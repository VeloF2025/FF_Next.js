/**
 * PRD-060: FibreFlow Accounting Module
 * Unit Tests: AP/AR Aging Bucket Calculations
 *
 * TDD Status: RED - Tests written before implementation
 *
 * Tests aging bucket logic for both payables and receivables:
 * - Current, 30, 60, 90, 120+ day buckets
 * - Zero balance exclusion
 * - Multiple invoices per supplier/client
 */

import { describe, it, expect } from 'vitest';
import { calculateAgingBuckets, getAgingBucket } from '@/modules/accounting/utils/aging';
import type { AgingInvoice } from '@/modules/accounting/types/ap.types';

describe('Aging Bucket Calculations', () => {
  const asAtDate = new Date('2026-03-01');

  describe('Individual Bucket Classification', () => {
    // UT-011: Current bucket (not yet due)
    it('should classify invoice due tomorrow as current', () => {
      const dueDate = new Date('2026-03-02');
      const bucket = getAgingBucket(dueDate, asAtDate);
      expect(bucket).toBe('current');
    });

    it('should classify invoice due today as current', () => {
      const dueDate = new Date('2026-03-01');
      const bucket = getAgingBucket(dueDate, asAtDate);
      expect(bucket).toBe('current');
    });

    // UT-012: 30-day bucket (1-30 days overdue)
    it('should classify invoice 15 days overdue as days30', () => {
      const dueDate = new Date('2026-02-14');
      const bucket = getAgingBucket(dueDate, asAtDate);
      expect(bucket).toBe('days30');
    });

    it('should classify invoice 1 day overdue as days30', () => {
      const dueDate = new Date('2026-02-28');
      const bucket = getAgingBucket(dueDate, asAtDate);
      expect(bucket).toBe('days30');
    });

    it('should classify invoice 30 days overdue as days30', () => {
      const dueDate = new Date('2026-01-30');
      const bucket = getAgingBucket(dueDate, asAtDate);
      expect(bucket).toBe('days30');
    });

    // UT-013: 60-day bucket (31-60 days overdue)
    it('should classify invoice 45 days overdue as days60', () => {
      const dueDate = new Date('2026-01-15');
      const bucket = getAgingBucket(dueDate, asAtDate);
      expect(bucket).toBe('days60');
    });

    // UT-014: 90-day bucket (61-90 days overdue)
    it('should classify invoice 75 days overdue as days90', () => {
      const dueDate = new Date('2025-12-16');
      const bucket = getAgingBucket(dueDate, asAtDate);
      expect(bucket).toBe('days90');
    });

    // UT-015: 120+ bucket (91+ days overdue)
    it('should classify invoice 150 days overdue as days120Plus', () => {
      const dueDate = new Date('2025-10-02');
      const bucket = getAgingBucket(dueDate, asAtDate);
      expect(bucket).toBe('days120Plus');
    });

    it('should classify invoice 91 days overdue as days120Plus', () => {
      const dueDate = new Date('2025-11-30');
      const bucket = getAgingBucket(dueDate, asAtDate);
      expect(bucket).toBe('days120Plus');
    });
  });

  describe('Aggregated Aging Report', () => {
    // UT-016: Zero balance excluded
    it('should exclude fully paid invoices', () => {
      const invoices: AgingInvoice[] = [
        {
          id: 'inv-1', entityId: 'sup-1', entityName: 'Supplier A',
          dueDate: '2026-02-14', totalAmount: 10000, amountPaid: 10000, balance: 0,
        },
        {
          id: 'inv-2', entityId: 'sup-1', entityName: 'Supplier A',
          dueDate: '2026-02-14', totalAmount: 5000, amountPaid: 3000, balance: 2000,
        },
      ];

      const result = calculateAgingBuckets(invoices, asAtDate);

      expect(result).toHaveLength(1);
      expect(result[0].total).toBe(2000);
    });

    it('should group by entity (supplier/client)', () => {
      const invoices: AgingInvoice[] = [
        {
          id: 'inv-1', entityId: 'sup-1', entityName: 'Supplier A',
          dueDate: '2026-02-14', totalAmount: 10000, amountPaid: 0, balance: 10000,
        },
        {
          id: 'inv-2', entityId: 'sup-1', entityName: 'Supplier A',
          dueDate: '2026-01-15', totalAmount: 5000, amountPaid: 0, balance: 5000,
        },
        {
          id: 'inv-3', entityId: 'sup-2', entityName: 'Supplier B',
          dueDate: '2025-12-16', totalAmount: 3000, amountPaid: 0, balance: 3000,
        },
      ];

      const result = calculateAgingBuckets(invoices, asAtDate);

      expect(result).toHaveLength(2);

      const supplierA = result.find(r => r.entityId === 'sup-1');
      expect(supplierA).toBeDefined();
      expect(supplierA!.days30).toBe(10000);
      expect(supplierA!.days60).toBe(5000);
      expect(supplierA!.total).toBe(15000);

      const supplierB = result.find(r => r.entityId === 'sup-2');
      expect(supplierB).toBeDefined();
      expect(supplierB!.days90).toBe(3000);
      expect(supplierB!.total).toBe(3000);
    });

    it('should return empty array for no outstanding invoices', () => {
      const result = calculateAgingBuckets([], asAtDate);
      expect(result).toHaveLength(0);
    });

    it('should sort by total descending', () => {
      const invoices: AgingInvoice[] = [
        {
          id: 'inv-1', entityId: 'sup-1', entityName: 'Small Supplier',
          dueDate: '2026-02-14', totalAmount: 1000, amountPaid: 0, balance: 1000,
        },
        {
          id: 'inv-2', entityId: 'sup-2', entityName: 'Large Supplier',
          dueDate: '2026-02-14', totalAmount: 50000, amountPaid: 0, balance: 50000,
        },
      ];

      const result = calculateAgingBuckets(invoices, asAtDate);

      expect(result[0].entityId).toBe('sup-2');
      expect(result[1].entityId).toBe('sup-1');
    });
  });

  // UT-017: AR aging uses same logic
  describe('AR Aging (same logic, different entities)', () => {
    it('should calculate AR aging for customer invoices', () => {
      const invoices: AgingInvoice[] = [
        {
          id: 'cinv-1', entityId: 'client-1', entityName: 'Client A',
          dueDate: '2026-03-15', totalAmount: 100000, amountPaid: 0, balance: 100000,
        },
        {
          id: 'cinv-2', entityId: 'client-1', entityName: 'Client A',
          dueDate: '2026-01-15', totalAmount: 50000, amountPaid: 20000, balance: 30000,
        },
      ];

      const result = calculateAgingBuckets(invoices, asAtDate);

      expect(result).toHaveLength(1);
      expect(result[0].current).toBe(100000);
      expect(result[0].days60).toBe(30000);
      expect(result[0].total).toBe(130000);
    });
  });
});
