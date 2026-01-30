/**
 * Enhanced BOQ Import Service
 * Imports BOQ with:
 * - Material catalog matching/creation
 * - Budget category mapping
 * - Budget item creation for item-level tracking
 *
 * Created: 2026-01-17
 */

import { neon } from '@neondatabase/serverless';
import * as XLSX from 'xlsx';
import { MaterialMatcher, MatchInput, MatchOptions } from './materialMatcher';
import { CategoryMapper } from './categoryMapper';
import { TextProcessor } from '@/lib/utils/catalog/textProcessor';
import type {
  BOQImportResult,
  FiberBudgetCategoryCode,
  MaterialMatchResult,
  BudgetItem,
} from '@/types/procurement/material-catalog.types';

export interface BOQRow {
  itemNo?: number;
  uom?: string;
  itemCategory?: string;
  description: string;
  quantity?: number;
  itemCode?: string;
  itemRate?: number;
  photonicsRef?: string;
  supplier?: string;
  leadTime?: string;
  totalCost?: number;
}

export interface ImportOptions {
  projectId: string;
  boqId?: string;
  userId?: string;
  title?: string;
  createBudgetItems?: boolean;
  createMaterials?: boolean;
  dryRun?: boolean;
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportProgress {
  phase: 'parsing' | 'matching' | 'creating' | 'complete';
  current: number;
  total: number;
  message: string;
}

// Column mapping for Lawley BOQ format
const COLUMN_MAPPING = {
  A: 'itemNo',
  B: 'uom',
  C: 'itemCategory',
  D: 'description',
  E: 'quantity',
  F: 'itemCode',
  G: 'itemRate',
  H: 'photonicsRef',
  I: 'supplier',
  J: 'leadTime',
  K: 'totalCost',
} as const;

export class BOQImportEnhanced {
  private sql: ReturnType<typeof neon>;
  private materialMatcher: MaterialMatcher;
  private categoryMapper: CategoryMapper;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
    this.materialMatcher = new MaterialMatcher(databaseUrl);
    this.categoryMapper = new CategoryMapper(databaseUrl);
  }

  /**
   * Import BOQ from Excel file buffer
   */
  async importFromBuffer(
    buffer: ArrayBuffer,
    options: ImportOptions
  ): Promise<BOQImportResult> {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = 'Master Material List';
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found in workbook`);
    }

    // Parse rows
    const data = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' });
    const rows = this.parseRows(data);

    return this.processRows(rows, options);
  }

  /**
   * Import BOQ from parsed rows
   */
  async processRows(
    rows: BOQRow[],
    options: ImportOptions
  ): Promise<BOQImportResult> {
    const result: BOQImportResult = {
      success: true,
      boqId: options.boqId || '',
      itemsProcessed: 0,
      materialsMatched: 0,
      materialsCreated: 0,
      duplicatesPrevented: 0,
      budgetItemsCreated: 0,
      totalBudgetAmount: 0,
      categoryBreakdown: [],
      errors: [],
    };

    // Filter rows with valid data
    const validRows = rows.filter(row =>
      row.description &&
      row.description.trim() !== '' &&
      typeof row.itemNo === 'number'
    );

    result.itemsProcessed = validRows.length;
    this.reportProgress(options, 'parsing', 0, validRows.length, `Found ${validRows.length} valid items`);

    // Initialize category mapper
    await this.categoryMapper.initialize();

    // Get or create BOQ
    const boqId = options.boqId || await this.createBoq(options.projectId, options.userId, options.title);
    result.boqId = boqId;

    // Get or create project budget
    let projectBudgetId: string | null = null;
    let budgetCategories: Map<string, string> = new Map(); // code -> id

    if (options.createBudgetItems) {
      const budgetResult = await this.ensureProjectBudget(options.projectId, options.userId);
      projectBudgetId = budgetResult.budgetId;
      budgetCategories = budgetResult.categories;
    }

    // Process each row
    const categoryTotals = new Map<FiberBudgetCategoryCode, { count: number; amount: number }>();

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      this.reportProgress(options, 'matching', i + 1, validRows.length, `Processing: ${row.description?.substring(0, 40)}...`);

      try {
        // Map category
        const categoryResult = await this.categoryMapper.mapCategory(row.itemCategory || '');
        const budgetCategoryCode = categoryResult.budgetCategoryCode;

        // Match or create material
        const matchInput: MatchInput = {
          itemCode: row.itemCode,
          description: row.description,
          category: row.itemCategory,
          uom: row.uom,
        };

        const matchOptions: MatchOptions = {
          createIfNotFound: options.createMaterials !== false,
          budgetCategory: budgetCategoryCode,
          userId: options.userId,
        };

        const matchResult = await this.materialMatcher.matchItem(matchInput, matchOptions);

        // Track stats
        if (matchResult.matchType === 'exact_code') {
          result.materialsMatched++;
        } else if (matchResult.matchType === 'fuzzy_description') {
          result.materialsMatched++;
        } else if (matchResult.matchType === 'new_item' && matchResult.isNewMaterial) {
          result.materialsCreated++;
        } else if (matchResult.matchType === 'duplicate_prevented') {
          result.duplicatesPrevented++;
          result.materialsMatched++;
        }

        // Record match history
        if (!options.dryRun) {
          await this.materialMatcher.recordMatchHistory(boqId, matchResult, options.userId);
        }

        // Create BOQ item
        if (!options.dryRun) {
          const boqItemId = await this.createBoqItem(boqId, options.projectId, row, matchResult, budgetCategoryCode);

          // Create budget item if enabled
          if (options.createBudgetItems && projectBudgetId && row.quantity && row.itemRate) {
            const budgetCategoryId = budgetCategories.get(budgetCategoryCode);
            if (budgetCategoryId) {
              await this.createBudgetItem({
                projectBudgetId,
                budgetCategoryId,
                materialCatalogId: matchResult.matchedMaterial?.id,
                boqItemId,
                row,
                budgetCategoryCode,
              });
              result.budgetItemsCreated++;
            }
          }
        }

        // Track category totals
        const amount = (row.quantity || 0) * (row.itemRate || 0);
        const existing = categoryTotals.get(budgetCategoryCode) || { count: 0, amount: 0 };
        categoryTotals.set(budgetCategoryCode, {
          count: existing.count + 1,
          amount: existing.amount + amount,
        });
        result.totalBudgetAmount += amount;

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors!.push(`Row ${i + 1}: ${errorMsg}`);
      }
    }

    // Build category breakdown
    const categoryNames: Record<FiberBudgetCategoryCode, string> = {
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

    result.categoryBreakdown = Array.from(categoryTotals.entries())
      .map(([code, data]) => ({
        code,
        name: categoryNames[code],
        itemCount: data.count,
        totalAmount: data.amount,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    // Update project budget total if needed
    if (!options.dryRun && projectBudgetId && options.createBudgetItems) {
      await this.updateBudgetTotals(projectBudgetId, result.categoryBreakdown);
    }

    this.reportProgress(options, 'complete', validRows.length, validRows.length, 'Import complete');
    result.success = (result.errors?.length || 0) === 0;

    return result;
  }

  /**
   * Parse Excel rows to BOQRow objects
   */
  private parseRows(data: unknown[][]): BOQRow[] {
    const rows: BOQRow[] = [];
    const headerRowIndex = this.findHeaderRow(data);

    for (let i = headerRowIndex + 1; i < data.length; i++) {
      const row = data[i] as unknown[];
      if (!row || row.length === 0) continue;

      // Skip section headers (only have first column)
      const nonEmptyCells = row.filter(cell => cell !== '' && cell !== null && cell !== undefined);
      if (nonEmptyCells.length <= 1) continue;

      const boqRow: BOQRow = {
        itemNo: typeof row[0] === 'number' ? row[0] : undefined,
        uom: String(row[1] || ''),
        itemCategory: String(row[2] || ''),
        description: String(row[3] || ''),
        quantity: typeof row[4] === 'number' ? row[4] : undefined,
        itemCode: String(row[5] || ''),
        itemRate: typeof row[6] === 'number' ? row[6] : undefined,
        photonicsRef: String(row[7] || ''),
        supplier: String(row[8] || ''),
        leadTime: String(row[9] || ''),
        totalCost: typeof row[10] === 'number' ? row[10] : undefined,
      };

      // Only include rows with valid data
      if (boqRow.description && boqRow.description.trim()) {
        rows.push(boqRow);
      }
    }

    return rows;
  }

  /**
   * Find the header row in the data
   */
  private findHeaderRow(data: unknown[][]): number {
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row && Array.isArray(row)) {
        const rowStr = row.join(' ').toLowerCase();
        if (rowStr.includes('item') && rowStr.includes('description')) {
          return i;
        }
      }
    }
    return 2; // Default header row
  }

  /**
   * Create a new BOQ record
   */
  private async createBoq(projectId: string, userId?: string, title?: string): Promise<string> {
    // Auto-increment version if one already exists for this project
    const existing = await this.sql`
      SELECT version FROM boqs
      WHERE project_id = ${projectId}
      ORDER BY version DESC
      LIMIT 1
    `;
    let version = '1.0';
    if (existing.length > 0) {
      const lastVersion = parseFloat(existing[0].version) || 1.0;
      version = (lastVersion + 1.0).toFixed(1);
    }

    const result = await this.sql`
      INSERT INTO boqs (
        project_id,
        version,
        title,
        description,
        status,
        uploaded_by
      ) VALUES (
        ${projectId},
        ${version},
        ${title || `BOQ Import ${new Date().toISOString().split('T')[0]}`},
        ${'Imported from Excel'},
        'draft',
        ${userId || 'system'}
      )
      RETURNING id
    `;
    return result[0].id;
  }

  /**
   * Create a BOQ item record
   */
  private async createBoqItem(
    boqId: string,
    projectId: string,
    row: BOQRow,
    matchResult: MaterialMatchResult,
    budgetCategoryCode: FiberBudgetCategoryCode
  ): Promise<string> {
    // Get budget category ID
    const categoryResult = await this.sql`
      SELECT id FROM budget_categories
      WHERE category_code = ${budgetCategoryCode}
      LIMIT 1
    `;

    const result = await this.sql`
      INSERT INTO boq_items (
        boq_id,
        project_id,
        line_number,
        description,
        uom,
        quantity,
        unit_price,
        total_price,
        category,
        material_catalog_id,
        item_code,
        budget_category_id,
        mapping_confidence,
        mapping_status
      ) VALUES (
        ${boqId},
        ${projectId},
        ${row.itemNo || 0},
        ${row.description},
        ${row.uom || 'unit'},
        ${row.quantity || 0},
        ${row.itemRate || 0},
        ${(row.quantity || 0) * (row.itemRate || 0)},
        ${row.itemCategory || null},
        ${matchResult.matchedMaterial?.id || null},
        ${row.itemCode || null},
        ${categoryResult[0]?.id || null},
        ${matchResult.matchConfidence * 100},
        ${matchResult.matchedMaterial ? 'mapped' : 'pending'}
      )
      RETURNING id
    `;
    return result[0].id;
  }

  /**
   * Ensure project budget exists with fiber categories
   */
  private async ensureProjectBudget(
    projectId: string,
    userId?: string
  ): Promise<{ budgetId: string; categories: Map<string, string> }> {
    // Check for existing budget
    const existing = await this.sql`
      SELECT id FROM project_budgets
      WHERE project_id = ${projectId}
      LIMIT 1
    `;

    let budgetId: string;

    if (existing.length > 0) {
      budgetId = existing[0].id;
    } else {
      // Create new budget
      const result = await this.sql`
        INSERT INTO project_budgets (
          project_id,
          source_type,
          total_budget,
          status,
          created_by
        ) VALUES (
          ${projectId},
          'boq',
          0,
          'draft',
          ${userId || 'system'}
        )
        RETURNING id
      `;
      budgetId = result[0].id;

      // Seed fiber categories
      await this.sql`SELECT seed_fiber_budget_categories(${budgetId}::uuid)`;
    }

    // Load category mapping
    const categories = await this.sql`
      SELECT id, category_code
      FROM budget_categories
      WHERE project_budget_id = ${budgetId}
    `;

    const categoryMap = new Map<string, string>();
    for (const cat of categories) {
      categoryMap.set(cat.category_code, cat.id);
    }

    return { budgetId, categories: categoryMap };
  }

  /**
   * Create a budget item record
   */
  private async createBudgetItem(params: {
    projectBudgetId: string;
    budgetCategoryId: string;
    materialCatalogId?: string;
    boqItemId: string;
    row: BOQRow;
    budgetCategoryCode: FiberBudgetCategoryCode;
  }): Promise<string> {
    const result = await this.sql`
      INSERT INTO budget_items (
        project_budget_id,
        budget_category_id,
        material_catalog_id,
        boq_item_id,
        item_code,
        description,
        category,
        uom,
        budgeted_quantity,
        budgeted_rate,
        notes,
        is_manual
      ) VALUES (
        ${params.projectBudgetId},
        ${params.budgetCategoryId},
        ${params.materialCatalogId || null},
        ${params.boqItemId},
        ${params.row.itemCode || null},
        ${params.row.description},
        ${params.row.itemCategory || null},
        ${params.row.uom || null},
        ${params.row.quantity || 0},
        ${params.row.itemRate || 0},
        ${params.row.supplier ? `Supplier: ${params.row.supplier}` : null},
        false
      )
      RETURNING id
    `;
    return result[0].id;
  }

  /**
   * Update budget category totals
   */
  private async updateBudgetTotals(
    projectBudgetId: string,
    categoryBreakdown: { code: FiberBudgetCategoryCode; totalAmount: number }[]
  ): Promise<void> {
    // Update each category's allocated amount
    for (const cat of categoryBreakdown) {
      await this.sql`
        UPDATE budget_categories
        SET allocated_amount = ${cat.totalAmount},
            updated_at = NOW()
        WHERE project_budget_id = ${projectBudgetId}
          AND category_code = ${cat.code}
      `;
    }

    // Update total budget
    const totalAmount = categoryBreakdown.reduce((sum, cat) => sum + cat.totalAmount, 0);
    await this.sql`
      UPDATE project_budgets
      SET total_budget = ${totalAmount},
          updated_at = NOW()
      WHERE id = ${projectBudgetId}
    `;
  }

  /**
   * Report progress to callback
   */
  private reportProgress(
    options: ImportOptions,
    phase: ImportProgress['phase'],
    current: number,
    total: number,
    message: string
  ): void {
    if (options.onProgress) {
      options.onProgress({ phase, current, total, message });
    }
  }
}

/**
 * Create an enhanced BOQ import service instance
 */
export function createBOQImportEnhanced(databaseUrl: string): BOQImportEnhanced {
  return new BOQImportEnhanced(databaseUrl);
}
