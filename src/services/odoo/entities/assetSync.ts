/**
 * Odoo Asset Sync Service
 *
 * Syncs assets (tools, equipment, test equipment) from Odoo to FibreFlow
 * with intelligent PO linking and fleet ownership filtering.
 *
 * Sprint 3: Asset-Procurement Integration
 */

import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import {
  OdooClient,
  OdooFleetVehicle,
  OdooProduct,
} from '../odooClient';

const logger = createLogger({ module: 'odooAssetSync' });

// ============================================================================
// Types
// ============================================================================

export interface AssetSyncOptions {
  /** Stock categories to import (e.g., ['tools', 'equipment']) */
  categories?: string[];
  /** Include fleet vehicles as assets */
  includeFleet?: boolean;
  /** Only import company-owned vehicles (not leased/rented) */
  fleetOwnedOnly?: boolean;
  /** Try to link assets to existing purchase orders */
  linkPurchaseOrders?: boolean;
  /** Dry run - don't actually insert/update */
  dryRun?: boolean;
  /** Maximum items to process */
  limit?: number;
}

export interface AssetSyncResult {
  success: boolean;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    linked: number;
    errors: number;
  };
  details: AssetSyncDetail[];
  errors: string[];
}

export interface AssetSyncDetail {
  source: 'product' | 'fleet';
  odooId: number;
  name: string;
  serialNumber?: string;
  action: 'created' | 'updated' | 'skipped' | 'error';
  linkedPoId?: string;
  linkedPoNumber?: string;
  message?: string;
}

export interface OdooAssetData {
  source: 'product' | 'fleet';
  odooId: number;
  name: string;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  category: string;
  purchaseDate: string | null;
  purchasePrice: number | null;
  supplierId: number | null;
  supplierName: string | null;
}

// ============================================================================
// Fleet Ownership Filter
// ============================================================================

/**
 * Determine if a vehicle is company-owned (not leased/rented)
 *
 * A vehicle is considered owned if:
 * - Has acquisition_date AND car_value > 0
 * - State is NOT 'leased' or 'rented'
 */
export function isCompanyOwned(vehicle: OdooFleetVehicle): boolean {
  // Must have acquisition date and positive value
  if (!vehicle.acquisition_date || !vehicle.car_value || vehicle.car_value <= 0) {
    return false;
  }

  // State must not be leased or rented
  if (vehicle.state_id) {
    const state = vehicle.state_id[1].toLowerCase();
    if (state.includes('lease') || state.includes('rent')) {
      return false;
    }
  }

  return true;
}

/**
 * Get ownership status for logging/display
 */
export function getOwnershipStatus(vehicle: OdooFleetVehicle): {
  owned: boolean;
  reason: string;
} {
  if (!vehicle.acquisition_date) {
    return { owned: false, reason: 'No acquisition date' };
  }
  if (!vehicle.car_value || vehicle.car_value <= 0) {
    return { owned: false, reason: 'No purchase value' };
  }
  if (vehicle.state_id) {
    const state = vehicle.state_id[1].toLowerCase();
    if (state.includes('lease')) {
      return { owned: false, reason: `Leased (${vehicle.state_id[1]})` };
    }
    if (state.includes('rent')) {
      return { owned: false, reason: `Rented (${vehicle.state_id[1]})` };
    }
  }
  return { owned: true, reason: 'Company owned' };
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Map Odoo product to asset data
 */
function mapProductToAsset(product: OdooProduct): OdooAssetData {
  return {
    source: 'product',
    odooId: product.id,
    name: product.name,
    serialNumber: product.default_code || null,
    manufacturer: null, // Products don't have manufacturer in Odoo
    model: null,
    category: product.categ_id ? product.categ_id[1] : 'Uncategorized',
    purchaseDate: null,
    purchasePrice: product.standard_price || null,
    supplierId: null,
    supplierName: null,
  };
}

/**
 * Map Odoo fleet vehicle to asset data
 */
function mapVehicleToAsset(vehicle: OdooFleetVehicle): OdooAssetData {
  return {
    source: 'fleet',
    odooId: vehicle.id,
    name: vehicle.name,
    serialNumber: vehicle.vin_sn || vehicle.license_plate || null,
    manufacturer: vehicle.brand_id ? vehicle.brand_id[1] : null,
    model: vehicle.model_id ? vehicle.model_id[1] : null,
    category: 'Vehicle',
    purchaseDate: vehicle.acquisition_date || null,
    purchasePrice: vehicle.car_value || null,
    supplierId: null,
    supplierName: null,
  };
}

// ============================================================================
// PO Linking Functions
// ============================================================================

interface PoLinkCandidate {
  poId: string;
  poNumber: string;
  supplierId: number;
  supplierName: string;
  orderDate: string;
  confidence: 'high' | 'medium' | 'low';
  matchReason: string;
}

/**
 * Try to find a matching PO for an asset
 *
 * Matching strategies (in order of confidence):
 * 1. Serial number match in PO line items (high)
 * 2. Product name match + date proximity (medium)
 * 3. Supplier + date proximity (low)
 */
async function findMatchingPo(
  sql: ReturnType<typeof neon>,
  asset: OdooAssetData
): Promise<PoLinkCandidate | null> {
  // Strategy 1: Serial number match
  if (asset.serialNumber) {
    const serialMatch = await sql`
      SELECT
        po.id as po_id,
        po.po_number,
        po.supplier_id,
        s.name as supplier_name,
        po.order_date
      FROM purchase_orders po
      JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE poi.item_description ILIKE ${`%${asset.serialNumber}%`}
         OR poi.item_code = ${asset.serialNumber}
      LIMIT 1
    `;

    if (serialMatch.length > 0) {
      const match = serialMatch[0] as Record<string, unknown>;
      return {
        poId: match.po_id as string,
        poNumber: match.po_number as string,
        supplierId: match.supplier_id as number,
        supplierName: match.supplier_name as string,
        orderDate: match.order_date as string,
        confidence: 'high',
        matchReason: `Serial number match: ${asset.serialNumber}`,
      };
    }
  }

  // Strategy 2: Product name match with date proximity
  if (asset.purchaseDate) {
    const nameMatch = await sql`
      SELECT
        po.id as po_id,
        po.po_number,
        po.supplier_id,
        s.name as supplier_name,
        po.order_date
      FROM purchase_orders po
      JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE poi.item_description ILIKE ${`%${asset.name.split(' ')[0]}%`}
        AND po.order_date BETWEEN ${asset.purchaseDate}::date - INTERVAL '30 days'
                              AND ${asset.purchaseDate}::date + INTERVAL '30 days'
      ORDER BY ABS(EXTRACT(EPOCH FROM (po.order_date::date - ${asset.purchaseDate}::date)))
      LIMIT 1
    `;

    if (nameMatch.length > 0) {
      const match = nameMatch[0] as Record<string, unknown>;
      return {
        poId: match.po_id as string,
        poNumber: match.po_number as string,
        supplierId: match.supplier_id as number,
        supplierName: match.supplier_name as string,
        orderDate: match.order_date as string,
        confidence: 'medium',
        matchReason: `Name match within 30 days: ${asset.name}`,
      };
    }
  }

  return null;
}

// ============================================================================
// Main Sync Function
// ============================================================================

/**
 * Sync assets from Odoo to FibreFlow
 */
export async function syncAssetsFromOdoo(
  client: OdooClient,
  databaseUrl: string,
  options: AssetSyncOptions = {}
): Promise<AssetSyncResult> {
  const sql = neon(databaseUrl);
  const result: AssetSyncResult = {
    success: false,
    summary: {
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      linked: 0,
      errors: 0,
    },
    details: [],
    errors: [],
  };

  const {
    categories = ['tools', 'equipment', 'test equipment'],
    includeFleet = false,
    fleetOwnedOnly = true,
    linkPurchaseOrders = true,
    dryRun = false,
    limit = 500,
  } = options;

  logger.info('Starting Odoo asset sync', {
    categories,
    includeFleet,
    fleetOwnedOnly,
    linkPurchaseOrders,
    dryRun,
  });

  try {
    const assetsToSync: OdooAssetData[] = [];

    // ========================================================================
    // 1. Fetch products from Odoo (if categories specified)
    // ========================================================================
    if (categories.length > 0) {
      logger.info('Fetching products from Odoo', { categories });

      // Get product categories that match our filter
      const categoryDomain = categories.map((cat) => ['categ_id.name', 'ilike', cat]);
      const orDomain = categoryDomain.reduce((acc: unknown[], curr, i) => {
        if (i === 0) return [curr];
        return ['|', ...acc, curr];
      }, [] as unknown[]);

      const products = await client.getProducts({
        domain: orDomain.length > 0 ? orDomain : [],
        limit,
      });

      logger.info(`Found ${products.length} products in Odoo`);

      for (const product of products) {
        assetsToSync.push(mapProductToAsset(product));
      }
    }

    // ========================================================================
    // 2. Fetch fleet vehicles (if enabled)
    // ========================================================================
    if (includeFleet) {
      logger.info('Fetching fleet vehicles from Odoo', { fleetOwnedOnly });

      const vehicles = await client.getFleetVehicles({ limit });
      logger.info(`Found ${vehicles.length} vehicles in Odoo`);

      for (const vehicle of vehicles) {
        // Apply ownership filter if enabled
        if (fleetOwnedOnly) {
          const ownership = getOwnershipStatus(vehicle);
          if (!ownership.owned) {
            result.details.push({
              source: 'fleet',
              odooId: vehicle.id,
              name: vehicle.name,
              action: 'skipped',
              message: ownership.reason,
            });
            result.summary.skipped++;
            continue;
          }
        }

        assetsToSync.push(mapVehicleToAsset(vehicle));
      }
    }

    result.summary.total = assetsToSync.length;
    logger.info(`Processing ${assetsToSync.length} assets`);

    // ========================================================================
    // 3. Get default asset category for import
    // ========================================================================
    const defaultCategory = await sql`
      SELECT id FROM asset_categories WHERE code = 'MISC' OR name ILIKE '%general%' LIMIT 1
    `;
    const defaultCategoryId = defaultCategory.length > 0
      ? (defaultCategory[0] as Record<string, unknown>).id as string
      : null;

    // ========================================================================
    // 4. Process each asset
    // ========================================================================
    for (const asset of assetsToSync) {
      try {
        // Check if asset already exists (by serial number or Odoo ID)
        const existing = await sql`
          SELECT id, asset_number, odoo_product_id, odoo_vehicle_id
          FROM assets
          WHERE (serial_number = ${asset.serialNumber} AND serial_number IS NOT NULL)
             OR (odoo_product_id = ${asset.source === 'product' ? asset.odooId : null} AND odoo_product_id IS NOT NULL)
             OR (odoo_vehicle_id = ${asset.source === 'fleet' ? asset.odooId : null} AND odoo_vehicle_id IS NOT NULL)
          LIMIT 1
        `;

        const existingAsset = existing.length > 0
          ? (existing[0] as Record<string, unknown>)
          : null;

        // Try to find matching PO
        let poLink: PoLinkCandidate | null = null;
        if (linkPurchaseOrders && !existingAsset) {
          poLink = await findMatchingPo(sql, asset);
        }

        if (dryRun) {
          result.details.push({
            source: asset.source,
            odooId: asset.odooId,
            name: asset.name,
            serialNumber: asset.serialNumber || undefined,
            action: existingAsset ? 'updated' : 'created',
            linkedPoId: poLink?.poId,
            linkedPoNumber: poLink?.poNumber,
            message: `Dry run${poLink ? ` - Would link to ${poLink.poNumber} (${poLink.confidence})` : ''}`,
          });
          if (existingAsset) {
            result.summary.updated++;
          } else {
            result.summary.created++;
          }
          if (poLink) {
            result.summary.linked++;
          }
          continue;
        }

        if (existingAsset) {
          // Update existing asset
          await sql`
            UPDATE assets
            SET
              name = ${asset.name},
              manufacturer = COALESCE(${asset.manufacturer}, manufacturer),
              model = COALESCE(${asset.model}, model),
              purchase_date = COALESCE(${asset.purchaseDate}, purchase_date),
              purchase_price = COALESCE(${asset.purchasePrice}, purchase_price),
              updated_at = NOW()
            WHERE id = ${existingAsset.id as string}
          `;

          result.details.push({
            source: asset.source,
            odooId: asset.odooId,
            name: asset.name,
            serialNumber: asset.serialNumber || undefined,
            action: 'updated',
          });
          result.summary.updated++;
        } else {
          // Create new asset
          const inserted = await sql`
            INSERT INTO assets (
              category_id,
              name,
              serial_number,
              manufacturer,
              model,
              purchase_date,
              purchase_price,
              po_id,
              odoo_product_id,
              odoo_vehicle_id,
              status,
              condition,
              created_by,
              created_at
            ) VALUES (
              ${defaultCategoryId},
              ${asset.name},
              ${asset.serialNumber},
              ${asset.manufacturer},
              ${asset.model},
              ${asset.purchaseDate},
              ${asset.purchasePrice},
              ${poLink?.poId || null},
              ${asset.source === 'product' ? asset.odooId : null},
              ${asset.source === 'fleet' ? asset.odooId : null},
              'available',
              'good',
              'odoo-sync',
              NOW()
            )
            RETURNING id, asset_number
          `;

          const newAsset = inserted[0] as Record<string, unknown>;

          result.details.push({
            source: asset.source,
            odooId: asset.odooId,
            name: asset.name,
            serialNumber: asset.serialNumber || undefined,
            action: 'created',
            linkedPoId: poLink?.poId,
            linkedPoNumber: poLink?.poNumber,
            message: poLink ? `Linked to ${poLink.poNumber} (${poLink.confidence}: ${poLink.matchReason})` : undefined,
          });
          result.summary.created++;

          if (poLink) {
            result.summary.linked++;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.details.push({
          source: asset.source,
          odooId: asset.odooId,
          name: asset.name,
          action: 'error',
          message,
        });
        result.errors.push(`${asset.name} (${asset.source} #${asset.odooId}): ${message}`);
        result.summary.errors++;
      }
    }

    result.success = result.summary.errors === 0;

    logger.info('Odoo asset sync completed', {
      success: result.success,
      summary: result.summary,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Odoo asset sync failed', { error: message });
    result.errors.push(`Sync failed: ${message}`);
    return result;
  }
}

/**
 * Preview assets that would be synced (dry run)
 */
export async function previewAssetSync(
  client: OdooClient,
  databaseUrl: string,
  options: Omit<AssetSyncOptions, 'dryRun'>
): Promise<AssetSyncResult> {
  return syncAssetsFromOdoo(client, databaseUrl, { ...options, dryRun: true });
}
