/**
 * Sage Scheduled Sync Cron Job
 *
 * Runs every 15 minutes to:
 * 1. Pull new invoices from Sage
 * 2. Pull new payments from Sage
 * 3. Update budget transactions
 *
 * Triggered by external cron service (Vercel Cron, GitHub Actions, etc.)
 * Protected by CRON_SECRET header
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { createSageClientFromConfig } from '@/services/sage';
import { pullInvoicesFromSage } from '@/services/sage/entities/invoiceSync';
import { pullPaymentsFromSage } from '@/services/sage/entities/paymentSync';

const logger = createLogger('api:cron:sage-sync');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  // Verify cron secret (mandatory — fail closed if not configured)
  const cronSecret = req.headers['x-cron-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    logger.error('CRON_SECRET not configured — rejecting cron request');
    return res.status(503).json({ error: 'Cron endpoint misconfigured' });
  }
  if (cronSecret !== expectedSecret) {
    logger.warn('Unauthorized cron request attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const startTime = Date.now();

  const results = {
    success: true,
    invoices: null as unknown,
    payments: null as unknown,
    duration: 0,
    errors: [] as string[],
  };

  try {
    logger.info('Starting scheduled Sage sync');

    // Check if Sage is configured and connected
    const configResult = await sql`
      SELECT
        id,
        client_id,
        client_secret,
        company_id,
        base_url,
        access_token,
        refresh_token,
        token_expires_at,
        sync_enabled,
        last_sync_at
      FROM sage_api_config
      WHERE is_active = true AND is_connected = true
      LIMIT 1
    `;

    if (configResult.length === 0) {
      logger.info('Sage sync skipped - not configured or not connected');
      return apiResponse.success(res, {
        message: 'Sage sync skipped - not configured or not connected',
        skipped: true,
      });
    }

    const config = configResult[0]!; // Guaranteed by length check above

    // Check if sync is enabled
    if (config.sync_enabled === false) {
      logger.info('Sage sync skipped - sync disabled in config');
      return apiResponse.success(res, {
        message: 'Sage sync skipped - sync disabled',
        skipped: true,
      });
    }

    // Create Sage client
    const client = createSageClientFromConfig({
      clientId: config.client_id,
      clientSecret: config.client_secret,
      companyId: config.company_id,
      baseUrl: config.base_url,
      accessToken: config.access_token,
      refreshToken: config.refresh_token,
      expiresAt: config.token_expires_at ? new Date(config.token_expires_at) : undefined,
    } as any);

    // Calculate since date (last sync or 24 hours ago)
    const sinceDate = config.last_sync_at
      ? new Date(config.last_sync_at)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Step 1: Sync invoices
    try {
      logger.info('Syncing invoices from Sage');
      results.invoices = await pullInvoicesFromSage(client, sql, { sinceDate });
    } catch (error) {
      results.errors.push(`Invoice sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.error('Invoice sync failed', { error });
    }

    // Step 2: Sync payments
    try {
      logger.info('Syncing payments from Sage');
      results.payments = await pullPaymentsFromSage(client, sql, { sinceDate });
    } catch (error) {
      results.errors.push(`Payment sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.error('Payment sync failed', { error });
    }

    // Update last sync timestamp
    await sql`
      UPDATE sage_api_config
      SET
        last_sync_at = NOW(),
        updated_at = NOW()
      WHERE id = ${config.id}
    `;

    results.duration = Date.now() - startTime;
    results.success = results.errors.length === 0;

    // Log overall sync result
    await sql`
      INSERT INTO sage_sync_history (
        operation_type,
        direction,
        status,
        details
      ) VALUES (
        'scheduled_sync',
        'inbound',
        ${results.success ? 'success' : 'partial'},
        ${JSON.stringify(results)}
      )
    `;

    logger.info('Scheduled Sage sync completed', {
      duration: results.duration,
      success: results.success,
      errors: results.errors,
    });

    return apiResponse.success(res, results);
  } catch (error) {
    results.success = false;
    results.errors.push(error instanceof Error ? error.message : 'Unknown error');
    results.duration = Date.now() - startTime;

    logger.error('Scheduled Sage sync failed', { error });

    // Log failure
    await sql`
      INSERT INTO sage_sync_history (
        operation_type,
        direction,
        status,
        error_message,
        details
      ) VALUES (
        'scheduled_sync',
        'inbound',
        'failed',
        ${error instanceof Error ? error.message : 'Unknown error'},
        ${JSON.stringify(results)}
      )
    `;

    return apiResponse.success(res, results);
  }
}
