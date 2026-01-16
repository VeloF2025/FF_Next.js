/**
 * Budget Category Tests
 * PRD-057: Project Budget Tracking System
 *
 * TDD Phase: RED - Tests written before implementation
 * These tests will FAIL until src/lib/budget/categories.ts is implemented
 */

import { describe, it, expect } from 'vitest';
import {
  validateCategoryAllocation,
  mapBoqCategoriesToBudget,
  getDefaultCategories,
} from '../../../lib/budget/categories';
import type { BudgetCategory, CategoryAllocationResult } from '../../../src/types/budget';

describe('Budget Categories', () => {
  describe('validateCategoryAllocation', () => {
    it('CA-001: should accept valid allocation within total budget', () => {
      // Total budget: 100000
      // Categories: [40000, 30000, 20000, 10000] = 100000
      // Expected: valid
      const categories = [
        { code: 'MATERIALS', allocated: 40000 },
        { code: 'EQUIPMENT', allocated: 30000 },
        { code: 'LABOR', allocated: 20000 },
        { code: 'TRANSPORT', allocated: 10000 },
      ];

      const result = validateCategoryAllocation(categories, 100000);

      expect(result.valid).toBe(true);
      expect(result.totalAllocated).toBe(100000);
      expect(result.difference).toBe(0);
      expect(result.over).toBe(false);
    });

    it('CA-002: should reject allocation exceeding total budget', () => {
      // Total budget: 100000
      // Categories: [50000, 40000, 30000] = 120000
      // Expected: invalid, over by 20000
      const categories = [
        { code: 'MATERIALS', allocated: 50000 },
        { code: 'EQUIPMENT', allocated: 40000 },
        { code: 'LABOR', allocated: 30000 },
      ];

      const result = validateCategoryAllocation(categories, 100000);

      expect(result.valid).toBe(false);
      expect(result.totalAllocated).toBe(120000);
      expect(result.difference).toBe(-20000);
      expect(result.over).toBe(true);
    });

    it('CA-003: should allow partial allocation (categories < total)', () => {
      // Total budget: 100000
      // Categories: [40000, 30000] = 70000
      // Expected: valid (30000 unallocated)
      const categories = [
        { code: 'MATERIALS', allocated: 40000 },
        { code: 'EQUIPMENT', allocated: 30000 },
      ];

      const result = validateCategoryAllocation(categories, 100000);

      expect(result.valid).toBe(true);
      expect(result.totalAllocated).toBe(70000);
      expect(result.difference).toBe(30000);
      expect(result.over).toBe(false);
    });

    it('CA-004: should handle empty categories array', () => {
      const result = validateCategoryAllocation([], 100000);

      expect(result.valid).toBe(true);
      expect(result.totalAllocated).toBe(0);
      expect(result.difference).toBe(100000);
    });

    it('CA-005: should handle zero total budget', () => {
      const categories = [{ code: 'MATERIALS', allocated: 0 }];

      const result = validateCategoryAllocation(categories, 0);

      expect(result.valid).toBe(true);
      expect(result.totalAllocated).toBe(0);
    });
  });

  describe('mapBoqCategoriesToBudget', () => {
    interface BoqItem {
      category: string | null;
      amount: number;
    }

    it('CM-001: should map BOQ categories to budget categories', () => {
      // BOQ items with categories: ['Materials', 'Equipment', 'Labor']
      // Expected: 3 budget_categories created with correct amounts
      const boqItems: BoqItem[] = [
        { category: 'Materials', amount: 50000 },
        { category: 'Equipment', amount: 30000 },
        { category: 'Labor', amount: 20000 },
      ];

      const result = mapBoqCategoriesToBudget(boqItems);

      expect(result).toHaveLength(3);
      expect(result.find((c) => c.code === 'MATERIALS')?.allocated).toBe(50000);
      expect(result.find((c) => c.code === 'EQUIPMENT')?.allocated).toBe(30000);
      expect(result.find((c) => c.code === 'LABOR')?.allocated).toBe(20000);
    });

    it('CM-002: should aggregate same-category BOQ items', () => {
      // BOQ items: [Materials: 10000, Materials: 20000, Equipment: 15000]
      // Expected: Materials: 30000, Equipment: 15000
      const boqItems: BoqItem[] = [
        { category: 'Materials', amount: 10000 },
        { category: 'Materials', amount: 20000 },
        { category: 'Equipment', amount: 15000 },
      ];

      const result = mapBoqCategoriesToBudget(boqItems);

      expect(result).toHaveLength(2);
      expect(result.find((c) => c.code === 'MATERIALS')?.allocated).toBe(30000);
      expect(result.find((c) => c.code === 'EQUIPMENT')?.allocated).toBe(15000);
    });

    it('CM-003: should handle missing category as UNCATEGORIZED', () => {
      // BOQ item with no category
      // Expected: maps to UNCATEGORIZED category
      const boqItems: BoqItem[] = [
        { category: null, amount: 10000 },
        { category: 'Materials', amount: 20000 },
      ];

      const result = mapBoqCategoriesToBudget(boqItems);

      expect(result.find((c) => c.code === 'UNCATEGORIZED')?.allocated).toBe(
        10000
      );
    });

    it('CM-004: should handle empty string category as UNCATEGORIZED', () => {
      const boqItems: BoqItem[] = [{ category: '', amount: 5000 }];

      const result = mapBoqCategoriesToBudget(boqItems);

      expect(result.find((c) => c.code === 'UNCATEGORIZED')?.allocated).toBe(
        5000
      );
    });

    it('CM-005: should normalize category names to codes', () => {
      // Different casing/formatting should map to same code
      const boqItems: BoqItem[] = [
        { category: 'materials', amount: 10000 },
        { category: 'MATERIALS', amount: 10000 },
        { category: 'Materials & Consumables', amount: 10000 },
      ];

      const result = mapBoqCategoriesToBudget(boqItems);

      expect(result.find((c) => c.code === 'MATERIALS')?.allocated).toBe(30000);
    });

    it('CM-006: should handle empty BOQ items array', () => {
      const result = mapBoqCategoriesToBudget([]);

      expect(result).toHaveLength(0);
    });

    it('CM-007: should create custom category for unknown BOQ category', () => {
      const boqItems: BoqItem[] = [
        { category: 'Special Equipment', amount: 25000 },
      ];

      const result = mapBoqCategoriesToBudget(boqItems);

      const custom = result.find((c) => c.code === 'SPECIAL_EQUIPMENT');
      expect(custom).toBeDefined();
      expect(custom?.allocated).toBe(25000);
      expect(custom?.isCustom).toBe(true);
    });
  });

  describe('getDefaultCategories', () => {
    it('DC-001: should return 7 default categories', () => {
      const categories = getDefaultCategories();

      expect(categories).toHaveLength(7);
    });

    it('DC-002: should include all required category codes', () => {
      const categories = getDefaultCategories();
      const codes = categories.map((c) => c.code);

      expect(codes).toContain('MATERIALS');
      expect(codes).toContain('EQUIPMENT');
      expect(codes).toContain('LABOR');
      expect(codes).toContain('SUBCONTRACT');
      expect(codes).toContain('TRANSPORT');
      expect(codes).toContain('OVERHEAD');
      expect(codes).toContain('CONTINGENCY');
    });

    it('DC-003: should have correct sort order', () => {
      const categories = getDefaultCategories();

      expect(categories[0].code).toBe('MATERIALS');
      expect(categories[0].sortOrder).toBe(1);
      expect(categories[6].code).toBe('CONTINGENCY');
      expect(categories[6].sortOrder).toBe(7);
    });

    it('DC-004: should mark all as non-custom', () => {
      const categories = getDefaultCategories();

      categories.forEach((cat) => {
        expect(cat.isCustom).toBe(false);
      });
    });

    it('DC-005: should have descriptive names', () => {
      const categories = getDefaultCategories();
      const materials = categories.find((c) => c.code === 'MATERIALS');

      expect(materials?.name).toBe('Materials & Consumables');
    });
  });
});
