/**
 * Asset Service
 *
 * Handles CRUD operations for assets.
 */

import { log } from '@/lib/logger';
import { getDbConnection } from '../utils/db';
import {
  CreateAssetSchema,
  UpdateAssetSchema,
  type CreateAssetInput,
  type UpdateAssetInput,
  type AssetFilterInput,
} from '../utils/schemas';
import type { Asset } from '../types/asset';
import type { AssetAssignment } from '../types/assignment';
import { AssetStatus, isValidTransition } from '../constants/assetStatus';

export interface AssetServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface DashboardStats {
  totalAssets: number;
  availableAssets: number;
  assignedAssets: number;
  inMaintenanceAssets: number;
  calibrationDue: number;
  calibrationOverdue: number;
}

/**
 * Transform database row to asset object
 */
function transformRow(row: Record<string, unknown>): Asset {
  return {
    id: row.id as string,
    assetNumber: row.asset_number as string,
    serialNumber: row.serial_number as string | undefined,
    barcode: row.barcode as string | undefined,
    qrCodeUrl: row.qr_code_url as string | undefined,
    categoryId: row.category_id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    manufacturer: row.manufacturer as string | undefined,
    model: row.model as string | undefined,
    modelNumber: row.model_number as string | undefined,
    purchaseDate: row.purchase_date ? new Date(row.purchase_date as string) : undefined,
    purchasePrice: row.purchase_price as number | undefined,
    currency: row.currency as string,
    supplierId: row.supplier_id as string | undefined,
    warrantyEndDate: row.warranty_end_date ? new Date(row.warranty_end_date as string) : undefined,
    usefulLifeYears: row.useful_life_years as number | undefined,
    salvageValue: (row.salvage_value as number) || 0,
    currentBookValue: row.current_book_value as number | undefined,
    accumulatedDepreciation: row.accumulated_depreciation as number | undefined,
    status: row.status as Asset['status'],
    condition: row.condition as Asset['condition'],
    currentLocation: row.current_location as string | undefined,
    warehouseLocation: row.warehouse_location as string | undefined,
    binLocation: row.bin_location as string | undefined,
    currentAssigneeType: row.current_assignee_type as Asset['currentAssigneeType'],
    currentAssigneeId: row.current_assignee_id as string | undefined,
    currentAssigneeName: row.current_assignee_name as string | undefined,
    assignedSince: row.assigned_since ? new Date(row.assigned_since as string) : undefined,
    requiresCalibration: row.requires_calibration as boolean,
    lastCalibrationDate: row.last_calibration_date ? new Date(row.last_calibration_date as string) : undefined,
    nextCalibrationDate: row.next_calibration_date ? new Date(row.next_calibration_date as string) : undefined,
    calibrationProvider: row.calibration_provider as string | undefined,
    lastMaintenanceDate: row.last_maintenance_date ? new Date(row.last_maintenance_date as string) : undefined,
    nextMaintenanceDate: row.next_maintenance_date ? new Date(row.next_maintenance_date as string) : undefined,
    maintenanceIntervalDays: row.maintenance_interval_days as number | undefined,
    disposalDate: row.disposal_date ? new Date(row.disposal_date as string) : undefined,
    disposalMethod: row.disposal_method as string | undefined,
    disposalValue: row.disposal_value as number | undefined,
    disposalNotes: row.disposal_notes as string | undefined,
    disposedBy: row.disposed_by as string | undefined,
    specifications: row.specifications as Record<string, unknown>,
    notes: row.notes as string | undefined,
    tags: row.tags as string[],
    primaryImageUrl: row.primary_image_url as string | undefined,
    imageUrls: row.image_urls as string[],
    // Procurement Links (Sprint 4)
    poId: row.po_id as string | undefined,
    poNumber: row.po_number as string | undefined,
    grnId: row.grn_id as string | undefined,
    grnNumber: row.grn_number as string | undefined,
    stockItemId: row.stock_item_id as string | undefined,
    // VLM Extraction
    labelImageUrl: row.label_image_url as string | undefined,
    vlmExtractedAt: row.vlm_extracted_at ? new Date(row.vlm_extracted_at as string) : undefined,
    vlmExtractionData: row.vlm_extraction_data as Record<string, unknown> | undefined,
    // Verification
    verificationStatus: row.verification_status as Asset['verificationStatus'],
    verifiedAt: row.verified_at ? new Date(row.verified_at as string) : undefined,
    verifiedBy: row.verified_by as string | undefined,
    verificationImageUrl: row.verification_image_url as string | undefined,
    verificationMismatches: row.verification_mismatches as Asset['verificationMismatches'],
    // Odoo Sync
    odooProductId: row.odoo_product_id as number | undefined,
    odooVehicleId: row.odoo_vehicle_id as number | undefined,
    // Audit
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    createdBy: row.created_by as string,
    updatedBy: row.updated_by as string | undefined,
  };
}

/**
 * Generate unique asset number
 */
async function generateAssetNumber(categoryCode: string): Promise<string> {
  const sql = getDbConnection();
  const year = new Date().getFullYear();
  const prefix = `${categoryCode}-${year}`;

  const [result] = await sql`
    SELECT COUNT(*)::int as count FROM assets
    WHERE asset_number LIKE ${prefix + '%'}
  `;

  const nextNum = ((result?.count as number) || 0) + 1;
  return `${prefix}-${nextNum.toString().padStart(5, '0')}`;
}

export const assetService = {
  /**
   * Get all assets with filtering and pagination
   */
  async getAll(filter?: AssetFilterInput): Promise<AssetServiceResult<Asset[]>> {
    try {
      const sql = getDbConnection();
      const page = filter?.page || 1;
      const limit = filter?.limit || 50;
      const offset = (page - 1) * limit;

      // Build base query - simplified for now
      let rows;

      if (filter?.searchTerm) {
        const searchPattern = `%${filter.searchTerm}%`;
        rows = await sql`
          SELECT * FROM assets
          WHERE name ILIKE ${searchPattern}
             OR serial_number ILIKE ${searchPattern}
             OR asset_number ILIKE ${searchPattern}
             OR manufacturer ILIKE ${searchPattern}
             OR model ILIKE ${searchPattern}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (filter?.status && filter.status.length > 0) {
        rows = await sql`
          SELECT * FROM assets
          WHERE status = ANY(${filter.status})
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (filter?.categoryId && filter.categoryId.length > 0) {
        rows = await sql`
          SELECT * FROM assets
          WHERE category_id = ANY(${filter.categoryId})
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (filter?.calibrationDueWithinDays !== undefined) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + filter.calibrationDueWithinDays);
        rows = await sql`
          SELECT * FROM assets
          WHERE requires_calibration = true
            AND next_calibration_date <= ${dueDate.toISOString().split('T')[0]}
          ORDER BY next_calibration_date ASC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        rows = await sql`
          SELECT * FROM assets
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }

      // Get total count
      const [countResult] = await sql`SELECT COUNT(*)::int as count FROM assets`;

      const total = countResult?.count || 0;
      return {
        success: true,
        data: rows.map(transformRow),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      log.error('Failed to fetch assets', { error }, 'assetService');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch assets',
      };
    }
  },

  /**
   * Get asset by ID
   */
  async getById(id: string): Promise<AssetServiceResult<Asset | null>> {
    try {
      const sql = getDbConnection();
      const [row] = await sql`
        SELECT
          a.*,
          po.po_number,
          grn.grn_number
        FROM assets a
        LEFT JOIN purchase_orders po ON a.po_id = po.id
        LEFT JOIN goods_receipt_notes grn ON a.grn_id = grn.id
        WHERE a.id = ${id}
      `;

      return {
        success: true,
        data: row ? transformRow(row) : null,
      };
    } catch (error) {
      log.error('Failed to fetch asset', { error, id }, 'assetService');
      return {
        success: false,
        data: null,
        error: 'Failed to fetch asset',
      };
    }
  },

  /**
   * Get asset by asset number
   */
  async getByAssetNumber(assetNumber: string): Promise<AssetServiceResult<Asset | null>> {
    try {
      const sql = getDbConnection();
      const [row] = await sql`
        SELECT * FROM assets WHERE asset_number = ${assetNumber}
      `;

      return {
        success: true,
        data: row ? transformRow(row) : null,
      };
    } catch (error) {
      log.error('Failed to fetch asset by number', { error, assetNumber }, 'assetService');
      return {
        success: false,
        data: null,
        error: 'Failed to fetch asset',
      };
    }
  },

  /**
   * Get asset by barcode
   */
  async getByBarcode(barcode: string): Promise<AssetServiceResult<Asset | null>> {
    try {
      const sql = getDbConnection();
      const [row] = await sql`
        SELECT * FROM assets WHERE barcode = ${barcode}
      `;

      return {
        success: true,
        data: row ? transformRow(row) : null,
      };
    } catch (error) {
      log.error('Failed to fetch asset by barcode', { error, barcode }, 'assetService');
      return {
        success: false,
        data: null,
        error: 'Failed to fetch asset',
      };
    }
  },

  /**
   * Create a new asset
   */
  async create(
    input: CreateAssetInput,
    createdBy: string
  ): Promise<AssetServiceResult<Asset | null>> {
    try {
      // Validate input
      const validation = CreateAssetSchema.safeParse(input);
      if (!validation.success) {
        return {
          success: false,
          data: null,
          error: validation.error.errors.map(e => e.message).join(', '),
        };
      }

      const sql = getDbConnection();

      // Get category to determine code and calibration settings
      const [category] = await sql`
        SELECT code, requires_calibration, calibration_interval_days
        FROM asset_categories
        WHERE id = ${input.categoryId}
      `;

      if (!category) {
        return {
          success: false,
          data: null,
          error: 'Category not found',
        };
      }

      // Generate asset number
      const assetNumber = await generateAssetNumber(category.code);

      // Calculate next calibration date if applicable
      let nextCalibrationDate = input.nextCalibrationDate;
      if (category.requires_calibration && !nextCalibrationDate) {
        const days = category.calibration_interval_days || 365;
        const date = new Date();
        date.setDate(date.getDate() + days);
        nextCalibrationDate = date.toISOString().split('T')[0];
      }

      const [row] = await sql`
        INSERT INTO assets (
          asset_number, serial_number, barcode, category_id, name, description,
          manufacturer, model, model_number, purchase_date, purchase_price,
          currency, supplier_id, warranty_end_date, useful_life_years, salvage_value,
          current_location, warehouse_location, bin_location,
          requires_calibration, last_calibration_date, next_calibration_date, calibration_provider,
          maintenance_interval_days, specifications, notes, tags, primary_image_url,
          created_by
        ) VALUES (
          ${assetNumber},
          ${input.serialNumber || null},
          ${input.barcode || null},
          ${input.categoryId},
          ${input.name},
          ${input.description || null},
          ${input.manufacturer || null},
          ${input.model || null},
          ${input.modelNumber || null},
          ${input.purchaseDate || null},
          ${input.purchasePrice || null},
          ${input.currency || 'ZAR'},
          ${input.supplierId || null},
          ${input.warrantyEndDate || null},
          ${input.usefulLifeYears || null},
          ${input.salvageValue || 0},
          ${input.currentLocation || null},
          ${input.warehouseLocation || null},
          ${input.binLocation || null},
          ${category.requires_calibration},
          ${input.lastCalibrationDate || null},
          ${nextCalibrationDate || null},
          ${input.calibrationProvider || null},
          ${input.maintenanceIntervalDays || null},
          ${JSON.stringify(input.specifications || {})},
          ${input.notes || null},
          ${JSON.stringify(input.tags || [])},
          ${input.primaryImageUrl || null},
          ${createdBy}
        )
        RETURNING *
      `;

      if (!row) {
        return {
          success: false,
          data: null,
          error: 'Failed to create asset',
        };
      }

      return {
        success: true,
        data: transformRow(row),
      };
    } catch (error) {
      log.error('Failed to create asset', { error, input }, 'assetService');
      return {
        success: false,
        data: null,
        error: 'Failed to create asset',
      };
    }
  },

  /**
   * Update an asset
   */
  async update(
    id: string,
    input: UpdateAssetInput,
    updatedBy: string
  ): Promise<AssetServiceResult<Asset | null>> {
    try {
      const sql = getDbConnection();

      const [row] = await sql`
        UPDATE assets SET
          name = COALESCE(${input.name || null}, name),
          description = COALESCE(${input.description || null}, description),
          serial_number = COALESCE(${input.serialNumber || null}, serial_number),
          manufacturer = COALESCE(${input.manufacturer || null}, manufacturer),
          model = COALESCE(${input.model || null}, model),
          model_number = COALESCE(${input.modelNumber || null}, model_number),
          purchase_date = COALESCE(${input.purchaseDate || null}, purchase_date),
          purchase_price = COALESCE(${input.purchasePrice ?? null}, purchase_price),
          warranty_end_date = COALESCE(${input.warrantyEndDate || null}, warranty_end_date),
          condition = COALESCE(${input.condition || null}, condition),
          current_location = COALESCE(${input.currentLocation || null}, current_location),
          warehouse_location = COALESCE(${input.warehouseLocation || null}, warehouse_location),
          bin_location = COALESCE(${input.binLocation || null}, bin_location),
          notes = COALESCE(${input.notes || null}, notes),
          next_calibration_date = COALESCE(${input.nextCalibrationDate || null}, next_calibration_date),
          calibration_provider = COALESCE(${input.calibrationProvider || null}, calibration_provider),
          updated_by = ${updatedBy},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      if (!row) {
        return {
          success: false,
          data: null,
          error: 'Asset not found',
        };
      }

      return {
        success: true,
        data: transformRow(row),
      };
    } catch (error) {
      log.error('Failed to update asset', { error, id, input }, 'assetService');
      return {
        success: false,
        data: null,
        error: 'Failed to update asset',
      };
    }
  },

  /**
   * Update asset status
   */
  async updateStatus(
    id: string,
    newStatus: Asset['status'],
    updatedBy: string
  ): Promise<AssetServiceResult<Asset | null>> {
    try {
      const sql = getDbConnection();

      // Get current status
      const [current] = await sql`SELECT status FROM assets WHERE id = ${id}`;
      if (!current) {
        return {
          success: false,
          data: null,
          error: 'Asset not found',
        };
      }

      // Check valid status transition
      if (!isValidTransition(current.status, newStatus)) {
        return {
          success: false,
          data: null,
          error: `Invalid status transition from ${current.status} to ${newStatus}`,
        };
      }

      const [row] = await sql`
        UPDATE assets SET
          status = ${newStatus},
          updated_by = ${updatedBy},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      if (!row) {
        return {
          success: false,
          data: null,
          error: 'Asset not found',
        };
      }

      return {
        success: true,
        data: transformRow(row),
      };
    } catch (error) {
      log.error('Failed to update asset status', { error, id, newStatus }, 'assetService');
      return {
        success: false,
        data: null,
        error: 'Failed to update asset status',
      };
    }
  },

  /**
   * Delete an asset
   */
  async delete(id: string): Promise<AssetServiceResult<boolean>> {
    try {
      const sql = getDbConnection();

      // Check if asset exists and is not assigned
      const [asset] = await sql`SELECT status FROM assets WHERE id = ${id}`;
      if (!asset) {
        return {
          success: false,
          data: false,
          error: 'Asset not found',
        };
      }

      if (asset.status === AssetStatus.ASSIGNED) {
        return {
          success: false,
          data: false,
          error: 'Cannot delete an assigned asset',
        };
      }

      await sql`DELETE FROM assets WHERE id = ${id}`;

      return {
        success: true,
        data: true,
      };
    } catch (error) {
      log.error('Failed to delete asset', { error, id }, 'assetService');
      return {
        success: false,
        data: false,
        error: 'Failed to delete asset',
      };
    }
  },

  /**
   * Get assets with calibration due within specified days
   */
  async getCalibrationDue(withinDays: number): Promise<AssetServiceResult<Asset[]>> {
    try {
      const sql = getDbConnection();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + withinDays);

      let rows;
      if (withinDays === 0) {
        // Get overdue only
        rows = await sql`
          SELECT * FROM assets
          WHERE requires_calibration = true
            AND next_calibration_date < CURRENT_DATE
          ORDER BY next_calibration_date ASC
        `;
      } else {
        rows = await sql`
          SELECT * FROM assets
          WHERE requires_calibration = true
            AND next_calibration_date <= ${dueDate.toISOString().split('T')[0]}
          ORDER BY next_calibration_date ASC
        `;
      }

      return {
        success: true,
        data: rows.map(transformRow),
      };
    } catch (error) {
      log.error('Failed to fetch calibration due assets', { error, withinDays }, 'assetService');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch assets',
      };
    }
  },

  /**
   * Get assets with maintenance due within specified days
   */
  async getMaintenanceDue(withinDays: number): Promise<AssetServiceResult<Asset[]>> {
    try {
      const sql = getDbConnection();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + withinDays);

      const rows = await sql`
        SELECT * FROM assets
        WHERE next_maintenance_date IS NOT NULL
          AND next_maintenance_date <= ${dueDate.toISOString().split('T')[0]}
        ORDER BY next_maintenance_date ASC
      `;

      return {
        success: true,
        data: rows.map(transformRow),
      };
    } catch (error) {
      log.error('Failed to fetch maintenance due assets', { error, withinDays }, 'assetService');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch assets',
      };
    }
  },

  /**
   * Get dashboard statistics
   */
  async getDashboardStats(): Promise<AssetServiceResult<DashboardStats | null>> {
    try {
      const sql = getDbConnection();

      const [stats] = await sql`
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'available')::int as available,
          COUNT(*) FILTER (WHERE status = 'assigned')::int as assigned,
          COUNT(*) FILTER (WHERE status = 'in_maintenance')::int as in_maintenance,
          COUNT(*) FILTER (WHERE requires_calibration = true AND next_calibration_date <= CURRENT_DATE + INTERVAL '30 days')::int as calibration_due,
          COUNT(*) FILTER (WHERE requires_calibration = true AND next_calibration_date < CURRENT_DATE)::int as calibration_overdue
        FROM assets
      `;

      if (!stats) {
        return {
          success: true,
          data: {
            totalAssets: 0,
            availableAssets: 0,
            assignedAssets: 0,
            inMaintenanceAssets: 0,
            calibrationDue: 0,
            calibrationOverdue: 0,
          },
        };
      }

      return {
        success: true,
        data: {
          totalAssets: stats.total || 0,
          availableAssets: stats.available || 0,
          assignedAssets: stats.assigned || 0,
          inMaintenanceAssets: stats.in_maintenance || 0,
          calibrationDue: stats.calibration_due || 0,
          calibrationOverdue: stats.calibration_overdue || 0,
        },
      };
    } catch (error) {
      log.error('Failed to fetch dashboard stats', { error }, 'assetService');
      return {
        success: false,
        data: null,
        error: 'Failed to fetch dashboard statistics',
      };
    }
  },

  /**
   * Search assets by term
   */
  async search(term: string): Promise<AssetServiceResult<Asset[]>> {
    try {
      const sql = getDbConnection();
      const searchPattern = `%${term}%`;

      const rows = await sql`
        SELECT * FROM assets
        WHERE name ILIKE ${searchPattern}
           OR serial_number ILIKE ${searchPattern}
           OR asset_number ILIKE ${searchPattern}
           OR manufacturer ILIKE ${searchPattern}
           OR model ILIKE ${searchPattern}
           OR barcode ILIKE ${searchPattern}
        ORDER BY name ASC
        LIMIT 50
      `;

      return {
        success: true,
        data: rows.map(transformRow),
      };
    } catch (error) {
      log.error('Failed to search assets', { error, term }, 'assetService');
      return {
        success: false,
        data: [],
        error: 'Failed to search assets',
      };
    }
  },

  /**
   * Get assignment history for an asset
   */
  async getAssignmentHistory(assetId: string): Promise<AssetServiceResult<AssetAssignment[]>> {
    try {
      const sql = getDbConnection();

      const rows = await sql`
        SELECT * FROM asset_assignments
        WHERE asset_id = ${assetId}
        ORDER BY checked_out_at DESC
      `;

      return {
        success: true,
        data: rows.map(row => ({
          id: row.id as string,
          assetId: row.asset_id as string,
          assignmentType: row.assignment_type as AssetAssignment['assignmentType'],
          fromType: row.from_type as AssetAssignment['fromType'],
          fromId: row.from_id as string | undefined,
          fromName: row.from_name as string | undefined,
          fromLocation: row.from_location as string | undefined,
          toType: row.to_type as AssetAssignment['toType'],
          toId: row.to_id as string,
          toName: row.to_name as string,
          toLocation: row.to_location as string | undefined,
          projectId: row.project_id as string | undefined,
          projectName: row.project_name as string | undefined,
          checkedOutAt: new Date(row.checked_out_at as string),
          expectedReturnDate: row.expected_return_date ? new Date(row.expected_return_date as string) : undefined,
          checkedInAt: row.checked_in_at ? new Date(row.checked_in_at as string) : undefined,
          conditionAtCheckout: row.condition_at_checkout as AssetAssignment['conditionAtCheckout'],
          conditionAtCheckin: row.condition_at_checkin as AssetAssignment['conditionAtCheckin'],
          authorizedBy: row.authorized_by as string | undefined,
          authorizationNotes: row.authorization_notes as string | undefined,
          checkedInBy: row.checked_in_by as string | undefined,
          checkinNotes: row.checkin_notes as string | undefined,
          checkoutNotes: row.checkout_notes as string | undefined,
          purpose: row.purpose as string | undefined,
          isActive: row.is_active as boolean,
          createdAt: new Date(row.created_at as string),
          createdBy: row.created_by as string,
        })),
      };
    } catch (error) {
      log.error('Failed to fetch assignment history', { error, assetId }, 'assetService');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch assignment history',
      };
    }
  },
};
