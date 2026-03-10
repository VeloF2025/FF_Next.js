/**
 * Odoo Supplier Sync Service
 *
 * Syncs suppliers from Odoo (res.partner) to FibreFlow (suppliers table)
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { OdooClient, OdooPartner } from '../odooClient';

const logger = createLogger({ module: 'odooSupplierSync' });

// ============================================================================
// Types
// ============================================================================

export interface SupplierSyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  details: Array<{
    odooId: number;
    name: string;
    action: 'created' | 'updated' | 'skipped' | 'error';
    message?: string;
  }>;
}

interface FFSupplierData {
  odoo_partner_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  tax_number: string | null;
  physical_street1: string | null;
  physical_street2: string | null;
  physical_city: string | null;
  physical_state: string | null;
  physical_postal_code: string | null;
  physical_country: string | null;
  is_active: boolean;
  supplier_rank: number;
  reference_code: string | null;
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Map Odoo partner to FibreFlow supplier format
 */
function mapOdooToFF(partner: OdooPartner): FFSupplierData {
  // Extract country from country_id tuple
  const country = partner.country_id ? partner.country_id[1] : null;

  // Extract province/state from state_id tuple
  const state = partner.state_id ? partner.state_id[1] : null;

  return {
    odoo_partner_id: partner.id,
    name: partner.name,
    email: partner.email || null,
    phone: partner.phone || null,
    tax_number: partner.vat || null,
    physical_street1: partner.street || null,
    physical_street2: partner.street2 || null,
    physical_city: partner.city || null,
    physical_state: state,
    physical_postal_code: partner.zip || null,
    physical_country: country,
    is_active: partner.active,
    supplier_rank: partner.supplier_rank || 0,
    reference_code: partner.ref || null,
  };
}

// ============================================================================
// Sync Functions
// ============================================================================

/**
 * Sync all suppliers from Odoo to FibreFlow
 */
export async function syncSuppliers(
  client: OdooClient,
  databaseUrl: string,
  options?: { dryRun?: boolean }
): Promise<SupplierSyncResult> {
  const sql = neon(databaseUrl);
  const result: SupplierSyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  try {
    logger.info('Starting supplier sync from Odoo');

    // Get all suppliers from Odoo (via PO history)
    const odooSuppliers = await client.getSuppliers({ limit: 200 });
    logger.info(`Found ${odooSuppliers.length} suppliers in Odoo`);

    // Get existing FF suppliers with Odoo IDs
    const existingSuppliers = await sql<{ id: string; odoo_partner_id: number }[]>`
      SELECT id, odoo_partner_id FROM suppliers WHERE odoo_partner_id IS NOT NULL
    `;
    const existingByOdooId = new Map(
      existingSuppliers.map((s) => [s.odoo_partner_id, s.id])
    );

    // Process each Odoo supplier
    for (const odooSupplier of odooSuppliers) {
      try {
        const ffData = mapOdooToFF(odooSupplier);
        const existingId = existingByOdooId.get(odooSupplier.id);

        if (options?.dryRun) {
          result.details.push({
            odooId: odooSupplier.id,
            name: odooSupplier.name,
            action: existingId ? 'updated' : 'created',
            message: 'Dry run - no changes made',
          });
          if (existingId) {
            result.updated++;
          } else {
            result.created++;
          }
          continue;
        }

        if (existingId) {
          // Update existing supplier
          await sql`
            UPDATE suppliers
            SET
              name = ${ffData.name},
              email = ${ffData.email},
              phone = ${ffData.phone},
              tax_number = ${ffData.tax_number},
              physical_street1 = ${ffData.physical_street1},
              physical_street2 = ${ffData.physical_street2},
              physical_city = ${ffData.physical_city},
              physical_state = ${ffData.physical_state},
              physical_postal_code = ${ffData.physical_postal_code},
              physical_country = ${ffData.physical_country},
              is_active = ${ffData.is_active},
              supplier_rank = ${ffData.supplier_rank},
              reference_code = ${ffData.reference_code},
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ${existingId}
          `;
          result.updated++;
          result.details.push({
            odooId: odooSupplier.id,
            name: odooSupplier.name,
            action: 'updated',
          });
          logger.debug(`Updated supplier: ${odooSupplier.name}`);
        } else {
          // Generate a unique code for the supplier
          const code = `ODOO-${odooSupplier.id}`;

          // Create new supplier
          await sql`
            INSERT INTO suppliers (
              code, name, email, phone, tax_number,
              physical_street1, physical_street2, physical_city,
              physical_state, physical_postal_code, physical_country,
              is_active, supplier_rank, reference_code, odoo_partner_id,
              status, created_by, created_at, updated_at
            ) VALUES (
              ${code}, ${ffData.name}, ${ffData.email}, ${ffData.phone}, ${ffData.tax_number},
              ${ffData.physical_street1}, ${ffData.physical_street2}, ${ffData.physical_city},
              ${ffData.physical_state}, ${ffData.physical_postal_code}, ${ffData.physical_country},
              ${ffData.is_active}, ${ffData.supplier_rank}, ${ffData.reference_code}, ${ffData.odoo_partner_id},
              'active', 'odoo-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
          `;
          result.created++;
          result.details.push({
            odooId: odooSupplier.id,
            name: odooSupplier.name,
            action: 'created',
          });
          logger.debug(`Created supplier: ${odooSupplier.name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`${odooSupplier.name}: ${message}`);
        result.details.push({
          odooId: odooSupplier.id,
          name: odooSupplier.name,
          action: 'error',
          message,
        });
        logger.error(`Error syncing supplier ${odooSupplier.name}`, { error: message });
      }
    }

    // Record sync in history (check if table exists first)
    if (!options?.dryRun) {
      try {
        await sql`
          INSERT INTO odoo_sync_history (
            entity_type, sync_type, records_processed, records_created,
            records_updated, records_failed, status, error_details, completed_at
          ) VALUES (
            'supplier', 'full', ${odooSuppliers.length}, ${result.created},
            ${result.updated}, ${result.errors.length},
            ${result.errors.length > 0 ? 'completed_with_errors' : 'completed'},
            ${result.errors.length > 0 ? JSON.stringify(result.errors) : null},
            CURRENT_TIMESTAMP
          )
        `;
      } catch {
        // Table might not exist yet, that's ok
        logger.debug('Could not record sync history - table may not exist');
      }
    }

    logger.info('Supplier sync completed', {
      created: result.created,
      updated: result.updated,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Supplier sync failed', { error: message });
    result.errors.push(`Sync failed: ${message}`);
    return result;
  }
}

/**
 * Sync a single supplier by Odoo ID
 */
export async function syncSingleSupplier(
  client: OdooClient,
  databaseUrl: string,
  odooPartnerId: number
): Promise<{ success: boolean; message: string; supplierId?: string }> {
  const sql = neon(databaseUrl);

  try {
    const odooSupplier = await client.getSupplier(odooPartnerId);

    if (!odooSupplier) {
      return { success: false, message: 'Supplier not found in Odoo' };
    }

    const ffData = mapOdooToFF(odooSupplier);

    // Check if already exists
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM suppliers WHERE odoo_partner_id = ${odooPartnerId}
    `;

    if (existing.length > 0) {
      await sql`
        UPDATE suppliers
        SET
          name = ${ffData.name},
          email = ${ffData.email},
          phone = ${ffData.phone},
          tax_number = ${ffData.tax_number},
          physical_street1 = ${ffData.physical_street1},
          physical_street2 = ${ffData.physical_street2},
          physical_city = ${ffData.physical_city},
          physical_state = ${ffData.physical_state},
          physical_postal_code = ${ffData.physical_postal_code},
          physical_country = ${ffData.physical_country},
          is_active = ${ffData.is_active},
          supplier_rank = ${ffData.supplier_rank},
          reference_code = ${ffData.reference_code},
          updated_at = CURRENT_TIMESTAMP
        WHERE odoo_partner_id = ${odooPartnerId}
      `;
      return {
        success: true,
        message: 'Supplier updated',
        supplierId: existing[0].id,
      };
    } else {
      const code = `ODOO-${odooPartnerId}`;
      const insertResult = await sql<{ id: string }[]>`
        INSERT INTO suppliers (
          code, name, email, phone, tax_number,
          physical_street1, physical_street2, physical_city,
          physical_state, physical_postal_code, physical_country,
          is_active, supplier_rank, reference_code, odoo_partner_id,
          status, created_by, created_at, updated_at
        ) VALUES (
          ${code}, ${ffData.name}, ${ffData.email}, ${ffData.phone}, ${ffData.tax_number},
          ${ffData.physical_street1}, ${ffData.physical_street2}, ${ffData.physical_city},
          ${ffData.physical_state}, ${ffData.physical_postal_code}, ${ffData.physical_country},
          ${ffData.is_active}, ${ffData.supplier_rank}, ${ffData.reference_code}, ${ffData.odoo_partner_id},
          'active', 'odoo-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING id
      `;
      return {
        success: true,
        message: 'Supplier created',
        supplierId: insertResult[0].id,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Single supplier sync failed', { odooPartnerId, error: message });
    return { success: false, message };
  }
}
