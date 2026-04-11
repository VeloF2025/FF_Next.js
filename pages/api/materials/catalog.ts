/**
 * Material Catalog API
 * GET - List/search materials
 * POST - Create new material
 *
 * Created: 2026-01-17
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type {
  MaterialCatalog,
  MaterialSearchParams,
  CreateMaterialRequest,
  FiberBudgetCategoryCode,
} from '@/types/procurement/material-catalog.types';
import { TextProcessor } from '@/lib/utils/catalog/textProcessor';

const DATABASE_URL = process.env.DATABASE_URL!;

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(DATABASE_URL);

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, sql);
    case 'POST':
      return handlePost(req, res, sql);
    default:
      return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }
}

/**
 * GET /api/materials/catalog
 * List or search materials
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  sql: ReturnType<typeof neon>
) {
  try {
    const {
      query,
      budgetCategory,
      category,
      status = 'active',
      limit = '50',
      offset = '0',
      sortBy = 'itemCode',
      sortOrder = 'asc',
    } = req.query as unknown as MaterialSearchParams & { limit: string; offset: string };

    const limitNum = Math.min(parseInt(limit, 10) || 50, 500);
    const offsetNum = parseInt(offset, 10) || 0;

    // Build query conditions
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (budgetCategory) {
      conditions.push(`budget_category = $${paramIndex++}`);
      params.push(budgetCategory);
    }

    if (category) {
      conditions.push(`LOWER(category) LIKE $${paramIndex++}`);
      params.push(`%${category.toLowerCase()}%`);
    }

    if (query) {
      conditions.push(`(
        LOWER(item_code) LIKE $${paramIndex} OR
        LOWER(description) LIKE $${paramIndex} OR
        LOWER(normalized_description) LIKE $${paramIndex}
      )`);
      params.push(`%${query.toLowerCase()}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate sort column
    const validSortColumns = ['item_code', 'description', 'category', 'created_at', 'budget_category'];
    const sortColumn = sortBy === 'itemCode' ? 'item_code' :
      sortBy === 'createdAt' ? 'created_at' :
      sortBy === 'budgetCategory' ? 'budget_category' :
      validSortColumns.includes(sortBy as string) ? sortBy : 'item_code';
    const sortDir = sortOrder === 'desc' ? 'DESC' : 'ASC';

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM material_catalog ${whereClause}`;
    const countResult = await sql.unsafe(countQuery, params);
    const total = parseInt(countResult[0].total, 10);

    // Get materials
    const dataQuery = `
      SELECT id, item_code, description, category, budget_category, uom,
             standard_rate, keywords, normalized_description, status,
             created_by, created_at, updated_at
      FROM material_catalog
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDir}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
    params.push(limitNum, offsetNum);

    const materials = await sql.unsafe(dataQuery, params);

    const mappedMaterials: MaterialCatalog[] = materials.map(mapRowToMaterial);

    return apiResponse.paginated(res, mappedMaterials, {
      page: Math.floor(offsetNum / limitNum) + 1,
      pageSize: limitNum,
      total,
    });
  } catch (error) {
    log.error('materials-catalog', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.databaseError(res, error, 'Failed to fetch materials');
  }
}

/**
 * POST /api/materials/catalog
 * Create a new material
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  sql: ReturnType<typeof neon>
) {
  try {
    const body = req.body as CreateMaterialRequest;

    // Validate required fields
    if (!body.itemCode || !body.description || !body.budgetCategory) {
      return apiResponse.validationError(res, {
        itemCode: !body.itemCode ? 'Item code is required' : [],
        description: !body.description ? 'Description is required' : [],
        budgetCategory: !body.budgetCategory ? 'Budget category is required' : [],
      });
    }

    // Check for duplicate item code
    const existing = await sql`
      SELECT id FROM material_catalog
      WHERE LOWER(item_code) = LOWER(${body.itemCode})
    ` as any[];

    if (existing.length > 0) {
      return apiResponse.conflict(res, `Material with item code '${body.itemCode}' already exists`);
    }

    // Generate keywords and normalized description
    const keywords = body.keywords || TextProcessor.extractKeywords(body.description);
    const normalizedDescription = TextProcessor.normalize(body.description);

    // Create material
    const result = await sql`
      INSERT INTO material_catalog (
        item_code,
        description,
        category,
        budget_category,
        uom,
        standard_rate,
        keywords,
        normalized_description,
        status,
        created_by
      ) VALUES (
        ${body.itemCode},
        ${body.description},
        ${body.category || null},
        ${body.budgetCategory},
        ${body.uom || null},
        ${body.standardRate || null},
        ${keywords},
        ${normalizedDescription},
        'active',
        ${'system'}
      )
      RETURNING id, item_code, description, category, budget_category, uom,
                standard_rate, keywords, normalized_description, status,
                created_by, created_at, updated_at
    ` as any[];

    const material = mapRowToMaterial(result[0]);

    return apiResponse.created(res, material, 'Material created successfully');
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to create material');
  }
}

/**
 * Map database row to MaterialCatalog type
 */
function mapRowToMaterial(row: Record<string, unknown>): MaterialCatalog {
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

export default withAuth(handler);
