/**
 * Category Service
 *
 * Handles CRUD operations for asset categories.
 */

import { getDbConnection } from '../utils/db';
import { log } from '@/lib/logger';
import { CategorySchema, type CategoryInput } from '../utils/schemas';
import type { AssetCategory } from '../types/asset';
import type { AssetCategoryTypeValue } from '../constants/assetCategories';

export interface CategoryServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface CategoryFilter {
  isActive?: boolean;
  type?: string;
}

/**
 * Transform database row to category object
 */
function transformRow(row: Record<string, unknown>): AssetCategory {
  return {
    id: row.id as string,
    name: row.name as string,
    code: row.code as string,
    type: row.type as AssetCategoryTypeValue,
    description: row.description as string | undefined,
    requiresCalibration: row.requires_calibration as boolean,
    calibrationIntervalDays: row.calibration_interval_days as number | undefined,
    depreciationYears: row.depreciation_years as number | undefined,
    isActive: row.is_active as boolean,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export const categoryService = {
  /**
   * Get all categories
   */
  async getAll(filter?: CategoryFilter): Promise<CategoryServiceResult<AssetCategory[]>> {
    try {
      const sql = getDbConnection();
      let rows;

      if (filter?.isActive !== undefined && filter?.type) {
        rows = await sql`
          SELECT * FROM asset_categories
          WHERE is_active = ${filter.isActive} AND type = ${filter.type}
          ORDER BY name ASC
        `;
      } else if (filter?.isActive !== undefined) {
        rows = await sql`
          SELECT * FROM asset_categories
          WHERE is_active = ${filter.isActive}
          ORDER BY name ASC
        `;
      } else if (filter?.type) {
        rows = await sql`
          SELECT * FROM asset_categories
          WHERE type = ${filter.type}
          ORDER BY name ASC
        `;
      } else {
        rows = await sql`
          SELECT * FROM asset_categories
          ORDER BY name ASC
        `;
      }

      return {
        success: true,
        data: rows.map(transformRow),
      };
    } catch (error) {
      log.error('Error fetching categories', { error, filter }, 'categoryService.getAll');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch categories',
      };
    }
  },

  /**
   * Get category by ID
   */
  async getById(id: string): Promise<CategoryServiceResult<AssetCategory | null>> {
    try {
      const sql = getDbConnection();
      const [row] = await sql`
        SELECT * FROM asset_categories
        WHERE id = ${id}
      `;

      return {
        success: true,
        data: row ? transformRow(row) : null,
      };
    } catch (error) {
      log.error('Error fetching category', { error, id }, 'categoryService.getById');
      return {
        success: false,
        data: null,
        error: 'Failed to fetch category',
      };
    }
  },

  /**
   * Get category by code
   */
  async getByCode(code: string): Promise<CategoryServiceResult<AssetCategory | null>> {
    try {
      const sql = getDbConnection();
      const [row] = await sql`
        SELECT * FROM asset_categories
        WHERE code = ${code}
      `;

      return {
        success: true,
        data: row ? transformRow(row) : null,
      };
    } catch (error) {
      log.error('Error fetching category by code', { error, code }, 'categoryService.getByCode');
      return {
        success: false,
        data: null,
        error: 'Failed to fetch category',
      };
    }
  },

  /**
   * Create a new category
   */
  async create(input: CategoryInput): Promise<CategoryServiceResult<AssetCategory | null>> {
    try {
      // Validate input
      const validation = CategorySchema.safeParse(input);
      if (!validation.success) {
        return {
          success: false,
          data: null,
          error: validation.error.errors.map(e => e.message).join(', '),
        };
      }

      const sql = getDbConnection();

      // Check for existing code
      const [existing] = await sql`
        SELECT id FROM asset_categories WHERE code = ${input.code}
      `;

      if (existing) {
        return {
          success: false,
          data: null,
          error: 'Category with this code already exists',
        };
      }

      const [row] = await sql`
        INSERT INTO asset_categories (
          name, code, type, description,
          requires_calibration, calibration_interval_days, depreciation_years
        ) VALUES (
          ${input.name},
          ${input.code},
          ${input.type},
          ${input.description || null},
          ${input.requiresCalibration || false},
          ${input.calibrationIntervalDays || null},
          ${input.depreciationYears || null}
        )
        RETURNING *
      `;

      if (!row) {
        return {
          success: false,
          data: null,
          error: 'Failed to create category',
        };
      }

      return {
        success: true,
        data: transformRow(row),
      };
    } catch (error) {
      log.error('Error creating category', { error, input }, 'categoryService.create');
      return {
        success: false,
        data: null,
        error: 'Failed to create category',
      };
    }
  },

  /**
   * Update a category
   */
  async update(
    id: string,
    input: Partial<CategoryInput>
  ): Promise<CategoryServiceResult<AssetCategory | null>> {
    try {
      const sql = getDbConnection();

      // Check if code is being changed and assets exist
      if (input.code) {
        const [assetCount] = await sql`
          SELECT COUNT(*)::int as count FROM assets WHERE category_id = ${id}
        `;
        if (assetCount && assetCount.count > 0) {
          return {
            success: false,
            data: null,
            error: 'Cannot change code: category has assets',
          };
        }
      }

      const [row] = await sql`
        UPDATE asset_categories SET
          name = COALESCE(${input.name || null}, name),
          code = COALESCE(${input.code || null}, code),
          type = COALESCE(${input.type || null}, type),
          description = COALESCE(${input.description || null}, description),
          requires_calibration = COALESCE(${input.requiresCalibration ?? null}, requires_calibration),
          calibration_interval_days = COALESCE(${input.calibrationIntervalDays ?? null}, calibration_interval_days),
          depreciation_years = COALESCE(${input.depreciationYears ?? null}, depreciation_years),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      if (!row) {
        return {
          success: false,
          data: null,
          error: 'Category not found',
        };
      }

      return {
        success: true,
        data: transformRow(row),
      };
    } catch (error) {
      log.error('Error updating category', { error, id, input }, 'categoryService.update');
      return {
        success: false,
        data: null,
        error: 'Failed to update category',
      };
    }
  },

  /**
   * Delete a category
   */
  async delete(id: string): Promise<CategoryServiceResult<boolean>> {
    try {
      const sql = getDbConnection();

      // Check for assets using this category
      const [assetCount] = await sql`
        SELECT COUNT(*)::int as count FROM assets WHERE category_id = ${id}
      `;

      const count = assetCount?.count || 0;
      if (count > 0) {
        return {
          success: false,
          data: false,
          error: `Cannot delete: category has ${count} assets`,
        };
      }

      await sql`DELETE FROM asset_categories WHERE id = ${id}`;

      return {
        success: true,
        data: true,
      };
    } catch (error) {
      log.error('Error deleting category', { error, id }, 'categoryService.delete');
      return {
        success: false,
        data: false,
        error: 'Failed to delete category',
      };
    }
  },

  /**
   * Set category active status
   */
  async setActive(
    id: string,
    isActive: boolean
  ): Promise<CategoryServiceResult<AssetCategory | null>> {
    try {
      const sql = getDbConnection();

      const [row] = await sql`
        UPDATE asset_categories SET
          is_active = ${isActive},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      if (!row) {
        return {
          success: false,
          data: null,
          error: 'Category not found',
        };
      }

      return {
        success: true,
        data: transformRow(row),
      };
    } catch (error) {
      log.error('Error updating category status', { error, id, isActive }, 'categoryService.setActive');
      return {
        success: false,
        data: null,
        error: 'Failed to update category status',
      };
    }
  },

  /**
   * Get count of assets in a category
   */
  async getAssetCount(id: string): Promise<CategoryServiceResult<number>> {
    try {
      const sql = getDbConnection();

      const [result] = await sql`
        SELECT COUNT(*)::int as count FROM assets WHERE category_id = ${id}
      `;

      return {
        success: true,
        data: result?.count || 0,
      };
    } catch (error) {
      log.error('Error getting asset count', { error, id }, 'categoryService.getAssetCount');
      return {
        success: false,
        data: 0,
        error: 'Failed to get asset count',
      };
    }
  },

  /**
   * Get all unique category types
   */
  async getTypes(): Promise<CategoryServiceResult<string[]>> {
    try {
      const sql = getDbConnection();

      const rows = await sql`
        SELECT DISTINCT type FROM asset_categories ORDER BY type
      `;

      return {
        success: true,
        data: rows.map(r => r.type as string),
      };
    } catch (error) {
      log.error('Error getting category types', { error }, 'categoryService.getTypes');
      return {
        success: false,
        data: [],
        error: 'Failed to get category types',
      };
    }
  },
};
