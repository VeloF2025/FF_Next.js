/**
 * PRD-060: FibreFlow Accounting Module
 * Unit Tests: Double-Entry Validation Engine
 *
 * TDD Status: RED - Tests written before implementation
 *
 * Tests the core double-entry bookkeeping validation logic:
 * - Balanced entries (sum of debits = sum of credits)
 * - Line-level constraints (debit OR credit, not both)
 * - Edge cases (rounding, empty, negative)
 */

import { describe, it, expect } from 'vitest';
import { validateJournalEntry, validateJournalLine, formatJournalEntryNumber } from '@/modules/accounting/utils/doubleEntry';
import type { JournalLineInput } from '@/modules/accounting/types/gl.types';

describe('Double-Entry Validation', () => {
  describe('Balanced Entry Validation', () => {
    // UT-001: Balanced entry passes
    it('should accept a balanced two-line entry (DR=CR)', () => {
      const lines: JournalLineInput[] = [
        { glAccountId: 'acc-1110', debit: 1000, credit: 0, description: 'Bank deposit' },
        { glAccountId: 'acc-4100', debit: 0, credit: 1000, description: 'Revenue' },
      ];

      const result = validateJournalEntry(lines);

      expect(result.valid).toBe(true);
      expect(result.totalDebit).toBe(1000);
      expect(result.totalCredit).toBe(1000);
      expect(result.difference).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    // UT-002: Imbalanced entry fails
    it('should reject an imbalanced entry', () => {
      const lines: JournalLineInput[] = [
        { glAccountId: 'acc-1110', debit: 1000, credit: 0 },
        { glAccountId: 'acc-4100', debit: 0, credit: 999 },
      ];

      const result = validateJournalEntry(lines);

      expect(result.valid).toBe(false);
      expect(result.difference).toBeCloseTo(1.00);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    // UT-003: Empty lines fails
    it('should reject an entry with no lines', () => {
      const result = validateJournalEntry([]);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/empty|no lines|at least/i)]));
    });

    // UT-006: Multi-line balanced entry
    it('should accept a multi-line balanced entry', () => {
      const lines: JournalLineInput[] = [
        { glAccountId: 'acc-5100', debit: 8695.65, credit: 0, description: 'Materials' },
        { glAccountId: 'acc-1400', debit: 1304.35, credit: 0, description: 'VAT Input' },
        { glAccountId: 'acc-2110', debit: 0, credit: 10000, description: 'Accounts Payable' },
      ];

      const result = validateJournalEntry(lines);

      expect(result.valid).toBe(true);
      expect(result.totalDebit).toBeCloseTo(10000);
      expect(result.totalCredit).toBeCloseTo(10000);
      expect(result.difference).toBeCloseTo(0);
    });

    it('should handle cent-level precision correctly', () => {
      const lines: JournalLineInput[] = [
        { glAccountId: 'acc-1110', debit: 33.33, credit: 0 },
        { glAccountId: 'acc-1120', debit: 33.33, credit: 0 },
        { glAccountId: 'acc-1130', debit: 33.34, credit: 0 },
        { glAccountId: 'acc-4100', debit: 0, credit: 100.00 },
      ];

      const result = validateJournalEntry(lines);

      expect(result.valid).toBe(true);
      expect(result.totalDebit).toBeCloseTo(100.00);
      expect(result.totalCredit).toBeCloseTo(100.00);
    });

    // UT-002 variant: R0.01 rounding difference should fail
    it('should reject entry with R0.01 rounding difference', () => {
      const lines: JournalLineInput[] = [
        { glAccountId: 'acc-1110', debit: 100.01, credit: 0 },
        { glAccountId: 'acc-4100', debit: 0, credit: 100.00 },
      ];

      const result = validateJournalEntry(lines);

      expect(result.valid).toBe(false);
      expect(result.difference).toBeCloseTo(0.01);
    });
  });

  describe('Line-Level Validation', () => {
    // UT-004: Both debit and credit positive on same line fails
    it('should reject a line with both debit and credit positive', () => {
      const line: JournalLineInput = {
        glAccountId: 'acc-1110',
        debit: 500,
        credit: 500,
      };

      const result = validateJournalLine(line);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/debit.*credit|one.*must.*zero/i);
    });

    // UT-005: Negative amounts fail
    it('should reject a line with negative debit', () => {
      const line: JournalLineInput = {
        glAccountId: 'acc-1110',
        debit: -100,
        credit: 0,
      };

      const result = validateJournalLine(line);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/negative/i);
    });

    it('should reject a line with negative credit', () => {
      const line: JournalLineInput = {
        glAccountId: 'acc-1110',
        debit: 0,
        credit: -100,
      };

      const result = validateJournalLine(line);

      expect(result.valid).toBe(false);
    });

    it('should reject a line with both debit and credit zero', () => {
      const line: JournalLineInput = {
        glAccountId: 'acc-1110',
        debit: 0,
        credit: 0,
      };

      const result = validateJournalLine(line);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/zero|amount/i);
    });

    it('should accept a valid debit-only line', () => {
      const line: JournalLineInput = {
        glAccountId: 'acc-1110',
        debit: 1000,
        credit: 0,
      };

      const result = validateJournalLine(line);

      expect(result.valid).toBe(true);
    });

    it('should accept a valid credit-only line', () => {
      const line: JournalLineInput = {
        glAccountId: 'acc-4100',
        debit: 0,
        credit: 1000,
      };

      const result = validateJournalLine(line);

      expect(result.valid).toBe(true);
    });

    it('should reject a line without an account ID', () => {
      const line: JournalLineInput = {
        glAccountId: '',
        debit: 1000,
        credit: 0,
      };

      const result = validateJournalLine(line);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/account/i);
    });
  });

  describe('Entry Number Generation', () => {
    // UT-007, UT-008: Journal entry number format
    it('should generate JE-YYYY-NNNNN format', () => {
      const entryNumber = formatJournalEntryNumber(2026, 1);
      expect(entryNumber).toBe('JE-2026-00001');
    });

    it('should handle high sequence numbers', () => {
      const entryNumber = formatJournalEntryNumber(2026, 99999);
      expect(entryNumber).toBe('JE-2026-99999');
    });
  });
});
