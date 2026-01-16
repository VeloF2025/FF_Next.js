// WORKING: Budget category functions
// PRD-057: Project Budget Tracking System

import type { CategoryAllocationResult } from '../../src/types/budget';
import { DEFAULT_CATEGORIES } from '../../src/types/budget';

interface CategoryAllocation {
  code: string;
  allocated: number;
}

interface BoqItem {
  category: string | null;
  amount: number;
}

interface MappedCategory {
  code: string;
  name: string;
  allocated: number;
  isCustom: boolean;
  sortOrder: number;
}

/**
 * Map of standard category names/variations to codes
 */
const CATEGORY_NAME_MAP: Record<string, string> = {
  // Materials
  materials: 'MATERIALS',
  'materials & consumables': 'MATERIALS',
  consumables: 'MATERIALS',
  // Equipment
  equipment: 'EQUIPMENT',
  'equipment & tools': 'EQUIPMENT',
  tools: 'EQUIPMENT',
  // Labor
  labor: 'LABOR',
  labour: 'LABOR',
  'labor costs': 'LABOR',
  // Subcontract
  subcontract: 'SUBCONTRACT',
  'subcontractor work': 'SUBCONTRACT',
  subcontractors: 'SUBCONTRACT',
  // Transport
  transport: 'TRANSPORT',
  'transport & logistics': 'TRANSPORT',
  logistics: 'TRANSPORT',
  // Overhead
  overhead: 'OVERHEAD',
  'overhead & admin': 'OVERHEAD',
  admin: 'OVERHEAD',
  // Contingency
  contingency: 'CONTINGENCY',
  'contingency reserve': 'CONTINGENCY',
};

/**
 * Validate that category allocations don't exceed total budget
 * @param categories - Array of category allocations
 * @param totalBudget - Total budget amount
 * @returns Validation result
 */
export function validateCategoryAllocation(
  categories: CategoryAllocation[],
  totalBudget: number
): CategoryAllocationResult {
  const totalAllocated = categories.reduce((sum, cat) => sum + cat.allocated, 0);
  const difference = totalBudget - totalAllocated;
  const over = totalAllocated > totalBudget;

  return {
    valid: !over,
    totalAllocated,
    totalBudget,
    difference,
    over,
  };
}

/**
 * Normalize a category name to its standard code
 * @param categoryName - Raw category name from BOQ
 * @returns Standard category code or custom code
 */
function normalizeCategoryToCode(categoryName: string | null): {
  code: string;
  isCustom: boolean;
} {
  if (!categoryName || categoryName.trim() === '') {
    return { code: 'UNCATEGORIZED', isCustom: false };
  }

  const normalized = categoryName.toLowerCase().trim();

  // Check if it matches a known category
  if (CATEGORY_NAME_MAP[normalized]) {
    return { code: CATEGORY_NAME_MAP[normalized], isCustom: false };
  }

  // Check if the name already IS a standard code (case-insensitive)
  const upperName = categoryName.toUpperCase().trim();
  const standardCodes = DEFAULT_CATEGORIES.map((c) => c.code);
  if (standardCodes.includes(upperName as typeof DEFAULT_CATEGORIES[number]['code'])) {
    return { code: upperName, isCustom: false };
  }

  // Custom category - convert to uppercase with underscores
  const customCode = categoryName
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');

  return { code: customCode, isCustom: true };
}

/**
 * Map BOQ item categories to budget categories
 * @param boqItems - Array of BOQ items with categories and amounts
 * @returns Array of mapped budget categories
 */
export function mapBoqCategoriesToBudget(boqItems: BoqItem[]): MappedCategory[] {
  if (boqItems.length === 0) {
    return [];
  }

  // Aggregate amounts by category code
  const categoryMap = new Map<
    string,
    { name: string; allocated: number; isCustom: boolean }
  >();

  for (const item of boqItems) {
    const { code, isCustom } = normalizeCategoryToCode(item.category);

    if (categoryMap.has(code)) {
      const existing = categoryMap.get(code)!;
      existing.allocated += item.amount;
    } else {
      // Determine display name
      let name: string;
      if (code === 'UNCATEGORIZED') {
        name = 'Uncategorized';
      } else if (isCustom) {
        // Use original name for custom categories
        name = item.category || code;
      } else {
        // Find standard name
        const standard = DEFAULT_CATEGORIES.find((c) => c.code === code);
        name = standard?.name || code;
      }

      categoryMap.set(code, {
        name,
        allocated: item.amount,
        isCustom,
      });
    }
  }

  // Convert to array with sort order
  const result: MappedCategory[] = [];
  let customSortOrder = 100;

  for (const [code, data] of categoryMap) {
    // Find standard sort order or use custom
    const standard = DEFAULT_CATEGORIES.find((c) => c.code === code);
    const sortOrder = standard?.sortOrder ?? customSortOrder++;

    result.push({
      code,
      name: data.name,
      allocated: data.allocated,
      isCustom: data.isCustom,
      sortOrder,
    });
  }

  // Sort by sortOrder
  return result.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Get default budget categories
 * @returns Array of default category definitions
 */
export function getDefaultCategories(): MappedCategory[] {
  return DEFAULT_CATEGORIES.map((cat) => ({
    code: cat.code,
    name: cat.name,
    allocated: 0,
    isCustom: false,
    sortOrder: cat.sortOrder,
  }));
}
