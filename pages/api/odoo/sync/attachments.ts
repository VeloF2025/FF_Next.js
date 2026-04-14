/**
 * Odoo Attachment Sync API
 *
 * POST /api/odoo/sync/attachments - Run attachment sync
 * GET /api/odoo/sync/attachments - Get sync statistics
 * GET /api/odoo/sync/attachments?orphans=true - Get orphaned documents
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { OdooClient } from '@/services/odoo/odooClient';
import {
  syncAttachments,
  syncAttachmentsForEntity,
  processPendingAttachments,
  getAttachmentSyncStats,
  getOrphanedDocuments,
  linkOrphanedDocument,
} from '@/services/odoo/entities/attachmentSync';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/odoo/sync/attachments');

const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const ODOO_URL = process.env.ODOO_URL || 'https://velocityfibre.odoo.com';
const ODOO_DB = process.env.ODOO_DB || 'velocityfibre';
const ODOO_USERNAME = process.env.ODOO_USERNAME || 'hein@velocityfibre.co.za';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD || 'process.env.ODOO_PASSWORD';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!DATABASE_URL) {
    return apiResponse.internalError(res, new Error('Database URL not configured'));
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      case 'PUT':
        return handlePut(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    logger.error('Attachment sync API error', { error });
    return apiResponse.internalError(res, error as Error);
  }
}

/**
 * GET - Get sync statistics or orphaned documents
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { orphans, model, limit } = req.query;

  if (orphans === 'true') {
    // Get orphaned documents
    const orphanedDocs = await getOrphanedDocuments(DATABASE_URL!, {
      model: model as string,
      limit: limit ? parseInt(limit as string, 10) : 100,
    });

    return apiResponse.success(res, {
      count: orphanedDocs.length,
      documents: orphanedDocs,
    });
  }

  // Get sync statistics
  const stats = await getAttachmentSyncStats(DATABASE_URL!);
  return apiResponse.success(res, stats);
}

/**
 * POST - Run attachment sync
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const {
    action,
    dryRun = false,
    models,
    limit = 500,
    skipOrphans = false,
    entityType,
    entityId,
  } = req.body;

  logger.info('Starting attachment sync', {
    action,
    dryRun,
    models,
    limit,
    entityType,
    entityId,
  });

  // Initialize Odoo client
  const client = new OdooClient({
    url: ODOO_URL,
    db: ODOO_DB,
    username: ODOO_USERNAME,
    password: ODOO_PASSWORD,
  });

  await client.authenticate();

  // Process pending/failed attachments
  if (action === 'process_pending') {
    const syncResult = await processPendingAttachments(client, DATABASE_URL!, {
      limit: parseInt(String(limit), 10),
      models: models as string[],
    });

    return apiResponse.success(res, {
      message: 'Pending attachments processed',
      result: syncResult,
    });
  }

  // If specific entity provided, sync just that entity
  if (entityType && entityId) {
    const syncResult = await syncAttachmentsForEntity(
      client,
      DATABASE_URL!,
      entityType,
      entityId
    );

    return apiResponse.success(res, {
      message: 'Entity attachment sync completed',
      result: syncResult,
    });
  }

  // Full sync
  const syncResult = await syncAttachments(client, DATABASE_URL!, {
    dryRun,
    models: models as string[],
    limit: parseInt(String(limit), 10),
    includeOrphans: !skipOrphans,
  });

  return apiResponse.success(res, {
    message: dryRun ? 'Dry run completed' : 'Attachment sync completed',
    result: syncResult,
  });
}

/**
 * PUT - Link orphaned document to FF entity
 */
async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  const { documentId, ffEntityType, ffEntityId } = req.body;

  if (!documentId || !ffEntityType || !ffEntityId) {
    return res.status(400).json({
      error: 'Missing required fields: documentId, ffEntityType, ffEntityId',
    });
  }

  const result = await linkOrphanedDocument(
    DATABASE_URL!,
    documentId,
    ffEntityType,
    ffEntityId
  );

  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }

  return apiResponse.success(res, {
    message: 'Document linked successfully',
    documentId,
    ffEntityType,
    ffEntityId,
  });
}

export default withAuth(handler);
