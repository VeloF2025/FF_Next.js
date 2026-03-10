/**
 * Category Mapper Service
 * Maps BOQ Item Categories to fiber-specific budget categories
 *
 * Uses the boq_category_mapping table with fallback to keyword matching
 *
 * Created: 2026-01-17
 */

import { neon } from '@/lib/db-neon';
import { TextProcessor } from '@/lib/utils/catalog/textProcessor';
import type {
  FiberBudgetCategoryCode,
  BOQCategoryMapping,
  FIBER_BUDGET_CATEGORIES,
} from '@/types/procurement/material-catalog.types';

// Default category when no match found
const DEFAULT_CATEGORY: FiberBudgetCategoryCode = 'CONSUMABLES';

// Keyword-based fallback mapping
const KEYWORD_MAPPING: Record<FiberBudgetCategoryCode, string[]> = {
  CABLES: ['cable', 'fiber', 'fibre', 'drop', 'aerial', 'underground', 'adss', 'micro-blown', 'power'],
  ENCLOSURES: ['enclosure', 'joint', 'dome', 'fdt', 'nap', 'splice', 'closure', 'cabinet'],
  POLES: ['pole', 'creosote', 'stay', 'guy', 'anchor', 'mast', 'tower'],
  HARDWARE: ['dead-end', 'deadend', 'tangent', 'hook', 'bracket', 'slack', 'strapping', 'buckle', 'screw', 'tie', 'clamp'],
  SPLICING: ['splitter', 'pigtail', 'midcoupler', 'coupler', 'connector', 'adapter', 'protector', 'splice'],
  CIVIL: ['manhole', 'chamber', 'duct', 'conduit', 'trunking', 'trench', 'coupling', 'endcap', 'lock', 'adapt', 'galv', 'pvc', 'hdpe'],
  HOME_CONNECTION: ['wall', 'attachment', 'inspection', 'box', 'saddle', 'ont', 'electrical', 'home'],
  CONSUMABLES: ['label', 'cement', 'tar', 'tape', 'alcohol', 'wipe', 'bitumen', 'caution'],
  LABOR: ['labor', 'labour', 'service', 'installation', 'install', 'testing', 'test', 'work'],
  CONTINGENCY: ['contingency', 'reserve', 'provisional', 'sundry'],
};

export interface CategoryMapResult {
  budgetCategoryCode: FiberBudgetCategoryCode;
  budgetCategoryName: string;
  matchMethod: 'exact' | 'keyword' | 'default';
  confidence: number;
}

export class CategoryMapper {
  private sql: ReturnType<typeof neon>;
  private mappingCache: Map<string, BOQCategoryMapping> = new Map();
  private initialized = false;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  /**
   * Initialize the mapper by loading category mappings from database
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const mappings = await this.sql`
      SELECT *
      FROM boq_category_mapping
      ORDER BY priority ASC
    `;

    for (const row of mappings) {
      const mapping: BOQCategoryMapping = {
        id: row.id,
        boqCategory: row.boq_category,
        budgetCategoryCode: row.budget_category_code,
        keywords: row.keywords || [],
        priority: row.priority,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      this.mappingCache.set(mapping.boqCategory.toLowerCase(), mapping);
    }

    this.initialized = true;
  }

  /**
   * Map a BOQ category to a budget category
   */
  async mapCategory(boqCategory: string): Promise<CategoryMapResult> {
    await this.initialize();

    const normalizedCategory = boqCategory.trim().toLowerCase();

    // Step 1: Try exact match from database
    const exactMatch = this.mappingCache.get(normalizedCategory);
    if (exactMatch) {
      return {
        budgetCategoryCode: exactMatch.budgetCategoryCode as FiberBudgetCategoryCode,
        budgetCategoryName: this.getCategoryName(exactMatch.budgetCategoryCode as FiberBudgetCategoryCode),
        matchMethod: 'exact',
        confidence: 1.0,
      };
    }

    // Step 2: Try partial match (contains)
    for (const [key, mapping] of this.mappingCache) {
      if (normalizedCategory.includes(key) || key.includes(normalizedCategory)) {
        return {
          budgetCategoryCode: mapping.budgetCategoryCode as FiberBudgetCategoryCode,
          budgetCategoryName: this.getCategoryName(mapping.budgetCategoryCode as FiberBudgetCategoryCode),
          matchMethod: 'keyword',
          confidence: 0.9,
        };
      }
    }

    // Step 3: Keyword-based fallback
    const keywordResult = this.matchByKeywords(boqCategory);
    if (keywordResult) {
      return keywordResult;
    }

    // Step 4: Default
    return {
      budgetCategoryCode: DEFAULT_CATEGORY,
      budgetCategoryName: this.getCategoryName(DEFAULT_CATEGORY),
      matchMethod: 'default',
      confidence: 0.5,
    };
  }

  /**
   * Map multiple categories (batch)
   */
  async mapCategories(boqCategories: string[]): Promise<Map<string, CategoryMapResult>> {
    await this.initialize();

    const results = new Map<string, CategoryMapResult>();

    for (const category of boqCategories) {
      if (!results.has(category)) {
        const result = await this.mapCategory(category);
        results.set(category, result);
      }
    }

    return results;
  }

  /**
   * Match category by keyword analysis
   */
  private matchByKeywords(boqCategory: string): CategoryMapResult | null {
    const normalizedCategory = boqCategory.toLowerCase();
    const keywords = TextProcessor.extractKeywords(boqCategory);

    let bestMatch: { code: FiberBudgetCategoryCode; score: number } | null = null;

    for (const [categoryCode, categoryKeywords] of Object.entries(KEYWORD_MAPPING)) {
      let score = 0;

      // Check if any category keyword appears in the BOQ category
      for (const keyword of categoryKeywords) {
        if (normalizedCategory.includes(keyword)) {
          score += 2; // Direct match in category name
        }
        if (keywords.some(k => k.includes(keyword) || keyword.includes(k))) {
          score += 1; // Keyword overlap
        }
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { code: categoryCode as FiberBudgetCategoryCode, score };
      }
    }

    if (bestMatch && bestMatch.score >= 2) {
      const confidence = Math.min(0.9, 0.6 + bestMatch.score * 0.05);
      return {
        budgetCategoryCode: bestMatch.code,
        budgetCategoryName: this.getCategoryName(bestMatch.code),
        matchMethod: 'keyword',
        confidence,
      };
    }

    return null;
  }

  /**
   * Get category name from code
   */
  private getCategoryName(code: FiberBudgetCategoryCode): string {
    const names: Record<FiberBudgetCategoryCode, string> = {
      CABLES: 'Cables & Fiber',
      ENCLOSURES: 'Enclosures & Joints',
      POLES: 'Poles & Structures',
      HARDWARE: 'Hardware & Fittings',
      SPLICING: 'Splicing & Connectivity',
      CIVIL: 'Civil Works & Ducting',
      HOME_CONNECTION: 'Home Connection',
      CONSUMABLES: 'Consumables & Sundries',
      LABOR: 'Labor & Services',
      CONTINGENCY: 'Contingency Reserve',
    };
    return names[code] || code;
  }

  /**
   * Add a new category mapping
   */
  async addMapping(
    boqCategory: string,
    budgetCategoryCode: FiberBudgetCategoryCode,
    keywords?: string[],
    priority?: number
  ): Promise<BOQCategoryMapping> {
    const result = await this.sql`
      INSERT INTO boq_category_mapping (
        boq_category,
        budget_category_code,
        keywords,
        priority
      ) VALUES (
        ${boqCategory},
        ${budgetCategoryCode},
        ${keywords || []},
        ${priority || 100}
      )
      ON CONFLICT (boq_category)
      DO UPDATE SET
        budget_category_code = EXCLUDED.budget_category_code,
        keywords = EXCLUDED.keywords,
        priority = EXCLUDED.priority,
        updated_at = NOW()
      RETURNING *
    `;

    const mapping: BOQCategoryMapping = {
      id: result[0].id,
      boqCategory: result[0].boq_category,
      budgetCategoryCode: result[0].budget_category_code,
      keywords: result[0].keywords || [],
      priority: result[0].priority,
      createdAt: result[0].created_at,
      updatedAt: result[0].updated_at,
    };

    // Update cache
    this.mappingCache.set(mapping.boqCategory.toLowerCase(), mapping);

    return mapping;
  }

  /**
   * Get all mappings
   */
  async getAllMappings(): Promise<BOQCategoryMapping[]> {
    await this.initialize();
    return Array.from(this.mappingCache.values());
  }

  /**
   * Get mapping statistics
   */
  async getMappingStats(): Promise<{
    totalMappings: number;
    byCategory: Record<string, number>;
  }> {
    await this.initialize();

    const byCategory: Record<string, number> = {};
    for (const mapping of this.mappingCache.values()) {
      byCategory[mapping.budgetCategoryCode] = (byCategory[mapping.budgetCategoryCode] || 0) + 1;
    }

    return {
      totalMappings: this.mappingCache.size,
      byCategory,
    };
  }

  /**
   * Clear the cache (for testing or refresh)
   */
  clearCache(): void {
    this.mappingCache.clear();
    this.initialized = false;
  }
}

/**
 * Create a category mapper instance
 */
export function createCategoryMapper(databaseUrl: string): CategoryMapper {
  return new CategoryMapper(databaseUrl);
}
