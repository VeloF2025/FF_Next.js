/**
 * PRD-060: FibreFlow Accounting Module
 * Unit Tests: Bank CSV Statement Parsers
 *
 * TDD Status: RED - Tests written before implementation
 *
 * Tests CSV parsing for South African banks:
 * - FNB (First National Bank)
 * - Standard Bank
 * - Nedbank
 */

import { describe, it, expect } from 'vitest';
import {
  parseFNBStatement,
  parseStandardBankStatement,
  parseNedbankStatement,
  detectBankFormat,
} from '@/modules/accounting/utils/bankCsvParsers';

describe('Bank CSV Parsers', () => {
  describe('FNB Statement Parser', () => {
    // UT-023: FNB format parsing
    it('should parse FNB statement CSV correctly', () => {
      const csv = `"Date","Description","Amount","Balance","Reference"
"2026/02/25","EFT CREDIT - VELOCITY FIBRE","45000.00","1234567.89","REF001"
"2026/02/24","EFT DEBIT - SUPPLIER PAYMENT","-12000.00","1189567.89","PAY-2026-00089"
"2026/02/23","SERVICE FEE","-156.00","1201567.89",""`;

      const result = parseFNBStatement(csv);

      expect(result.transactions).toHaveLength(3);
      expect(result.bankFormat).toBe('fnb');
      expect(result.errors).toHaveLength(0);

      // First transaction: deposit
      expect(result.transactions[0].transactionDate).toBe('2026-02-25');
      expect(result.transactions[0].amount).toBe(45000);
      expect(result.transactions[0].description).toContain('EFT CREDIT');
      expect(result.transactions[0].reference).toBe('REF001');

      // Second transaction: withdrawal
      expect(result.transactions[1].amount).toBe(-12000);
      expect(result.transactions[1].reference).toBe('PAY-2026-00089');

      // Third transaction: bank fee
      expect(result.transactions[2].amount).toBe(-156);
    });

    it('should handle FNB date format (YYYY/MM/DD)', () => {
      const csv = `"Date","Description","Amount","Balance","Reference"
"2026/01/05","DEPOSIT","1000.00","5000.00",""`;

      const result = parseFNBStatement(csv);

      expect(result.transactions[0].transactionDate).toBe('2026-01-05');
    });
  });

  describe('Standard Bank Statement Parser', () => {
    // UT-024: Standard Bank format
    it('should parse Standard Bank statement CSV correctly', () => {
      const csv = `Date,Description,Debit,Credit,Balance
25/02/2026,EFT CREDIT VELOCITY,,45000.00,1234567.89
24/02/2026,EFT DEBIT PAYMENT,12000.00,,1189567.89
23/02/2026,MONTHLY ACCOUNT FEE,156.00,,1201567.89`;

      const result = parseStandardBankStatement(csv);

      expect(result.transactions).toHaveLength(3);
      expect(result.bankFormat).toBe('standard_bank');

      // Credit (deposit)
      expect(result.transactions[0].amount).toBe(45000);
      // Debit (withdrawal)
      expect(result.transactions[1].amount).toBe(-12000);
    });

    it('should handle Standard Bank date format (DD/MM/YYYY)', () => {
      const csv = `Date,Description,Debit,Credit,Balance
05/01/2026,DEPOSIT,,1000.00,5000.00`;

      const result = parseStandardBankStatement(csv);

      expect(result.transactions[0].transactionDate).toBe('2026-01-05');
    });
  });

  describe('Nedbank Statement Parser', () => {
    // UT-025: Nedbank format
    it('should parse Nedbank statement CSV correctly', () => {
      const csv = `Transaction Date,Value Date,Transaction Description,Debit Amount,Credit Amount,Balance
2026-02-25,2026-02-25,EFT IN VELOCITY,,45000.00,1234567.89
2026-02-24,2026-02-24,EFT OUT PAYMENT,12000.00,,1189567.89`;

      const result = parseNedbankStatement(csv);

      expect(result.transactions).toHaveLength(2);
      expect(result.bankFormat).toBe('nedbank');

      expect(result.transactions[0].amount).toBe(45000);
      expect(result.transactions[0].valueDate).toBe('2026-02-25');
      expect(result.transactions[1].amount).toBe(-12000);
    });
  });

  describe('Edge Cases', () => {
    // UT-026: Empty file
    it('should return empty array for empty CSV', () => {
      const result = parseFNBStatement('');

      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should return empty array for header-only CSV', () => {
      const csv = `"Date","Description","Amount","Balance","Reference"`;

      const result = parseFNBStatement(csv);

      expect(result.transactions).toHaveLength(0);
    });

    // UT-027: Malformed rows skipped
    it('should skip malformed rows and log errors', () => {
      const csv = `"Date","Description","Amount","Balance","Reference"
"2026/02/25","VALID","1000.00","5000.00","REF1"
"invalid-date","BROKEN","not-a-number","5000.00",""
"2026/02/23","ALSO VALID","-500.00","4500.00","REF2"`;

      const result = parseFNBStatement(csv);

      expect(result.transactions).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].row).toBe(3); // 1-indexed, row 3 is the bad one
    });

    it('should handle amounts with thousand separators', () => {
      const csv = `"Date","Description","Amount","Balance","Reference"
"2026/02/25","LARGE DEPOSIT","1,234,567.89","2,345,678.90",""`;

      const result = parseFNBStatement(csv);

      expect(result.transactions[0].amount).toBeCloseTo(1234567.89);
    });

    it('should trim whitespace from fields', () => {
      const csv = `"Date","Description","Amount","Balance","Reference"
" 2026/02/25 "," DEPOSIT "," 1000.00 "," 5000.00 "," REF1 "`;

      const result = parseFNBStatement(csv);

      expect(result.transactions[0].transactionDate).toBe('2026-02-25');
      expect(result.transactions[0].description).toBe('DEPOSIT');
      expect(result.transactions[0].reference).toBe('REF1');
    });
  });

  describe('Bank Format Detection', () => {
    it('should detect FNB format from headers', () => {
      const csv = `"Date","Description","Amount","Balance","Reference"\n"2026/02/25","TEST","1000","5000",""`;
      expect(detectBankFormat(csv)).toBe('fnb');
    });

    it('should detect Standard Bank format from headers', () => {
      const csv = `Date,Description,Debit,Credit,Balance\n25/02/2026,TEST,,1000,5000`;
      expect(detectBankFormat(csv)).toBe('standard_bank');
    });

    it('should detect Nedbank format from headers', () => {
      const csv = `Transaction Date,Value Date,Transaction Description,Debit Amount,Credit Amount,Balance\n2026-02-25,2026-02-25,TEST,,1000,5000`;
      expect(detectBankFormat(csv)).toBe('nedbank');
    });

    it('should return unknown for unrecognized format', () => {
      const csv = `Column1,Column2,Column3\nval1,val2,val3`;
      expect(detectBankFormat(csv)).toBe('unknown');
    });
  });
});
