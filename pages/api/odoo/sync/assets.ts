/**
 * Odoo Asset Sync API
 *
 * GET  /api/odoo/sync/assets?dryRun=true  - Preview assets to sync
 * POST /api/odoo/sync/assets              - Execute asset sync
 *
 * Sprint 3: Asset-Procurement Integration
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { OdooClient } from '@/services/odoo/odooClient';
import {
  syncAssetsFromOdoo,
  previewAssetSync,
  type AssetSyncOptions,
} from '@/services/odoo/entities/assetSync';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'api/odoo/sync/assets' });

const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const ODOO_URL = process.env.ODOO_URL || 'https://velocityfibre.odoo.com';
const ODOO_DB = process.env.ODOO_DB || 'velocityfibre';
const ODOO_USERNAME = process.env.ODOO_USERNAME;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!DATABASE_URL) {
    return apiResponse.internalError(res, new Error('Database URL not configured'));
  }

  if (!ODOO_USERNAME || !ODOO_PASSWORD) {
    return apiResponse.internalError(res, new Error('Odoo credentials not configured'));
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handlePost(req, res);
    default:
      return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }
}

/**
 * GET - Preview assets to sync (dry run)
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const {
    categories,
    includeFleet,
    fleetOwnedOnly,
    linkPurchaseOrders,
    limit,
  } = req.query;

  const options: Omit<AssetSyncOptions, 'dryRun'> = {
    categories: categories
      ? (Array.isArray(categories) ? categories : [categories])
      : ['tools', 'equipment', 'test equipment'],
    includeFleet: includeFleet === 'true',
    fleetOwnedOnly: fleetOwnedOnly !== 'false', // Default true
    linkPurchaseOrders: linkPurchaseOrders !== 'false', // Default true
    limit: limit ? parseInt(limit as string, 10) : 500,
  };

  logger.info('Asset sync preview requested', options);

  // Initialize Odoo client
  const client = new OdooClient({
    url: ODOO_URL,
    db: ODOO_DB,
    username: ODOO_USERNAME!,
    password: ODOO_PASSWORD!,
  });

  await client.authenticate();

  const result = await previewAssetSync(client, DATABASE_URL!, options);

  return apiResponse.success(res, {
    message: 'Preview generated - no changes made',
    dryRun: true,
    ...result,
  });
}

/**
 * POST - Execute asset sync
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const {
    categories,
    includeFleet = false,
    fleetOwnedOnly = true,
    linkPurchaseOrders = true,
    dryRun = false,
    limit = 500,
  } = req.body;

  const options: AssetSyncOptions = {
    categories: categories || ['tools', 'equipment', 'test equipment'],
    includeFleet,
    fleetOwnedOnly,
    linkPurchaseOrders,
    dryRun,
    limit,
  };

  logger.info('Asset sync requested', {
    ...options,
    user: req.user?.email,
  });

  // Initialize Odoo client
  const client = new OdooClient({
    url: ODOO_URL,
    db: ODOO_DB,
    username: ODOO_USERNAME!,
    password: ODOO_PASSWORD!,
  });

  await client.authenticate();

  const result = await syncAssetsFromOdoo(client, DATABASE_URL!, options);

  return apiResponse.success(res, {
    message: dryRun
      ? 'Preview generated - no changes made'
      : `Asset sync completed: ${result.summary.created} created, ${result.summary.updated} updated`,
    ...result,
  });
}

export default withAuth(withErrorHandler(handler));
