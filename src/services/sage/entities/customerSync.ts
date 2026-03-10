/**
 * Customer Sync Service
 *
 * Pulls customers from Sage and matches to FF clients.
 * Same pattern as supplierSync but for the customer/client side.
 */

import { NeonQueryFunction } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { SageClient } from '../sageClient';

const logger = createLogger('sage:customer-sync');

export interface CustomerSyncResult {
  success: boolean;
  totalProcessed: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ customerId: string; error: string }>;
}

/**
 * Pull customers from Sage and create/update mappings to FF clients
 */
export async function pullCustomersFromSage(
  client: SageClient,
  sql: NeonQueryFunction<false, false>
): Promise<CustomerSyncResult> {
  const result: CustomerSyncResult = {
    success: true,
    totalProcessed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  try {
    logger.info('Starting customer pull from Sage');

    const sageResponse = await client.getCustomers({ take: 200 });
    const sageCustomers = sageResponse.Results || [];

    logger.info(`Fetched ${sageCustomers.length} customers from Sage`);

    for (const sageCustomer of sageCustomers) {
      result.totalProcessed++;

      try {
        const sageId = sageCustomer.ID;
        const sageName = sageCustomer.Name;

        // Check if already mapped
        const existingMapping = await sql`
          SELECT * FROM sage_entity_mappings
          WHERE sage_entity_type = 'customer' AND sage_entity_id = ${sageId}
        `;

        if (existingMapping.length > 0) {
          await sql`
            UPDATE sage_entity_mappings
            SET last_synced_at = NOW(), updated_at = NOW()
            WHERE id = ${existingMapping[0]!.id}
          `;
          result.updated++;
          continue;
        }

        // Try to find matching FF client
        const matched = await findMatchingClient(sql, sageName);

        if (matched) {
          await sql`
            INSERT INTO sage_entity_mappings (
              ff_entity_type, ff_entity_id, sage_entity_type, sage_entity_id,
              match_type, match_confidence, sync_status, last_synced_at
            ) VALUES (
              'client', ${matched.id}, 'customer', ${sageId},
              ${matched.matchType}, ${matched.matchConfidence}, 'synced', NOW()
            )
          `;

          await sql`
            UPDATE clients
            SET sage_customer_id = ${sageId}, sage_synced_at = NOW(),
                sage_sync_status = 'synced'
            WHERE id = ${matched.id}
          `;

          result.created++;
          logger.info(`Mapped Sage customer ${sageName} to FF client ${matched.name}`);
        } else {
          await sql`
            INSERT INTO sage_entity_mappings (
              ff_entity_type, ff_entity_id, sage_entity_type, sage_entity_id,
              match_type, match_confidence, sync_status
            ) VALUES (
              'client', NULL, 'customer', ${sageId},
              'unmatched', 0, 'pending_review'
            )
          `;

          logger.info(`Sage customer ${sageName} — no FF match, pending review`);
        }
      } catch (error) {
        result.failed++;
        result.errors.push({
          customerId: sageCustomer.ID,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        logger.error(`Failed to process Sage customer ${sageCustomer.ID}`, { error });
      }
    }

    await sql`
      INSERT INTO sage_sync_history (
        operation_type, direction, entity_type, status,
        records_processed, records_success, records_failed, details
      ) VALUES (
        'customer_sync', 'inbound', 'customer',
        ${result.failed === 0 ? 'success' : 'partial'},
        ${result.totalProcessed}, ${result.created + result.updated},
        ${result.failed},
        ${JSON.stringify({ created: result.created, updated: result.updated, errors: result.errors })}
      )
    `;

    logger.info('Customer pull completed', result);
  } catch (error) {
    result.success = false;
    logger.error('Customer sync failed', { error });

    await sql`
      INSERT INTO sage_sync_history (
        operation_type, direction, entity_type, status, error_message
      ) VALUES (
        'customer_sync', 'inbound', 'customer', 'failed',
        ${error instanceof Error ? error.message : 'Unknown error'}
      )
    `;
  }

  return result;
}

async function findMatchingClient(
  sql: NeonQueryFunction<false, false>,
  sageName: string
): Promise<{ id: string; name: string; matchType: 'exact' | 'fuzzy'; matchConfidence: number } | null> {
  // Exact name match
  const exactMatch = await sql`
    SELECT id, name FROM clients
    WHERE LOWER(name) = LOWER(${sageName})
      AND sage_customer_id IS NULL AND deleted_at IS NULL
    LIMIT 1
  `;

  if (exactMatch.length > 0) {
    return {
      id: exactMatch[0]!.id as string,
      name: exactMatch[0]!.name as string,
      matchType: 'exact',
      matchConfidence: 0.95,
    };
  }

  // Fuzzy match using pg_trgm
  try {
    const fuzzyMatch = await sql`
      SELECT id, name, similarity(LOWER(name), LOWER(${sageName})) as sim
      FROM clients
      WHERE sage_customer_id IS NULL AND deleted_at IS NULL
        AND similarity(LOWER(name), LOWER(${sageName})) > 0.6
      ORDER BY sim DESC
      LIMIT 1
    `;

    if (fuzzyMatch.length > 0) {
      return {
        id: fuzzyMatch[0]!.id as string,
        name: fuzzyMatch[0]!.name as string,
        matchType: 'fuzzy',
        matchConfidence: Number(fuzzyMatch[0]!.sim),
      };
    }
  } catch {
    logger.warn('Fuzzy matching unavailable (pg_trgm not installed)');
  }

  return null;
}

/**
 * Manually map a Sage customer to an FF client
 */
export async function manuallyMapCustomer(
  sql: NeonQueryFunction<false, false>,
  sageId: string,
  clientId: string
): Promise<boolean> {
  try {
    await sql`
      UPDATE sage_entity_mappings
      SET ff_entity_id = ${clientId}, match_type = 'manual',
          match_confidence = 1.0, sync_status = 'synced',
          last_synced_at = NOW(), updated_at = NOW()
      WHERE sage_entity_type = 'customer' AND sage_entity_id = ${sageId}
    `;

    await sql`
      UPDATE clients
      SET sage_customer_id = ${sageId}, sage_synced_at = NOW(),
          sage_sync_status = 'synced'
      WHERE id = ${clientId}
    `;

    logger.info(`Manually mapped Sage customer ${sageId} to FF client ${clientId}`);
    return true;
  } catch (error) {
    logger.error('Failed to manually map customer', { sageId, clientId, error });
    return false;
  }
}
