/**
 * Material Matcher Service
 * Matches BOQ items to the global material catalog using:
 * 1. Exact Item Code match (confidence: 1.0)
 * 2. Fuzzy Description match (threshold: 85%)
 * 3. Duplicate prevention (similar codes > 80%)
 *
 * Created: 2026-01-17
 */

import { neon, NeonQueryFunction } from '@/lib/db-neon';
import { TextProcessor } from '@/lib/utils/catalog/textProcessor';
import type {
  MaterialCatalog,
  MaterialMatchResult,
  MatchType,
  FiberBudgetCategoryCode,
  MATCH_CONFIDENCE_THRESHOLD,
  DUPLICATE_CODE_THRESHOLD,
} from '@/types/procurement/material-catalog.types';

// Match thresholds
const EXACT_MATCH_CONFIDENCE = 1.0;
const FUZZY_THRESHOLD = 0.85;
const DUPLICATE_CODE_SIMILARITY = 0.80;

// Weighting for composite score
const WEIGHTS = {
  description: 0.60,
  category: 0.20,
  keywords: 0.20,
};

export interface MatchInput {
  itemCode?: string;
  description: string;
  category?: string;
  uom?: string;
}

export interface MatchOptions {
  /** Skip fuzzy matching, only use exact code */
  exactOnly?: boolean;
  /** Create new material if no match found */
  createIfNotFound?: boolean;
  /** Budget category to assign if creating new */
  budgetCategory?: FiberBudgetCategoryCode;
  /** User ID for audit trail */
  userId?: string;
}

export class MaterialMatcher {
  private sql: NeonQueryFunction<false, false>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  /**
   * Match a single item to the material catalog
   */
  async matchItem(
    input: MatchInput,
    options: MatchOptions = {}
  ): Promise<MaterialMatchResult> {
    // Step 1: Try exact Item Code match
    if (input.itemCode) {
      const exactMatch = await this.findByItemCode(input.itemCode);
      if (exactMatch) {
        return {
          inputItemCode: input.itemCode,
          inputDescription: input.description,
          matchType: 'exact_code',
          matchedMaterial: exactMatch,
          matchConfidence: EXACT_MATCH_CONFIDENCE,
          isNewMaterial: false,
        };
      }

      // Check for similar item codes (duplicate prevention)
      const similarCodes = await this.findSimilarCodes(input.itemCode);
      if (similarCodes.length > 0) {
        // Potential duplicate - return best match with warning
        const bestMatch = similarCodes[0]!;
        return {
          inputItemCode: input.itemCode,
          inputDescription: input.description,
          matchType: 'duplicate_prevented',
          matchedMaterial: bestMatch.material,
          matchConfidence: bestMatch.similarity,
          isNewMaterial: false,
          potentialDuplicates: similarCodes.map(s => s.material),
        };
      }
    }

    // Step 2: Fuzzy description match (if not exactOnly)
    if (!options.exactOnly) {
      const fuzzyMatches = await this.findByDescription(
        input.description,
        input.category
      );

      if (fuzzyMatches.length > 0 && fuzzyMatches[0]!.score >= FUZZY_THRESHOLD) {
        return {
          inputItemCode: input.itemCode,
          inputDescription: input.description,
          matchType: 'fuzzy_description',
          matchedMaterial: fuzzyMatches[0]!.material,
          matchConfidence: fuzzyMatches[0]!.score,
          isNewMaterial: false,
          potentialDuplicates: fuzzyMatches.slice(1, 4).map(m => m.material),
        };
      }
    }

    // Step 3: No match found
    if (options.createIfNotFound && input.itemCode && options.budgetCategory) {
      const newMaterial = await this.createMaterial({
        itemCode: input.itemCode,
        description: input.description,
        category: input.category,
        budgetCategory: options.budgetCategory,
        uom: input.uom,
        userId: options.userId,
      });

      return {
        inputItemCode: input.itemCode,
        inputDescription: input.description,
        matchType: 'new_item',
        matchedMaterial: newMaterial,
        matchConfidence: EXACT_MATCH_CONFIDENCE,
        isNewMaterial: true,
      };
    }

    // Return no match result
    return {
      inputItemCode: input.itemCode,
      inputDescription: input.description,
      matchType: 'new_item',
      matchConfidence: 0,
      isNewMaterial: true,
    };
  }

  /**
   * Match multiple items (batch)
   */
  async matchItems(
    inputs: MatchInput[],
    options: MatchOptions = {}
  ): Promise<MaterialMatchResult[]> {
    const results: MaterialMatchResult[] = [];

    // Load all existing materials for efficient matching
    const allMaterials = await this.getAllMaterials();

    for (const input of inputs) {
      const result = await this.matchItemWithCache(input, allMaterials, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Find material by exact item code
   */
  private async findByItemCode(itemCode: string): Promise<MaterialCatalog | null> {
    const result = await this.sql`
      SELECT *
      FROM material_catalog
      WHERE LOWER(item_code) = LOWER(${itemCode})
        AND status = 'active'
      LIMIT 1
    `;

    return result.length > 0 && result[0] ? this.mapToMaterial(result[0] as Record<string, unknown>) : null;
  }

  /**
   * Find materials with similar item codes
   */
  private async findSimilarCodes(
    itemCode: string
  ): Promise<{ material: MaterialCatalog; similarity: number }[]> {
    // Get all active materials and calculate similarity
    const materials = await this.sql`
      SELECT *
      FROM material_catalog
      WHERE status = 'active'
        AND item_code IS NOT NULL
    `;

    const similar: { material: MaterialCatalog; similarity: number }[] = [];

    for (const row of materials) {
      const similarity = TextProcessor.similarity(itemCode, row.item_code);
      if (similarity >= DUPLICATE_CODE_SIMILARITY && similarity < 1.0) {
        similar.push({
          material: this.mapToMaterial(row),
          similarity,
        });
      }
    }

    return similar.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Find materials by fuzzy description match
   */
  private async findByDescription(
    description: string,
    category?: string
  ): Promise<{ material: MaterialCatalog; score: number }[]> {
    const materials = await this.sql`
      SELECT *
      FROM material_catalog
      WHERE status = 'active'
    `;

    const matches: { material: MaterialCatalog; score: number }[] = [];
    const inputKeywords = TextProcessor.extractKeywords(description);

    for (const row of materials) {
      const material = this.mapToMaterial(row);

      // Calculate composite score
      const descScore = TextProcessor.similarity(description, material.description);
      const catScore = category && material.category
        ? TextProcessor.similarity(category, material.category)
        : 0;

      // Keyword overlap score
      const materialKeywords = material.keywords || [];
      const keywordOverlap = this.calculateKeywordOverlap(inputKeywords, materialKeywords);

      const compositeScore =
        descScore * WEIGHTS.description +
        catScore * WEIGHTS.category +
        keywordOverlap * WEIGHTS.keywords;

      if (compositeScore >= FUZZY_THRESHOLD * 0.8) { // Lower threshold for candidates
        matches.push({ material, score: compositeScore });
      }
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  /**
   * Match item with pre-loaded material cache (public for batch imports)
   */
  async matchItemWithCache(
    input: MatchInput,
    materials: MaterialCatalog[],
    options: MatchOptions
  ): Promise<MaterialMatchResult> {
    // Try exact code match
    if (input.itemCode) {
      const exactMatch = materials.find(
        m => m.itemCode.toLowerCase() === input.itemCode!.toLowerCase()
      );
      if (exactMatch) {
        return {
          inputItemCode: input.itemCode,
          inputDescription: input.description,
          matchType: 'exact_code',
          matchedMaterial: exactMatch,
          matchConfidence: EXACT_MATCH_CONFIDENCE,
          isNewMaterial: false,
        };
      }

      // Check similar codes
      const similarCodes = materials
        .filter(m => {
          const sim = TextProcessor.similarity(input.itemCode!, m.itemCode);
          return sim >= DUPLICATE_CODE_SIMILARITY && sim < 1.0;
        })
        .map(m => ({
          material: m,
          similarity: TextProcessor.similarity(input.itemCode!, m.itemCode),
        }))
        .sort((a, b) => b.similarity - a.similarity);

      if (similarCodes.length > 0) {
        return {
          inputItemCode: input.itemCode,
          inputDescription: input.description,
          matchType: 'duplicate_prevented',
          matchedMaterial: similarCodes[0]!.material,
          matchConfidence: similarCodes[0]!.similarity,
          isNewMaterial: false,
          potentialDuplicates: similarCodes.map(s => s.material),
        };
      }
    }

    // Fuzzy description match
    if (!options.exactOnly) {
      const inputKeywords = TextProcessor.extractKeywords(input.description);

      const fuzzyMatches = materials
        .map(material => {
          const descScore = TextProcessor.similarity(input.description, material.description);
          const catScore = input.category && material.category
            ? TextProcessor.similarity(input.category, material.category)
            : 0;
          const materialKeywords = material.keywords || [];
          const keywordOverlap = this.calculateKeywordOverlap(inputKeywords, materialKeywords);

          const score =
            descScore * WEIGHTS.description +
            catScore * WEIGHTS.category +
            keywordOverlap * WEIGHTS.keywords;

          return { material, score };
        })
        .filter(m => m.score >= FUZZY_THRESHOLD)
        .sort((a, b) => b.score - a.score);

      if (fuzzyMatches.length > 0) {
        return {
          inputItemCode: input.itemCode,
          inputDescription: input.description,
          matchType: 'fuzzy_description',
          matchedMaterial: fuzzyMatches[0]!.material,
          matchConfidence: fuzzyMatches[0]!.score,
          isNewMaterial: false,
          potentialDuplicates: fuzzyMatches.slice(1, 4).map(m => m.material),
        };
      }
    }

    // No match - create if option set
    if (options.createIfNotFound && input.itemCode && options.budgetCategory) {
      const newMaterial = await this.createMaterial({
        itemCode: input.itemCode,
        description: input.description,
        category: input.category,
        budgetCategory: options.budgetCategory,
        uom: input.uom,
        userId: options.userId,
      });

      // Add to cache
      materials.push(newMaterial);

      return {
        inputItemCode: input.itemCode,
        inputDescription: input.description,
        matchType: 'new_item',
        matchedMaterial: newMaterial,
        matchConfidence: EXACT_MATCH_CONFIDENCE,
        isNewMaterial: true,
      };
    }

    return {
      inputItemCode: input.itemCode,
      inputDescription: input.description,
      matchType: 'new_item',
      matchConfidence: 0,
      isNewMaterial: true,
    };
  }

  /**
   * Calculate keyword overlap score
   */
  private calculateKeywordOverlap(keywords1: string[], keywords2: string[]): number {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;

    const set1 = new Set(keywords1.map(k => k.toLowerCase()));
    const set2 = new Set(keywords2.map(k => k.toLowerCase()));

    let overlap = 0;
    set1.forEach(k => {
      if (set2.has(k)) overlap++;
    });

    return overlap / Math.max(set1.size, set2.size);
  }

  /**
   * Get all active materials (public for batch pre-loading)
   */
  async getAllMaterials(): Promise<MaterialCatalog[]> {
    const result = await this.sql`
      SELECT *
      FROM material_catalog
      WHERE status = 'active'
      ORDER BY item_code
    `;

    return result.map((row: Record<string, unknown>) => this.mapToMaterial(row));
  }

  /**
   * Create a new material in the catalog
   */
  private async createMaterial(input: {
    itemCode: string;
    description: string;
    category?: string;
    budgetCategory: FiberBudgetCategoryCode;
    uom?: string;
    userId?: string;
  }): Promise<MaterialCatalog> {
    const keywords = TextProcessor.extractKeywords(input.description);
    const normalizedDescription = TextProcessor.normalize(input.description);

    const result = await this.sql`
      INSERT INTO material_catalog (
        item_code,
        description,
        category,
        budget_category,
        uom,
        keywords,
        normalized_description,
        status,
        created_by
      ) VALUES (
        ${input.itemCode},
        ${input.description},
        ${input.category || null},
        ${input.budgetCategory},
        ${input.uom || null},
        ${keywords},
        ${normalizedDescription},
        'active',
        ${input.userId || 'system'}
      )
      RETURNING *
    `;

    return this.mapToMaterial(result[0] as Record<string, unknown>);
  }

  /**
   * Record match history for audit
   */
  async recordMatchHistory(
    boqId: string,
    matchResult: MaterialMatchResult,
    userId?: string
  ): Promise<void> {
    await this.sql`
      INSERT INTO material_match_history (
        boq_id,
        input_item_code,
        input_description,
        matched_material_id,
        match_type,
        match_confidence,
        match_details,
        created_by
      ) VALUES (
        ${boqId},
        ${matchResult.inputItemCode || null},
        ${matchResult.inputDescription},
        ${matchResult.matchedMaterial?.id || null},
        ${matchResult.matchType},
        ${matchResult.matchConfidence},
        ${JSON.stringify({
          isNewMaterial: matchResult.isNewMaterial,
          potentialDuplicatesCount: matchResult.potentialDuplicates?.length || 0,
        })},
        ${userId || 'system'}
      )
    `;
  }

  /**
   * Batch record match history for audit (single INSERT with UNNEST)
   */
  async recordMatchHistoryBatch(
    boqId: string,
    matchResults: MaterialMatchResult[],
    userId?: string
  ): Promise<void> {
    if (matchResults.length === 0) return;

    const boqIds = matchResults.map(() => boqId);
    const itemCodes = matchResults.map(r => r.inputItemCode || null);
    const descriptions = matchResults.map(r => r.inputDescription);
    const materialIds = matchResults.map(r => r.matchedMaterial?.id || null);
    const matchTypes = matchResults.map(r => r.matchType);
    const confidences = matchResults.map(r => r.matchConfidence);
    const details = matchResults.map(r => JSON.stringify({
      isNewMaterial: r.isNewMaterial,
      potentialDuplicatesCount: r.potentialDuplicates?.length || 0,
    }));
    const createdBy = matchResults.map(() => userId || 'system');

    await this.sql`
      INSERT INTO material_match_history (
        boq_id, input_item_code, input_description,
        matched_material_id, match_type, match_confidence,
        match_details, created_by
      )
      SELECT
        unnest(${boqIds}::text[]),
        unnest(${itemCodes}::text[]),
        unnest(${descriptions}::text[]),
        unnest(${materialIds}::text[]),
        unnest(${matchTypes}::text[]),
        unnest(${confidences}::numeric[]),
        unnest(${details}::jsonb[]),
        unnest(${createdBy}::text[])
    `;
  }

  /**
   * Map database row to MaterialCatalog type
   */
  private mapToMaterial(row: Record<string, unknown>): MaterialCatalog {
    return {
      id: row.id as string,
      itemCode: row.item_code as string,
      description: row.description as string,
      category: row.category as string,
      budgetCategory: row.budget_category as FiberBudgetCategoryCode,
      uom: row.uom as string,
      standardRate: row.standard_rate as number | undefined,
      keywords: row.keywords as string[] | undefined,
      normalizedDescription: row.normalized_description as string | undefined,
      status: row.status as 'active' | 'inactive' | 'deprecated',
      createdBy: row.created_by as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

/**
 * Create a material matcher instance with the database URL
 */
export function createMaterialMatcher(databaseUrl: string): MaterialMatcher {
  return new MaterialMatcher(databaseUrl);
}
