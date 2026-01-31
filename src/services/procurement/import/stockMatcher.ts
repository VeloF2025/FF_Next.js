/**
 * Stock Item Matcher Service
 * Matches BOQ items to internal stock items using a 3-stage pipeline:
 * 1. Supplier code lookup (exact match via supplier_item_codes table)
 * 2. Fuzzy description + category match (keyword overlap + Levenshtein)
 * 3. Unmatched (left for manual mapping)
 *
 * Note: Stock items often have technical codes as names (e.g. CAB-AER-SM-10.4-48F)
 * with empty descriptions, while BOQ items have natural language descriptions.
 * The matcher accounts for this by parsing technical codes into keywords.
 */

import { neon } from '@neondatabase/serverless';
import { TextProcessor } from '@/lib/utils/catalog/textProcessor';
import { log } from '@/lib/logger';

// Match thresholds
const SUPPLIER_CODE_CONFIDENCE = 1.0;
const FUZZY_THRESHOLD = 0.55; // Lower than MaterialMatcher (0.85) because stock names are technical codes
const CATEGORY_BOOST = 0.15; // Bonus when categories match

export type StockMatchMethod = 'supplier_code' | 'fuzzy_description' | 'exact_code' | 'manual' | 'none';

export interface StockItem {
  id: string;
  itemCode: string;
  name: string;
  description: string;
  category: string;
}

export interface StockMatchResult {
  boqItemId: string;
  boqDescription: string;
  boqItemCode: string | null;
  stockItem: StockItem | null;
  matchMethod: StockMatchMethod;
  matchConfidence: number;
  /** Top alternatives for manual review */
  alternatives?: Array<{ stockItem: StockItem; score: number }>;
}

export class StockMatcher {
  private sql: ReturnType<typeof neon>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  /**
   * Match a batch of BOQ items to stock items.
   * Loads all stock items + supplier codes upfront for efficiency.
   */
  async matchBatch(
    boqItems: Array<{
      id: string;
      itemCode: string | null;
      description: string;
      category: string | null;
      supplierName?: string | null;
    }>
  ): Promise<StockMatchResult[]> {
    // Load all active stock items
    const stockItems = await this.loadStockItems();
    // Load all supplier code mappings
    const supplierMappings = await this.loadSupplierMappings();

    const results: StockMatchResult[] = [];
    // Pre-compute stock item keywords for fuzzy matching
    const stockKeywordsMap = new Map<string, string[]>();
    for (const si of stockItems) {
      const keywords = this.extractStockKeywords(si);
      stockKeywordsMap.set(si.id, keywords);
    }

    for (const boqItem of boqItems) {
      const result = this.matchSingle(
        boqItem,
        stockItems,
        supplierMappings,
        stockKeywordsMap
      );
      results.push(result);
    }

    const matched = results.filter(r => r.stockItem !== null);
    log.info('Stock matching batch complete', {
      total: boqItems.length,
      matched: matched.length,
      byMethod: {
        supplier_code: matched.filter(r => r.matchMethod === 'supplier_code').length,
        exact_code: matched.filter(r => r.matchMethod === 'exact_code').length,
        fuzzy_description: matched.filter(r => r.matchMethod === 'fuzzy_description').length,
      },
    });

    return results;
  }

  /**
   * Match a single BOQ item through the 3-stage pipeline
   */
  private matchSingle(
    boqItem: {
      id: string;
      itemCode: string | null;
      description: string;
      category: string | null;
      supplierName?: string | null;
    },
    stockItems: StockItem[],
    supplierMappings: Map<string, string>, // supplierCode → stockItemId
    stockKeywordsMap: Map<string, string[]>
  ): StockMatchResult {
    const baseResult: StockMatchResult = {
      boqItemId: boqItem.id,
      boqDescription: boqItem.description,
      boqItemCode: boqItem.itemCode,
      stockItem: null,
      matchMethod: 'none',
      matchConfidence: 0,
    };

    // Stage 1: Supplier code lookup
    if (boqItem.itemCode) {
      const normalizedCode = boqItem.itemCode.toLowerCase().trim();
      const mappedStockId = supplierMappings.get(normalizedCode);
      if (mappedStockId) {
        const stockItem = stockItems.find(s => s.id === mappedStockId);
        if (stockItem) {
          return {
            ...baseResult,
            stockItem,
            matchMethod: 'supplier_code',
            matchConfidence: SUPPLIER_CODE_CONFIDENCE,
          };
        }
      }

      // Stage 1b: Exact item code match against stock items
      const exactMatch = stockItems.find(
        s => s.itemCode.toLowerCase() === normalizedCode
      );
      if (exactMatch) {
        return {
          ...baseResult,
          stockItem: exactMatch,
          matchMethod: 'exact_code',
          matchConfidence: SUPPLIER_CODE_CONFIDENCE,
        };
      }
    }

    // Stage 2: Fuzzy description + category matching
    const boqKeywords = TextProcessor.extractKeywords(boqItem.description);
    const boqCategoryNorm = boqItem.category
      ? boqItem.category.toLowerCase().trim()
      : '';

    const candidates: Array<{ stockItem: StockItem; score: number }> = [];

    for (const si of stockItems) {
      const siKeywords = stockKeywordsMap.get(si.id) || [];
      const siCategoryNorm = si.category ? si.category.toLowerCase().trim() : '';

      // Calculate keyword overlap score
      const keywordScore = this.keywordOverlap(boqKeywords, siKeywords);

      // Calculate description similarity (Levenshtein on normalized text)
      const descSimilarity = TextProcessor.similarity(
        boqItem.description,
        si.name || si.description
      );

      // Category match bonus
      const categoryMatch = boqCategoryNorm && siCategoryNorm
        ? (boqCategoryNorm === siCategoryNorm ||
           boqCategoryNorm.includes(siCategoryNorm) ||
           siCategoryNorm.includes(boqCategoryNorm))
          ? CATEGORY_BOOST
          : 0
        : 0;

      // Composite score: weighted combination
      const compositeScore =
        descSimilarity * 0.45 +
        keywordScore * 0.40 +
        categoryMatch;

      if (compositeScore >= FUZZY_THRESHOLD * 0.7) {
        candidates.push({ stockItem: si, score: compositeScore });
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0 && candidates[0].score >= FUZZY_THRESHOLD) {
      return {
        ...baseResult,
        stockItem: candidates[0].stockItem,
        matchMethod: 'fuzzy_description',
        matchConfidence: Math.min(candidates[0].score, 0.99),
        alternatives: candidates.slice(1, 4),
      };
    }

    // Stage 3: No match — return with top alternatives for manual review
    return {
      ...baseResult,
      alternatives: candidates.slice(0, 5),
    };
  }

  /**
   * Extract keywords from a stock item, parsing technical codes
   * E.g. "CAB-AER-SM-10.4-48F" → ["cab", "aer", "aerial", "sm", "single", "mode", "48f", "fiber"]
   */
  private extractStockKeywords(si: StockItem): string[] {
    const keywords: string[] = [];

    // Parse item code by splitting on hyphens and dots
    if (si.itemCode) {
      const codeParts = si.itemCode.toLowerCase().split(/[-_.]+/);
      keywords.push(...codeParts.filter(p => p.length > 1));

      // Expand common fiber abbreviations
      const expansions: Record<string, string[]> = {
        'cab': ['cable'],
        'aer': ['aerial'],
        'sm': ['single', 'mode'],
        'mm': ['multi', 'mode'],
        'ont': ['ont', 'terminal'],
        'olt': ['olt'],
        'splt': ['splitter'],
        'enc': ['enclosure'],
        'mini': ['mini'],
        'drop': ['drop'],
        'deadend': ['dead', 'end'],
        'pig': ['pigtail'],
        'patch': ['patch'],
        'splice': ['splice'],
      };

      for (const part of codeParts) {
        if (expansions[part]) {
          keywords.push(...expansions[part]);
        }
      }
    }

    // Extract from name
    if (si.name) {
      keywords.push(...TextProcessor.extractKeywords(si.name));
    }

    // Extract from description
    if (si.description) {
      keywords.push(...TextProcessor.extractKeywords(si.description));
    }

    // Category
    if (si.category) {
      keywords.push(si.category.toLowerCase());
    }

    // Deduplicate
    return [...new Set(keywords)];
  }

  /**
   * Calculate keyword overlap between two keyword sets
   */
  private keywordOverlap(keywords1: string[], keywords2: string[]): number {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;

    const set1 = new Set(keywords1.map(k => k.toLowerCase()));
    const set2 = new Set(keywords2.map(k => k.toLowerCase()));

    let overlap = 0;
    set1.forEach(k => {
      if (set2.has(k)) overlap++;
      // Partial match: check if any keyword in set2 contains this keyword or vice versa
      else {
        for (const k2 of set2) {
          if ((k.length > 3 && k2.includes(k)) || (k2.length > 3 && k.includes(k2))) {
            overlap += 0.5;
            break;
          }
        }
      }
    });

    return overlap / Math.max(set1.size, set2.size);
  }

  /**
   * Load all active stock items
   */
  private async loadStockItems(): Promise<StockItem[]> {
    const rows = await this.sql`
      SELECT id, item_code, name, description, category
      FROM stock_items
      WHERE is_active = true
      ORDER BY name
    `;

    return rows.map(r => ({
      id: r.id as string,
      itemCode: (r.item_code || '') as string,
      name: (r.name || '') as string,
      description: (r.description || '') as string,
      category: (r.category || '') as string,
    }));
  }

  /**
   * Load all supplier item code mappings
   * Returns Map: lowercase(supplier_item_code) → stock_item_id
   */
  private async loadSupplierMappings(): Promise<Map<string, string>> {
    const rows = await this.sql`
      SELECT supplier_item_code, stock_item_id
      FROM supplier_item_codes
      WHERE is_active = true
    `;

    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.supplier_item_code && r.stock_item_id) {
        map.set(
          (r.supplier_item_code as string).toLowerCase().trim(),
          r.stock_item_id as string
        );
      }
    }
    return map;
  }

  /**
   * Save match results to boq_items
   */
  async saveMatches(results: StockMatchResult[]): Promise<number> {
    let updated = 0;
    for (const result of results) {
      if (result.stockItem) {
        await this.sql`
          UPDATE boq_items
          SET stock_item_id = ${result.stockItem.id}::uuid,
              stock_match_confidence = ${result.matchConfidence},
              stock_match_method = ${result.matchMethod}
          WHERE id = ${result.boqItemId}::uuid
        `;
        updated++;
      }
    }
    return updated;
  }
}

/**
 * Create a stock matcher instance
 */
export function createStockMatcher(databaseUrl: string): StockMatcher {
  return new StockMatcher(databaseUrl);
}
