/**
 * Asset Registration Service
 *
 * Purpose: Register assets from GRN (Goods Receipt Note) workflow
 * - Get registrable items from completed GRN
 * - Register single asset from GRN item
 * - Batch register multiple assets
 * - Auto-populate from PO/GRN data
 *
 * Status: WORKING - Sprint 2 Asset-Procurement Integration
 *
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import { getDbConnection } from '../utils/db';
import { extractAssetFromLabel, type AssetLabelExtraction } from './assetVlmService';

// ============================================================================
// TYPES
// ============================================================================

export interface RegistrableItem {
  grnItemId: string;
  stockItemId: string | null;
  itemCode: string | null;
  itemDescription: string;
  quantityReceived: number;
  quantityAccepted: number;
  unitCost: number | null;
  uom: string;
  serialNumbers: string[];
  lotNumber: string | null;
  // Pre-populated from stock item
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  requiresRegistration: boolean;
  // Already registered count
  registeredCount: number;
}

export interface GrnForRegistration {
  grnId: string;
  grnNumber: string;
  status: string;
  deliveryDate: string;
  supplierId: number;
  supplierName: string;
  poId: string | null;
  poNumber: string | null;
  warehouseId: string;
  warehouseName: string;
  items: RegistrableItem[];
}

export interface RegisterAssetInput {
  grnItemId: string;
  serialNumber: string;
  categoryId: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  labelImageUrl?: string;
}

export interface RegisteredAsset {
  id: string;
  assetNumber: string;
  name: string;
  serialNumber: string;
  categoryId: string;
  grnId: string;
  grnItemId: string;
  poId: string | null;
}

export interface BatchRegistrationResult {
  success: boolean;
  registered: RegisteredAsset[];
  skipped: Array<{ grnItemId: string; serialNumber: string; reason: string }>;
  errors: Array<{ grnItemId: string; serialNumber: string; error: string }>;
  batchId: string;
}

// ============================================================================
// STOCK CATEGORY → ASSET CATEGORY MAPPING
// ============================================================================

/**
 * Map stock item categories to asset categories
 * This determines which GRN items should trigger asset registration
 */
const STOCK_TO_ASSET_CATEGORY: Record<string, string[]> = {
  tools: ['TKIT', 'CCUT', 'CTST', 'CRMP', 'LADR', 'LBLT', 'MMTR', 'DRLL', 'WSTR'],
  // Add more mappings as needed
};

// Categories that always require asset registration
const REGISTRABLE_STOCK_CATEGORIES = ['tools'];

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Get GRN with registrable items for asset registration
 */
export async function getGrnForRegistration(grnId: string): Promise<GrnForRegistration | null> {
  const sql = getDbConnection();

  try {
    // Get GRN header with related data
    const grnRows = await sql`
      SELECT
        g.id,
        g.grn_number,
        g.status,
        g.delivery_date,
        g.supplier_id,
        s.name as supplier_name,
        g.purchase_order_id as po_id,
        po.po_number,
        g.warehouse_id,
        sl.name as warehouse_name
      FROM goods_receipt_notes g
      LEFT JOIN suppliers s ON g.supplier_id = s.id
      LEFT JOIN purchase_orders po ON g.purchase_order_id = po.id
      LEFT JOIN stock_locations sl ON g.warehouse_id = sl.id
      WHERE g.id = ${grnId}
    `;

    if (grnRows.length === 0) {
      return null;
    }

    const grn = grnRows[0] as Record<string, unknown>;

    // Get GRN items with stock item details and registration status
    const itemRows = await sql`
      SELECT
        gi.id as grn_item_id,
        gi.stock_item_id,
        gi.item_code,
        gi.item_description,
        gi.quantity_received,
        gi.quantity_accepted,
        gi.unit_cost,
        gi.uom,
        gi.serial_numbers,
        gi.lot_number,
        si.category as stock_category,
        ac.id as suggested_category_id,
        ac.name as suggested_category_name,
        (SELECT COUNT(*) FROM assets a WHERE a.grn_item_id = gi.id) as registered_count
      FROM goods_receipt_items gi
      LEFT JOIN stock_items si ON gi.stock_item_id = si.id
      LEFT JOIN asset_category_stock_mapping acsm ON si.category = acsm.stock_category
      LEFT JOIN asset_categories ac ON acsm.asset_category_id = ac.id
      WHERE gi.grn_id = ${grnId}
      ORDER BY gi.created_at
    `;

    const items: RegistrableItem[] = itemRows.map((row) => {
      const r = row as Record<string, unknown>;
      const stockCategory = r.stock_category as string | null;
      const requiresRegistration =
        stockCategory !== null && REGISTRABLE_STOCK_CATEGORIES.includes(stockCategory.toLowerCase());

      return {
        grnItemId: r.grn_item_id as string,
        stockItemId: r.stock_item_id as string | null,
        itemCode: r.item_code as string | null,
        itemDescription: r.item_description as string,
        quantityReceived: Number(r.quantity_received) || 0,
        quantityAccepted: Number(r.quantity_accepted) || 0,
        unitCost: r.unit_cost ? Number(r.unit_cost) : null,
        uom: r.uom as string,
        serialNumbers: (r.serial_numbers as string[]) || [],
        lotNumber: r.lot_number as string | null,
        suggestedCategoryId: r.suggested_category_id as string | null,
        suggestedCategoryName: r.suggested_category_name as string | null,
        requiresRegistration,
        registeredCount: Number(r.registered_count) || 0,
      };
    });

    return {
      grnId: grn.id as string,
      grnNumber: grn.grn_number as string,
      status: grn.status as string,
      deliveryDate: grn.delivery_date as string,
      supplierId: grn.supplier_id as number,
      supplierName: grn.supplier_name as string,
      poId: grn.po_id as string | null,
      poNumber: grn.po_number as string | null,
      warehouseId: grn.warehouse_id as string,
      warehouseName: grn.warehouse_name as string,
      items,
    };
  } catch (error) {
    log.error('[AssetRegistration] Failed to get GRN for registration', {
      grnId,
      error: error instanceof Error ? error.message : 'Unknown',
    });
    throw error;
  }
}

/**
 * Register a single asset from a GRN item
 */
export async function registerAssetFromGrnItem(
  grnId: string,
  input: RegisterAssetInput,
  userId: string
): Promise<RegisteredAsset> {
  const sql = getDbConnection();

  try {
    log.info('[AssetRegistration] Registering asset from GRN item', {
      grnId,
      grnItemId: input.grnItemId,
      serialNumber: input.serialNumber,
    });

    // Get GRN and item details for auto-population
    const grnData = await sql`
      SELECT
        g.id as grn_id,
        g.grn_number,
        g.delivery_date,
        g.supplier_id,
        g.purchase_order_id as po_id,
        gi.id as grn_item_id,
        gi.stock_item_id,
        gi.item_description,
        gi.unit_cost,
        si.name as stock_item_name,
        si.manufacturer,
        si.model,
        ac.id as category_id,
        ac.code as category_code
      FROM goods_receipt_notes g
      JOIN goods_receipt_items gi ON gi.grn_id = g.id
      LEFT JOIN stock_items si ON gi.stock_item_id = si.id
      LEFT JOIN asset_categories ac ON ac.id = ${input.categoryId}
      WHERE g.id = ${grnId} AND gi.id = ${input.grnItemId}
    `;

    if (grnData.length === 0) {
      throw new Error('GRN or GRN item not found');
    }

    const data = grnData[0] as Record<string, unknown>;

    // Check if serial already registered
    const existing = await sql`
      SELECT id, asset_number FROM assets WHERE serial_number = ${input.serialNumber}
    `;

    if (existing.length > 0) {
      throw new Error(`Serial number ${input.serialNumber} already registered as ${(existing[0] as Record<string, unknown>).asset_number}`);
    }

    // Determine asset name
    const assetName = input.name ||
      (data.stock_item_name as string) ||
      (data.item_description as string) ||
      `Asset ${input.serialNumber}`;

    // VLM extraction if label image provided
    let vlmData: AssetLabelExtraction | null = null;
    if (input.labelImageUrl) {
      try {
        const response = await fetch(input.labelImageUrl);
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        vlmData = await extractAssetFromLabel(base64);
      } catch (err) {
        log.warn('[AssetRegistration] VLM extraction failed', {
          error: err instanceof Error ? err.message : 'Unknown',
        });
      }
    }

    // Insert asset with procurement linkage
    const insertResult = await sql`
      INSERT INTO assets (
        category_id,
        name,
        serial_number,
        manufacturer,
        model,
        purchase_date,
        purchase_price,
        supplier_id,
        po_id,
        grn_id,
        grn_item_id,
        stock_item_id,
        label_image_url,
        vlm_extraction_data,
        vlm_extracted_at,
        verification_status,
        status,
        condition,
        created_by,
        created_at
      ) VALUES (
        ${input.categoryId},
        ${assetName},
        ${input.serialNumber},
        ${input.manufacturer || vlmData?.manufacturer || (data.manufacturer as string | null)},
        ${input.model || vlmData?.model || (data.model as string | null)},
        ${data.delivery_date as string},
        ${data.unit_cost as number | null},
        ${data.supplier_id as number | null},
        ${data.po_id as string | null},
        ${grnId},
        ${input.grnItemId},
        ${data.stock_item_id as string | null},
        ${input.labelImageUrl || null},
        ${vlmData ? JSON.stringify(vlmData) : null},
        ${vlmData ? new Date().toISOString() : null},
        'pending',
        'available',
        'new',
        ${userId},
        NOW()
      )
      RETURNING id, asset_number, name, serial_number, category_id
    `;

    const asset = insertResult[0] as Record<string, unknown>;

    log.info('[AssetRegistration] Asset registered successfully', {
      assetId: asset.id,
      assetNumber: asset.asset_number,
      serialNumber: asset.serial_number,
    });

    return {
      id: asset.id as string,
      assetNumber: asset.asset_number as string,
      name: asset.name as string,
      serialNumber: asset.serial_number as string,
      categoryId: asset.category_id as string,
      grnId,
      grnItemId: input.grnItemId,
      poId: data.po_id as string | null,
    };
  } catch (error) {
    log.error('[AssetRegistration] Failed to register asset', {
      grnId,
      grnItemId: input.grnItemId,
      error: error instanceof Error ? error.message : 'Unknown',
    });
    throw error;
  }
}

/**
 * Batch register multiple assets from a GRN
 */
export async function batchRegisterFromGrn(
  grnId: string,
  items: RegisterAssetInput[],
  userId: string
): Promise<BatchRegistrationResult> {
  const sql = getDbConnection();

  const registered: RegisteredAsset[] = [];
  const skipped: Array<{ grnItemId: string; serialNumber: string; reason: string }> = [];
  const errors: Array<{ grnItemId: string; serialNumber: string; error: string }> = [];

  // Create batch record
  const batchResult = await sql`
    INSERT INTO asset_registration_batches (
      grn_id,
      status,
      total_items,
      created_by,
      created_at
    ) VALUES (
      ${grnId},
      'in_progress',
      ${items.length},
      ${userId},
      NOW()
    )
    RETURNING id
  `;

  const batchId = (batchResult[0] as Record<string, unknown>).id as string;

  for (const item of items) {
    try {
      // Check if already registered
      const existing = await sql`
        SELECT id FROM assets WHERE serial_number = ${item.serialNumber}
      `;

      if (existing.length > 0) {
        skipped.push({
          grnItemId: item.grnItemId,
          serialNumber: item.serialNumber,
          reason: 'Serial number already registered',
        });
        continue;
      }

      const asset = await registerAssetFromGrnItem(grnId, item, userId);
      registered.push(asset);
    } catch (error) {
      errors.push({
        grnItemId: item.grnItemId,
        serialNumber: item.serialNumber,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Update batch record
  await sql`
    UPDATE asset_registration_batches
    SET
      status = 'completed',
      registered_count = ${registered.length},
      skipped_count = ${skipped.length + errors.length},
      completed_at = NOW()
    WHERE id = ${batchId}
  `;

  log.info('[AssetRegistration] Batch registration complete', {
    batchId,
    grnId,
    total: items.length,
    registered: registered.length,
    skipped: skipped.length,
    errors: errors.length,
  });

  return {
    success: errors.length === 0,
    registered,
    skipped,
    errors,
    batchId,
  };
}

/**
 * Get items from GRN that are eligible for asset registration
 * (items that require registration and haven't been fully registered)
 */
export async function getRegistrableItems(grnId: string): Promise<RegistrableItem[]> {
  const grn = await getGrnForRegistration(grnId);
  if (!grn) return [];

  return grn.items.filter((item) => {
    // Must require registration
    if (!item.requiresRegistration) return false;

    // Must have items left to register
    const pendingCount = item.quantityAccepted - item.registeredCount;
    return pendingCount > 0;
  });
}
