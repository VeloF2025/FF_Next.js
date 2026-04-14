/**
 * Supplier Sync Service
 *
 * Handles bidirectional sync of suppliers between FibreFlow and Sage.
 * - Pull suppliers from Sage and match to FF suppliers
 * - Push FF suppliers to Sage (when not matched)
 */

import { NeonQueryFunction } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { SageClient } from '../sageClient';

const logger = createLogger('sage:supplier-sync');

export interface FFSupplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  tax_number: string | null;
  contact_person: string | null;
  sage_supplier_id: string | null;
  sage_synced_at: Date | null;
  sage_sync_status: string | null;
}

export interface SupplierMapping {
  ffSupplierId: string;
  sageSupplierId: string;
  ffSupplierName: string;
  sageSupplierName: string;
  matchType: 'exact' | 'fuzzy' | 'manual';
  matchConfidence: number;
}

export interface SyncResult {
  success: boolean;
  totalProcessed: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ supplierId: string; error: string }>;
}

/**
 * Pull suppliers from Sage and create mappings
 */
export async function pullSuppliersFromSage(
  client: SageClient,
  sql: NeonQueryFunction<false, false>
): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    totalProcessed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  try {
    logger.info('Starting supplier pull from Sage');

    // Fetch all suppliers from Sage
    const sageResponse = await client.getSuppliers({ take: 200 });
    const sageSuppliers = sageResponse.Results || [];

    logger.info(`Fetched ${sageSuppliers.length} suppliers from Sage`);

    for (const sageSupplier of sageSuppliers) {
      result.totalProcessed++;

      try {
        // Sage returns PascalCase properties
        const sageId = sageSupplier.ID;
        const sageName = sageSupplier.Name;
        const sageTaxRef = sageSupplier.TaxReference;

        // Check if supplier already mapped
        const existingMapping = await sql`
          SELECT * FROM sage_entity_mappings
          WHERE sage_entity_type = 'supplier'
            AND sage_entity_id = ${sageId}
        `;

        if (existingMapping.length > 0) {
          // Already mapped, update the mapping timestamp
          await sql`
            UPDATE sage_entity_mappings
            SET last_synced_at = NOW(), updated_at = NOW()
            WHERE id = ${existingMapping[0]!.id}
          `;
          result.updated++;
          continue;
        }

        // Try to find matching FF supplier by name or tax number
        const matchedSupplier = await findMatchingFFSupplier(
          sql,
          sageName,
          sageTaxRef
        );

        if (matchedSupplier) {
          // Create mapping
          await sql`
            INSERT INTO sage_entity_mappings (
              ff_entity_type,
              ff_entity_id,
              sage_entity_type,
              sage_entity_id,
              match_type,
              match_confidence,
              last_synced_at
            ) VALUES (
              'supplier',
              ${matchedSupplier.id},
              'supplier',
              ${sageId},
              ${matchedSupplier.matchType},
              ${matchedSupplier.matchConfidence},
              NOW()
            )
          `;

          // Update FF supplier with Sage ID
          await sql`
            UPDATE suppliers
            SET
              sage_supplier_id = ${sageId},
              sage_synced_at = NOW(),
              sage_sync_status = 'synced'
            WHERE id = ${matchedSupplier.id}
          `;

          result.created++;
          logger.info(`Mapped Sage supplier ${sageName} to FF supplier ${matchedSupplier.name}`);
        } else {
          // No match found, create unmatched record for manual review
          await sql`
            INSERT INTO sage_entity_mappings (
              ff_entity_type,
              ff_entity_id,
              sage_entity_type,
              sage_entity_id,
              match_type,
              match_confidence,
              sync_status
            ) VALUES (
              'supplier',
              NULL,
              'supplier',
              ${sageId},
              'unmatched',
              0,
              'pending_review'
            )
          `;

          logger.info(`Sage supplier ${sageName} has no FF match - pending review`);
        }
      } catch (error) {
        result.failed++;
        result.errors.push({
          supplierId: sageSupplier.ID,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        logger.error(`Failed to process Sage supplier ${sageSupplier.ID}`, { error });
      }
    }

    // Log sync history
    await sql`
      INSERT INTO sage_sync_history (
        operation_type,
        direction,
        entity_type,
        status,
        records_processed,
        records_success,
        records_failed,
        details
      ) VALUES (
        'supplier_sync',
        'inbound',
        'supplier',
        ${result.failed === 0 ? 'success' : 'partial'},
        ${result.totalProcessed},
        ${result.created + result.updated},
        ${result.failed},
        ${JSON.stringify({ created: result.created, updated: result.updated, errors: result.errors })}
      )
    `;

    logger.info('Supplier pull completed', { data: result });

  } catch (error) {
    result.success = false;
    logger.error('Supplier sync failed', { error });

    await sql`
      INSERT INTO sage_sync_history (
        operation_type,
        direction,
        entity_type,
        status,
        error_message
      ) VALUES (
        'supplier_sync',
        'inbound',
        'supplier',
        'failed',
        ${error instanceof Error ? error.message : 'Unknown error'}
      )
    `;
  }

  return result;
}

/**
 * Find matching FF supplier by name or tax number
 */
async function findMatchingFFSupplier(
  sql: NeonQueryFunction<false, false>,
  sageName: string,
  taxNumber?: string
): Promise<{ id: string; name: string; matchType: 'exact' | 'fuzzy'; matchConfidence: number } | null> {
  // Try exact match by tax number first
  if (taxNumber) {
    const taxMatch = await sql`
      SELECT id, name FROM suppliers
      WHERE tax_number = ${taxNumber}
        AND sage_supplier_id IS NULL
      LIMIT 1
    `;

    if (taxMatch.length > 0) {
      return {
        id: taxMatch[0]!.id,
        name: taxMatch[0]!.name,
        matchType: 'exact',
        matchConfidence: 1.0,
      };
    }
  }

  // Try exact name match
  const exactMatch = await sql`
    SELECT id, name FROM suppliers
    WHERE LOWER(name) = LOWER(${sageName})
      AND sage_supplier_id IS NULL
    LIMIT 1
  `;

  if (exactMatch.length > 0) {
    return {
      id: exactMatch[0]!.id,
      name: exactMatch[0]!.name,
      matchType: 'exact',
      matchConfidence: 0.95,
    };
  }

  // Try fuzzy match using similarity (requires pg_trgm extension)
  const fuzzyMatch = await sql`
    SELECT id, name,
           similarity(LOWER(name), LOWER(${sageName})) as sim
    FROM suppliers
    WHERE sage_supplier_id IS NULL
      AND similarity(LOWER(name), LOWER(${sageName})) > 0.6
    ORDER BY sim DESC
    LIMIT 1
  `;

  if (fuzzyMatch.length > 0) {
    return {
      id: fuzzyMatch[0]!.id,
      name: fuzzyMatch[0]!.name,
      matchType: 'fuzzy',
      matchConfidence: fuzzyMatch[0]!.sim,
    };
  }

  return null;
}

/**
 * Get unmatched Sage suppliers for manual review
 */
export async function getUnmatchedSuppliers(
  sql: NeonQueryFunction<false, false>
): Promise<Array<{ sageId: string; sageName: string; suggestedMatches: FFSupplier[] }>> {
  const unmatched = await sql`
    SELECT
      sem.sage_entity_id,
      sem.id as mapping_id
    FROM sage_entity_mappings sem
    WHERE sem.sage_entity_type = 'supplier'
      AND sem.ff_entity_id IS NULL
      AND sem.sync_status = 'pending_review'
  `;

  // For now, return the unmatched IDs - actual supplier details would need Sage API call
  return unmatched.map((u) => ({
    sageId: u.sage_entity_id,
    sageName: 'Unknown', // Would need to fetch from Sage
    suggestedMatches: [],
  }));
}

/**
 * Manually map a Sage supplier to an FF supplier
 */
export async function manuallyMapSupplier(
  sql: NeonQueryFunction<false, false>,
  sageId: string,
  ffSupplierId: string
): Promise<boolean> {
  try {
    // Update the mapping
    await sql`
      UPDATE sage_entity_mappings
      SET
        ff_entity_id = ${ffSupplierId},
        match_type = 'manual',
        match_confidence = 1.0,
        sync_status = 'synced',
        last_synced_at = NOW(),
        updated_at = NOW()
      WHERE sage_entity_type = 'supplier'
        AND sage_entity_id = ${sageId}
    `;

    // Update FF supplier
    await sql`
      UPDATE suppliers
      SET
        sage_supplier_id = ${sageId},
        sage_synced_at = NOW(),
        sage_sync_status = 'synced'
      WHERE id = ${ffSupplierId}
    `;

    logger.info(`Manually mapped Sage supplier ${sageId} to FF supplier ${ffSupplierId}`);
    return true;
  } catch (error) {
    logger.error('Failed to manually map supplier', { sageId, ffSupplierId, error });
    return false;
  }
}

/**
 * Get supplier mapping by FF supplier ID
 */
export async function getSupplierMapping(
  sql: NeonQueryFunction<false, false>,
  ffSupplierId: string
): Promise<string | null> {
  const mapping = await sql`
    SELECT sage_entity_id
    FROM sage_entity_mappings
    WHERE ff_entity_type = 'supplier'
      AND ff_entity_id = ${ffSupplierId}
      AND sync_status = 'synced'
    LIMIT 1
  `;

  return mapping.length > 0 ? mapping[0]!.sage_entity_id : null;
}
