/**
 * Chart of Accounts Sync Service
 *
 * Pulls the full chart of accounts, account categories,
 * and reporting groups from Sage. Stores locally for
 * enriching ledger transaction reports.
 */

import { NeonQueryFunction } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { SageClient } from '../sageClient';

const logger = createLogger('sage:coa-sync');

export interface CoASyncResult {
  success: boolean;
  accounts: { total: number; created: number; updated: number };
  errors: Array<{ id: string; error: string }>;
}

/**
 * Pull chart of accounts from Sage and store locally
 */
export async function pullChartOfAccounts(
  client: SageClient,
  sql: NeonQueryFunction<false, false>
): Promise<CoASyncResult> {
  const result: CoASyncResult = {
    success: true,
    accounts: { total: 0, created: 0, updated: 0 },
    errors: [],
  };

  try {
    logger.info('Starting chart of accounts pull from Sage');

    // Fetch account categories and reporting groups first for enrichment
    const [categoriesResp, groupsResp, accountsResp] = await Promise.all([
      client.getAccountCategories(),
      client.getReportingGroups(),
      client.getChartOfAccounts(),
    ]);

    const categories = categoriesResp.Results || [];
    const groups = groupsResp.Results || [];
    const accounts = accountsResp.Results || [];

    // Build lookup maps
    const categoryMap = new Map<string, string>();
    for (const cat of categories) {
      categoryMap.set(cat.ID, cat.Description);
    }

    const groupMap = new Map<string, { description: string; categoryId?: string }>();
    for (const grp of groups) {
      groupMap.set(grp.ID, {
        description: grp.Description,
        categoryId: grp.AccountCategoryId,
      });
    }

    result.accounts.total = accounts.length;
    logger.info(`Fetched ${accounts.length} accounts from Sage`);

    for (const account of accounts) {
      try {
        const categoryId = account.Category?.ID || null;
        const categoryDesc = categoryId ? (categoryMap.get(categoryId) || account.Category?.Description || null) : null;
        const reportingGroupId = account.ReportingGroupId || null;
        const groupInfo = reportingGroupId ? groupMap.get(reportingGroupId) : null;
        const groupDesc = groupInfo?.description || null;

        const existing = await sql`
          SELECT id FROM sage_accounts
          WHERE sage_account_id = ${account.ID}
        `;

        if (existing.length > 0) {
          await sql`
            UPDATE sage_accounts
            SET
              name = ${account.Name},
              category_id = ${categoryId},
              category_description = ${categoryDesc},
              reporting_group_id = ${reportingGroupId},
              reporting_group_description = ${groupDesc},
              account_type = ${account.AccountType || null},
              is_active = ${account.Active},
              balance = ${account.Balance || 0},
              updated_at = NOW()
            WHERE sage_account_id = ${account.ID}
          `;
          result.accounts.updated++;
        } else {
          await sql`
            INSERT INTO sage_accounts (
              sage_account_id, name, category_id, category_description,
              reporting_group_id, reporting_group_description,
              account_type, is_active, balance
            ) VALUES (
              ${account.ID}, ${account.Name}, ${categoryId}, ${categoryDesc},
              ${reportingGroupId}, ${groupDesc},
              ${account.AccountType || null}, ${account.Active}, ${account.Balance || 0}
            )
          `;
          result.accounts.created++;
        }
      } catch (error) {
        result.errors.push({
          id: account.ID,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        logger.error(`Failed to upsert account ${account.ID}`, { error });
      }
    }

    // Log sync
    await sql`
      INSERT INTO sage_sync_history (
        operation_type, direction, entity_type, status,
        records_processed, records_success, records_failed, details
      ) VALUES (
        'coa_sync', 'inbound', 'chart_of_accounts',
        ${result.errors.length === 0 ? 'success' : 'partial'},
        ${result.accounts.total},
        ${result.accounts.created + result.accounts.updated},
        ${result.errors.length},
        ${JSON.stringify(result)}
      )
    `;

    logger.info('Chart of accounts sync completed', result);
  } catch (error) {
    result.success = false;
    logger.error('Chart of accounts sync failed', { error });

    await sql`
      INSERT INTO sage_sync_history (
        operation_type, direction, entity_type, status, error_message
      ) VALUES (
        'coa_sync', 'inbound', 'chart_of_accounts', 'failed',
        ${error instanceof Error ? error.message : 'Unknown error'}
      )
    `;
  }

  return result;
}
