/**
 * Ledger Transaction Sync Service
 *
 * Pulls detailed ledger transactions from Sage with analysis codes.
 * Resolves analysis codes to local categories, populates ff_project_id
 * via site mapping, and ff_business_unit from BU category.
 *
 * Handles:
 * - Pagination (Sage max 200/page)
 * - Incremental sync by date
 * - Rate limiting (60 req/min via delay)
 */

import { NeonQueryFunction } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { SageClient, SageDetailedLedgerTransaction } from '../sageClient';

const logger = createLogger('sage:ledger-sync');

export interface LedgerSyncResult {
  success: boolean;
  totalFetched: number;
  created: number;
  updated: number;
  failed: number;
  projectsMapped: number;
  buMapped: number;
  dateRange: { from: string; to: string };
  errors: Array<{ ref: string; error: string }>;
}

interface CategoryMapping {
  sageId: string;
  typeCode: string;
  description: string;
  ffProjectId: string | null;
}

/**
 * Pull ledger transactions from Sage for a date range
 */
export async function pullLedgerTransactions(
  client: SageClient,
  sql: NeonQueryFunction<false, false>,
  options: { fromDate: string; toDate: string }
): Promise<LedgerSyncResult> {
  const result: LedgerSyncResult = {
    success: true,
    totalFetched: 0,
    created: 0,
    updated: 0,
    failed: 0,
    projectsMapped: 0,
    buMapped: 0,
    dateRange: { from: options.fromDate, to: options.toDate },
    errors: [],
  };

  try {
    logger.info('Starting ledger transaction pull from Sage', options);

    // Pre-load category mappings for resolution
    const categoryMap = await loadCategoryMappings(sql);

    // Fetch all transactions with automatic pagination
    const transactions = await client.getAllLedgerTransactions(
      options.fromDate,
      options.toDate
    );
    result.totalFetched = transactions.length;

    logger.info(`Fetched ${transactions.length} ledger transactions from Sage`);

    // Process in batches of 50 for efficiency
    const batchSize = 50;
    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = transactions.slice(i, i + batchSize);
      await processBatch(sql, batch, categoryMap, result);
    }

    // Log sync
    await sql`
      INSERT INTO sage_sync_history (
        operation_type, direction, entity_type, status,
        records_processed, records_success, records_failed, details
      ) VALUES (
        'ledger_sync', 'inbound', 'ledger_transaction',
        ${result.failed === 0 ? 'success' : 'partial'},
        ${result.totalFetched},
        ${result.created + result.updated},
        ${result.failed},
        ${JSON.stringify({
          created: result.created,
          updated: result.updated,
          projectsMapped: result.projectsMapped,
          buMapped: result.buMapped,
          dateRange: result.dateRange,
          errors: result.errors.slice(0, 20), // Limit error details
        })}
      )
    `;

    logger.info('Ledger sync completed', {
      totalFetched: result.totalFetched,
      created: result.created,
      updated: result.updated,
      failed: result.failed,
    });
  } catch (error) {
    result.success = false;
    logger.error('Ledger sync failed', { error });

    await sql`
      INSERT INTO sage_sync_history (
        operation_type, direction, entity_type, status, error_message
      ) VALUES (
        'ledger_sync', 'inbound', 'ledger_transaction', 'failed',
        ${error instanceof Error ? error.message : 'Unknown error'}
      )
    `;
  }

  return result;
}

/**
 * Process a batch of transactions
 */
async function processBatch(
  sql: NeonQueryFunction<false, false>,
  batch: SageDetailedLedgerTransaction[],
  categoryMap: Map<string, CategoryMapping>,
  result: LedgerSyncResult
): Promise<void> {
  for (const txn of batch) {
    try {
      // Resolve analysis codes
      const siteCategory = txn.AnalysisCategoryId1
        ? categoryMap.get(txn.AnalysisCategoryId1)
        : null;
      const buCategory = txn.AnalysisCategoryId2
        ? categoryMap.get(txn.AnalysisCategoryId2)
        : null;

      // Determine which is site and which is BU based on type_code
      let siteCatId: string | null = null;
      let buCatId: string | null = null;
      let ffProjectId: string | null = null;
      let ffBusinessUnit: string | null = null;

      // Check both slots - site/BU could be in either position
      for (const [cat, catId] of [
        [siteCategory, txn.AnalysisCategoryId1],
        [buCategory, txn.AnalysisCategoryId2],
      ] as [CategoryMapping | null, string | undefined][]) {
        if (!cat) continue;
        if (cat.typeCode === 'site') {
          siteCatId = catId || null;
          ffProjectId = cat.ffProjectId;
        } else if (cat.typeCode === 'bu') {
          buCatId = catId || null;
          ffBusinessUnit = cat.description;
        }
      }

      if (ffProjectId) result.projectsMapped++;
      if (ffBusinessUnit) result.buMapped++;

      // Upsert transaction
      const docNum = txn.DocumentNumber || '';
      const txnDate = txn.Date;
      const accountId = txn.AccountId;

      // Check for existing by composite key
      const existing = await sql`
        SELECT id FROM sage_ledger_transactions
        WHERE sage_account_id = ${accountId}
          AND transaction_date = ${txnDate}
          AND document_number = ${docNum}
          AND debit = ${txn.Debit}
          AND credit = ${txn.Credit}
        LIMIT 1
      `;

      if (existing.length > 0) {
        await sql`
          UPDATE sage_ledger_transactions
          SET
            sage_site_category_id = ${siteCatId},
            sage_bu_category_id = ${buCatId},
            ff_project_id = ${ffProjectId},
            ff_business_unit = ${ffBusinessUnit},
            updated_at = NOW()
          WHERE id = ${existing[0].id}
        `;
        result.updated++;
      } else {
        await sql`
          INSERT INTO sage_ledger_transactions (
            sage_transaction_id,
            transaction_date,
            description,
            document_number,
            reference,
            sage_account_id,
            account_name,
            debit,
            credit,
            tax,
            sage_site_category_id,
            sage_bu_category_id,
            ff_project_id,
            ff_business_unit,
            source_module,
            source_document_id
          ) VALUES (
            ${txn.ID || null},
            ${txnDate},
            ${txn.Description || null},
            ${docNum},
            ${txn.Reference || null},
            ${accountId},
            ${txn.AccountName || null},
            ${txn.Debit},
            ${txn.Credit},
            ${txn.Tax || 0},
            ${siteCatId},
            ${buCatId},
            ${ffProjectId},
            ${ffBusinessUnit},
            ${txn.SourceModule || null},
            ${txn.SourceDocumentId || null}
          )
        `;
        result.created++;
      }
    } catch (error) {
      result.failed++;
      const ref = txn.DocumentNumber || txn.Reference || txn.ID || 'unknown';
      result.errors.push({
        ref,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      logger.error(`Failed to process ledger transaction ${ref}`, { error });
    }
  }
}

/**
 * Load all category mappings for quick lookup during sync
 */
async function loadCategoryMappings(
  sql: NeonQueryFunction<false, false>
): Promise<Map<string, CategoryMapping>> {
  const categories = await sql`
    SELECT
      sage_category_id,
      type_code,
      description,
      ff_project_id
    FROM sage_analysis_categories
    WHERE is_active = true
  `;

  const map = new Map<string, CategoryMapping>();
  for (const row of categories) {
    map.set(row.sage_category_id as string, {
      sageId: row.sage_category_id as string,
      typeCode: (row.type_code as string) || '',
      description: row.description as string,
      ffProjectId: (row.ff_project_id as string) || null,
    });
  }

  return map;
}

/**
 * Get ledger sync status
 */
export async function getLedgerSyncStatus(
  sql: NeonQueryFunction<false, false>
): Promise<{
  totalTransactions: number;
  projectMapped: number;
  buMapped: number;
  dateRange: { earliest: string | null; latest: string | null };
  lastSync: Record<string, unknown> | null;
}> {
  const stats = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE ff_project_id IS NOT NULL) as project_mapped,
      COUNT(*) FILTER (WHERE ff_business_unit IS NOT NULL) as bu_mapped,
      MIN(transaction_date) as earliest,
      MAX(transaction_date) as latest
    FROM sage_ledger_transactions
  `;

  const lastSync = await sql`
    SELECT * FROM sage_sync_history
    WHERE entity_type = 'ledger_transaction'
    ORDER BY created_at DESC LIMIT 1
  `;

  return {
    totalTransactions: parseInt(stats[0]?.total as string || '0'),
    projectMapped: parseInt(stats[0]?.project_mapped as string || '0'),
    buMapped: parseInt(stats[0]?.bu_mapped as string || '0'),
    dateRange: {
      earliest: (stats[0]?.earliest as string) || null,
      latest: (stats[0]?.latest as string) || null,
    },
    lastSync: lastSync[0] || null,
  };
}
