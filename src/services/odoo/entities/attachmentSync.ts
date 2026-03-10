/**
 * Odoo Attachment Sync Service
 *
 * Syncs attachments/documents from Odoo (ir.attachment) to FibreFlow
 * Handles auto-linking to FF entities via existing Odoo ID mappings
 *
 * Supported entity mappings:
 * - purchase.order → purchase_orders.odoo_po_id
 * - fleet.vehicle → fleet_vehicles.odoo_vehicle_id
 * - product.product → stock_items.odoo_product_id
 * - res.partner → suppliers.odoo_partner_id
 * - stock.picking → goods_receipt_notes.odoo_picking_id
 */

import { neon, NeonQueryFunction } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { OdooClient, OdooAttachment } from '../odooClient';
import { VFStorageService } from '@/services/vfStorageAdapter';

const logger = createLogger({ module: 'odooAttachmentSync' });

// ============================================================================
// Types
// ============================================================================

export interface AttachmentSyncResult {
  synced: number;
  orphaned: number;
  skipped: number;
  errors: string[];
  details: Array<{
    odooId: number;
    name: string;
    model: string;
    action: 'synced' | 'orphaned' | 'skipped' | 'error';
    ffEntityType?: string;
    ffEntityId?: string;
    message?: string;
  }>;
}

export interface AttachmentSyncOptions {
  dryRun?: boolean;
  models?: string[];      // Filter by Odoo models (e.g., ['purchase.order', 'fleet.vehicle'])
  limit?: number;         // Max attachments to process
  skipExisting?: boolean; // Skip if already in odoo_documents
  includeOrphans?: boolean; // Whether to store orphaned documents
}

interface EntityMapping {
  odooModel: string;
  ffTable: string;
  ffEntityType: string;
  odooIdColumn: string;
  idColumn: string;
}

// Entity mapping configuration
const ENTITY_MAPPINGS: EntityMapping[] = [
  {
    odooModel: 'purchase.order',
    ffTable: 'purchase_orders',
    ffEntityType: 'purchase_order',
    odooIdColumn: 'odoo_po_id',
    idColumn: 'id',
  },
  {
    odooModel: 'fleet.vehicle',
    ffTable: 'fleet_vehicles',
    ffEntityType: 'vehicle',
    odooIdColumn: 'odoo_vehicle_id',
    idColumn: 'id',
  },
  {
    odooModel: 'product.product',
    ffTable: 'stock_items',
    ffEntityType: 'product',
    odooIdColumn: 'odoo_product_id',
    idColumn: 'id',
  },
  {
    odooModel: 'res.partner',
    ffTable: 'suppliers',
    ffEntityType: 'supplier',
    odooIdColumn: 'odoo_partner_id',
    idColumn: 'id',
  },
  {
    odooModel: 'stock.picking',
    ffTable: 'goods_receipt_notes',
    ffEntityType: 'grn',
    odooIdColumn: 'odoo_picking_id',
    idColumn: 'id',
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Detect document type from filename and mimetype
 */
function detectDocumentType(filename: string, mimetype: string): string {
  const lowerName = filename.toLowerCase();
  const lowerMime = mimetype.toLowerCase();

  // Invoice detection
  if (
    lowerName.includes('invoice') ||
    lowerName.includes('inv') ||
    lowerName.includes('faktura')
  ) {
    return 'invoice';
  }

  // Delivery note detection
  if (
    lowerName.includes('delivery') ||
    lowerName.includes('dn') ||
    lowerName.includes('pod')
  ) {
    return 'delivery_note';
  }

  // Quote detection
  if (
    lowerName.includes('quote') ||
    lowerName.includes('quotation') ||
    lowerName.includes('rfq')
  ) {
    return 'quote';
  }

  // Contract detection
  if (
    lowerName.includes('contract') ||
    lowerName.includes('agreement')
  ) {
    return 'contract';
  }

  // Certificate detection
  if (
    lowerName.includes('cert') ||
    lowerName.includes('certificate')
  ) {
    return 'certificate';
  }

  // Image detection
  if (lowerMime.startsWith('image/')) {
    return 'image';
  }

  // PDF is likely a document
  if (lowerMime === 'application/pdf') {
    return 'document';
  }

  return 'other';
}

/**
 * Get storage path for an attachment
 */
function getStoragePath(
  odooModel: string,
  ffEntityId: string | null,
  isOrphan: boolean
): { type: string; category: string } {
  // VF Storage only supports /upload/{type}/{category} — no nested paths
  const modelSlug = odooModel.replace(/\./g, '-');

  if (isOrphan || !ffEntityId) {
    return {
      type: 'odoo-docs',
      category: `orphaned-${modelSlug}`,
    };
  }

  return {
    type: 'odoo-docs',
    category: `${modelSlug}-${ffEntityId}`,
  };
}

/**
 * Build entity mapping cache from database
 */
async function buildEntityMappingCache(
  sql: NeonQueryFunction<false, false>
): Promise<Map<string, Map<number, string>>> {
  const cache = new Map<string, Map<number, string>>();

  for (const mapping of ENTITY_MAPPINGS) {
    try {
      // Dynamic query to get odoo_id -> ff_id mappings
      const query = `
        SELECT ${mapping.idColumn} as ff_id, ${mapping.odooIdColumn} as odoo_id
        FROM ${mapping.ffTable}
        WHERE ${mapping.odooIdColumn} IS NOT NULL
      `;
      const rows = await sql.unsafe(query) as Array<{ ff_id: string; odoo_id: number }>;

      const modelCache = new Map<number, string>();
      for (const row of rows) {
        modelCache.set(row.odoo_id, row.ff_id);
      }

      cache.set(mapping.odooModel, modelCache);
      logger.debug(`Loaded ${modelCache.size} mappings for ${mapping.odooModel}`);
    } catch (error) {
      logger.warn(`Could not load mappings for ${mapping.ffTable}`, { error });
      cache.set(mapping.odooModel, new Map());
    }
  }

  return cache;
}

/**
 * Find FF entity for an Odoo attachment
 */
function findFFEntity(
  odooModel: string,
  odooRecordId: number,
  mappingCache: Map<string, Map<number, string>>
): { ffEntityType: string; ffEntityId: string } | null {
  const mapping = ENTITY_MAPPINGS.find((m) => m.odooModel === odooModel);
  if (!mapping) return null;

  const modelCache = mappingCache.get(odooModel);
  if (!modelCache) return null;

  const ffId = modelCache.get(odooRecordId);
  if (!ffId) return null;

  return {
    ffEntityType: mapping.ffEntityType,
    ffEntityId: ffId,
  };
}

// ============================================================================
// Main Sync Functions
// ============================================================================

/**
 * Sync attachments from Odoo to FibreFlow
 */
export async function syncAttachments(
  client: OdooClient,
  databaseUrl: string,
  options: AttachmentSyncOptions = {}
): Promise<AttachmentSyncResult> {
  const sql = neon(databaseUrl);
  const storage = new VFStorageService();

  const result: AttachmentSyncResult = {
    synced: 0,
    orphaned: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  const {
    dryRun = false,
    models,
    limit = 500,
    skipExisting = true,
    includeOrphans = true,
  } = options;

  try {
    logger.info('Starting attachment sync from Odoo', { dryRun, models, limit });

    // Check storage health
    const storageHealthy = await storage.checkHealth();
    if (!storageHealthy && !dryRun) {
      throw new Error('VF Storage service is not available');
    }

    // Build entity mapping cache
    const mappingCache = await buildEntityMappingCache(sql);

    // Get existing synced attachments to skip (only skip 'synced' — retry pending/failed)
    let existingIds = new Set<number>();
    if (skipExisting) {
      const existing = await sql<{ odoo_attachment_id: number }[]>`
        SELECT odoo_attachment_id FROM odoo_documents WHERE sync_status = 'synced'
      `;
      existingIds = new Set(existing.map((e) => e.odoo_attachment_id));
      logger.info(`Found ${existingIds.size} already synced attachments`);
    }

    // Fetch attachments from Odoo
    const odooAttachments = await client.getAttachments({
      resModel: models && models.length === 1 ? models[0] : undefined,
      limit,
    });

    // Filter by models if specified
    let filteredAttachments = odooAttachments;
    if (models && models.length > 1) {
      filteredAttachments = odooAttachments.filter((a) => models.includes(a.res_model));
    }

    logger.info(`Found ${filteredAttachments.length} attachments to process`);

    // Process each attachment
    for (const attachment of filteredAttachments) {
      try {
        // Skip if already synced
        if (skipExisting && existingIds.has(attachment.id)) {
          result.skipped++;
          result.details.push({
            odooId: attachment.id,
            name: attachment.name,
            model: attachment.res_model,
            action: 'skipped',
            message: 'Already synced',
          });
          continue;
        }

        // Find FF entity mapping
        const ffEntity = findFFEntity(
          attachment.res_model,
          attachment.res_id,
          mappingCache
        );

        const isOrphan = !ffEntity;

        // Skip orphans if not including them
        if (isOrphan && !includeOrphans) {
          result.skipped++;
          result.details.push({
            odooId: attachment.id,
            name: attachment.name,
            model: attachment.res_model,
            action: 'skipped',
            message: `No FF mapping for ${attachment.res_model}:${attachment.res_id}`,
          });
          continue;
        }

        // Dry run - just record what would happen
        if (dryRun) {
          if (isOrphan) {
            result.orphaned++;
            result.details.push({
              odooId: attachment.id,
              name: attachment.name,
              model: attachment.res_model,
              action: 'orphaned',
              message: 'Dry run - would be stored as orphan',
            });
          } else {
            result.synced++;
            result.details.push({
              odooId: attachment.id,
              name: attachment.name,
              model: attachment.res_model,
              action: 'synced',
              ffEntityType: ffEntity?.ffEntityType,
              ffEntityId: ffEntity?.ffEntityId,
              message: 'Dry run - would be synced and linked',
            });
          }
          continue;
        }

        // Download attachment from Odoo
        const downloadResult = await client.downloadAttachment(attachment.id);
        if (!downloadResult) {
          result.errors.push(`${attachment.name}: Could not download from Odoo`);
          result.details.push({
            odooId: attachment.id,
            name: attachment.name,
            model: attachment.res_model,
            action: 'error',
            message: 'Download failed',
          });
          continue;
        }

        // Determine storage path
        const storagePath = getStoragePath(
          attachment.res_model,
          ffEntity?.ffEntityId || null,
          isOrphan
        );

        // Generate unique filename
        const timestamp = Date.now();
        const safeFilename = downloadResult.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueFilename = `${attachment.id}_${timestamp}_${safeFilename}`;

        // Upload to VF Storage
        const uploadResult = await storage.uploadFile(
          downloadResult.buffer,
          storagePath.type,
          storagePath.category,
          uniqueFilename
        );

        if (!uploadResult.success) {
          result.errors.push(`${attachment.name}: Upload failed`);
          result.details.push({
            odooId: attachment.id,
            name: attachment.name,
            model: attachment.res_model,
            action: 'error',
            message: 'Upload to VF Storage failed',
          });
          continue;
        }

        // Detect document type
        const documentType = detectDocumentType(
          attachment.name,
          downloadResult.mimetype
        );

        // Insert record into odoo_documents
        await sql`
          INSERT INTO odoo_documents (
            odoo_attachment_id,
            odoo_model,
            odoo_record_id,
            ff_entity_type,
            ff_entity_id,
            document_type,
            file_name,
            file_path,
            file_url,
            file_size,
            mime_type,
            sync_status,
            odoo_create_date
          ) VALUES (
            ${attachment.id},
            ${attachment.res_model},
            ${attachment.res_id},
            ${ffEntity?.ffEntityType || null},
            ${ffEntity?.ffEntityId || null},
            ${documentType},
            ${downloadResult.filename},
            ${uploadResult.path},
            ${uploadResult.url},
            ${downloadResult.fileSize},
            ${downloadResult.mimetype},
            ${isOrphan ? 'orphaned' : 'synced'},
            ${attachment.create_date ? new Date(attachment.create_date) : null}
          )
          ON CONFLICT (odoo_attachment_id) DO UPDATE SET
            file_path = EXCLUDED.file_path,
            file_url = EXCLUDED.file_url,
            sync_status = EXCLUDED.sync_status,
            updated_at = NOW()
        `;

        if (isOrphan) {
          result.orphaned++;
          result.details.push({
            odooId: attachment.id,
            name: attachment.name,
            model: attachment.res_model,
            action: 'orphaned',
            message: `Stored as orphan: ${uploadResult.path}`,
          });
          logger.debug(`Orphaned attachment: ${attachment.name}`, {
            model: attachment.res_model,
            recordId: attachment.res_id,
          });
        } else {
          result.synced++;
          result.details.push({
            odooId: attachment.id,
            name: attachment.name,
            model: attachment.res_model,
            action: 'synced',
            ffEntityType: ffEntity?.ffEntityType,
            ffEntityId: ffEntity?.ffEntityId,
            message: `Linked to ${ffEntity?.ffEntityType}:${ffEntity?.ffEntityId}`,
          });
          logger.debug(`Synced attachment: ${attachment.name}`, {
            ffEntityType: ffEntity?.ffEntityType,
            ffEntityId: ffEntity?.ffEntityId,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`${attachment.name}: ${message}`);
        result.details.push({
          odooId: attachment.id,
          name: attachment.name,
          model: attachment.res_model,
          action: 'error',
          message,
        });
        logger.error(`Error syncing attachment ${attachment.name}`, { error: message });
      }
    }

    // Record sync in history
    if (!dryRun) {
      try {
        await sql`
          INSERT INTO odoo_sync_history (
            entity_type, sync_type, records_processed, records_created,
            records_updated, records_failed, status, error_details, completed_at
          ) VALUES (
            'attachment', 'full', ${filteredAttachments.length}, ${result.synced + result.orphaned},
            0, ${result.errors.length},
            ${result.errors.length > 0 ? 'completed_with_errors' : 'completed'},
            ${result.errors.length > 0 ? JSON.stringify(result.errors) : null},
            CURRENT_TIMESTAMP
          )
        `;
      } catch {
        logger.debug('Could not record sync history - table may not exist');
      }
    }

    logger.info('Attachment sync completed', {
      synced: result.synced,
      orphaned: result.orphaned,
      skipped: result.skipped,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Attachment sync failed', { error: message });
    result.errors.push(`Sync failed: ${message}`);
    return result;
  }
}

/**
 * Sync attachments for a specific entity type
 */
export async function syncAttachmentsForModel(
  client: OdooClient,
  databaseUrl: string,
  model: string,
  options: Omit<AttachmentSyncOptions, 'models'> = {}
): Promise<AttachmentSyncResult> {
  return syncAttachments(client, databaseUrl, {
    ...options,
    models: [model],
  });
}

/**
 * Process pending/failed attachments — download from Odoo and upload to VF Storage
 * These records already exist in odoo_documents but never had files downloaded.
 */
export async function processPendingAttachments(
  client: OdooClient,
  databaseUrl: string,
  options: { limit?: number; models?: string[] } = {}
): Promise<AttachmentSyncResult> {
  const sql = neon(databaseUrl);
  const storage = new VFStorageService();

  const result: AttachmentSyncResult = {
    synced: 0,
    orphaned: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  const { limit = 200, models } = options;

  try {
    logger.info('Processing pending/failed attachments', { limit, models });

    const storageHealthy = await storage.checkHealth();
    if (!storageHealthy) {
      throw new Error('VF Storage service is not available');
    }

    // Fetch pending/failed records from odoo_documents
    interface PendingDoc {
      id: string;
      odoo_attachment_id: number;
      odoo_model: string;
      odoo_record_id: number;
      ff_entity_type: string | null;
      ff_entity_id: string | null;
      file_name: string;
      sync_attempts: number;
    }

    let pendingDocs: PendingDoc[];
    if (models && models.length > 0) {
      pendingDocs = await sql`
        SELECT id, odoo_attachment_id, odoo_model, odoo_record_id,
               ff_entity_type, ff_entity_id, file_name, sync_attempts
        FROM odoo_documents
        WHERE sync_status IN ('pending', 'failed')
          AND odoo_model = ANY(${models})
        ORDER BY created_at
        LIMIT ${limit}
      ` as unknown as PendingDoc[];
    } else {
      pendingDocs = await sql`
        SELECT id, odoo_attachment_id, odoo_model, odoo_record_id,
               ff_entity_type, ff_entity_id, file_name, sync_attempts
        FROM odoo_documents
        WHERE sync_status IN ('pending', 'failed')
        ORDER BY created_at
        LIMIT ${limit}
      ` as unknown as PendingDoc[];
    }

    logger.info(`Found ${pendingDocs.length} pending/failed attachments to process`);

    for (const doc of pendingDocs) {
      try {
        // Update status to downloading
        await sql`
          UPDATE odoo_documents
          SET sync_status = 'downloading',
              sync_attempts = ${doc.sync_attempts + 1},
              last_sync_attempt = NOW()
          WHERE id = ${doc.id}::uuid
        `;

        // Download from Odoo
        const downloadResult = await client.downloadAttachment(doc.odoo_attachment_id);
        if (!downloadResult) {
          await sql`
            UPDATE odoo_documents
            SET sync_status = 'failed',
                sync_error = 'Could not download from Odoo — attachment may have been deleted'
            WHERE id = ${doc.id}::uuid
          `;
          result.errors.push(`${doc.file_name}: Could not download from Odoo`);
          result.details.push({
            odooId: doc.odoo_attachment_id,
            name: doc.file_name,
            model: doc.odoo_model,
            action: 'error',
            message: 'Download failed',
          });
          continue;
        }

        // Update status to uploading
        await sql`
          UPDATE odoo_documents SET sync_status = 'uploading' WHERE id = ${doc.id}::uuid
        `;

        // Determine storage path
        const isOrphan = !doc.ff_entity_id;
        const storagePath = getStoragePath(doc.odoo_model, doc.ff_entity_id, isOrphan);

        const timestamp = Date.now();
        const safeFilename = downloadResult.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueFilename = `${doc.odoo_attachment_id}_${timestamp}_${safeFilename}`;

        // Upload to VF Storage
        const uploadResult = await storage.uploadFile(
          downloadResult.buffer,
          storagePath.type,
          storagePath.category,
          uniqueFilename
        );

        if (!uploadResult.success) {
          await sql`
            UPDATE odoo_documents
            SET sync_status = 'failed',
                sync_error = 'Upload to VF Storage failed'
            WHERE id = ${doc.id}::uuid
          `;
          result.errors.push(`${doc.file_name}: Upload to VF Storage failed`);
          result.details.push({
            odooId: doc.odoo_attachment_id,
            name: doc.file_name,
            model: doc.odoo_model,
            action: 'error',
            message: 'Upload failed',
          });
          continue;
        }

        // Detect document type
        const documentType = detectDocumentType(
          downloadResult.filename,
          downloadResult.mimetype
        );

        // Update record with file info
        await sql`
          UPDATE odoo_documents
          SET file_path = ${uploadResult.path},
              file_url = ${uploadResult.url},
              file_size = ${downloadResult.fileSize},
              mime_type = ${downloadResult.mimetype},
              document_type = ${documentType},
              sync_status = ${isOrphan ? 'orphaned' : 'synced'},
              sync_error = NULL
          WHERE id = ${doc.id}::uuid
        `;

        if (isOrphan) {
          result.orphaned++;
        } else {
          result.synced++;
        }

        result.details.push({
          odooId: doc.odoo_attachment_id,
          name: doc.file_name,
          model: doc.odoo_model,
          action: isOrphan ? 'orphaned' : 'synced',
          ffEntityType: doc.ff_entity_type || undefined,
          ffEntityId: doc.ff_entity_id || undefined,
          message: isOrphan
            ? `Stored as orphan: ${uploadResult.path}`
            : `Linked to ${doc.ff_entity_type}:${doc.ff_entity_id}`,
        });

        logger.debug(`Processed pending attachment: ${doc.file_name}`, {
          odooId: doc.odoo_attachment_id,
          status: isOrphan ? 'orphaned' : 'synced',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Mark as failed
        try {
          await sql`
            UPDATE odoo_documents
            SET sync_status = 'failed',
                sync_error = ${message}
            WHERE id = ${doc.id}::uuid
          `;
        } catch {
          logger.error('Could not update failed status', { docId: doc.id });
        }
        result.errors.push(`${doc.file_name}: ${message}`);
        result.details.push({
          odooId: doc.odoo_attachment_id,
          name: doc.file_name,
          model: doc.odoo_model,
          action: 'error',
          message,
        });
        logger.error(`Error processing pending attachment ${doc.file_name}`, { error: message });
      }
    }

    // Record in sync history
    try {
      await sql`
        INSERT INTO odoo_sync_history (
          entity_type, sync_type, records_processed, records_created,
          records_updated, records_failed, status, error_details, completed_at
        ) VALUES (
          'attachment', 'process_pending', ${pendingDocs.length}, 0,
          ${result.synced + result.orphaned}, ${result.errors.length},
          ${result.errors.length > 0 ? 'completed_with_errors' : 'completed'},
          ${result.errors.length > 0 ? JSON.stringify(result.errors) : null},
          CURRENT_TIMESTAMP
        )
      `;
    } catch {
      logger.debug('Could not record sync history — table may not exist');
    }

    logger.info('Pending attachment processing completed', {
      synced: result.synced,
      orphaned: result.orphaned,
      errors: result.errors.length,
      total: pendingDocs.length,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Pending attachment processing failed', { error: message });
    result.errors.push(`Processing failed: ${message}`);
    return result;
  }
}

/**
 * Sync attachments for a specific FF entity
 */
export async function syncAttachmentsForEntity(
  client: OdooClient,
  databaseUrl: string,
  ffEntityType: string,
  ffEntityId: string
): Promise<AttachmentSyncResult> {
  const sql = neon(databaseUrl);
  const storage = new VFStorageService();

  const result: AttachmentSyncResult = {
    synced: 0,
    orphaned: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  try {
    // Find the mapping configuration
    const mapping = ENTITY_MAPPINGS.find((m) => m.ffEntityType === ffEntityType);
    if (!mapping) {
      result.errors.push(`Unknown entity type: ${ffEntityType}`);
      return result;
    }

    // Get the Odoo ID for this entity
    const query = `
      SELECT ${mapping.odooIdColumn} as odoo_id
      FROM ${mapping.ffTable}
      WHERE ${mapping.idColumn} = $1
    `;
    const rows = await sql.unsafe(query, [ffEntityId]) as Array<{ odoo_id: number | null }>;

    if (rows.length === 0 || !rows[0].odoo_id) {
      result.errors.push(`Entity ${ffEntityType}:${ffEntityId} has no Odoo mapping`);
      return result;
    }

    const odooRecordId = rows[0].odoo_id;

    // Fetch attachments for this specific record
    const attachments = await client.getAttachments({
      resModel: mapping.odooModel,
      resId: odooRecordId,
    });

    logger.info(`Found ${attachments.length} attachments for ${ffEntityType}:${ffEntityId}`);

    // Check storage health
    const storageHealthy = await storage.checkHealth();
    if (!storageHealthy) {
      throw new Error('VF Storage service is not available');
    }

    // Process each attachment
    for (const attachment of attachments) {
      try {
        // Check if already synced
        const existing = await sql<{ id: string }[]>`
          SELECT id FROM odoo_documents WHERE odoo_attachment_id = ${attachment.id}
        `;

        if (existing.length > 0) {
          result.skipped++;
          result.details.push({
            odooId: attachment.id,
            name: attachment.name,
            model: attachment.res_model,
            action: 'skipped',
            message: 'Already synced',
          });
          continue;
        }

        // Download attachment
        const downloadResult = await client.downloadAttachment(attachment.id);
        if (!downloadResult) {
          result.errors.push(`${attachment.name}: Could not download`);
          result.details.push({
            odooId: attachment.id,
            name: attachment.name,
            model: attachment.res_model,
            action: 'error',
            message: 'Download failed',
          });
          continue;
        }

        // Upload to VF Storage
        const storagePath = getStoragePath(mapping.odooModel, ffEntityId, false);
        const timestamp = Date.now();
        const safeFilename = downloadResult.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueFilename = `${attachment.id}_${timestamp}_${safeFilename}`;

        const uploadResult = await storage.uploadFile(
          downloadResult.buffer,
          storagePath.type,
          storagePath.category,
          uniqueFilename
        );

        if (!uploadResult.success) {
          result.errors.push(`${attachment.name}: Upload failed`);
          result.details.push({
            odooId: attachment.id,
            name: attachment.name,
            model: attachment.res_model,
            action: 'error',
            message: 'Upload failed',
          });
          continue;
        }

        // Detect document type
        const documentType = detectDocumentType(
          attachment.name,
          downloadResult.mimetype
        );

        // Insert record
        await sql`
          INSERT INTO odoo_documents (
            odoo_attachment_id,
            odoo_model,
            odoo_record_id,
            ff_entity_type,
            ff_entity_id,
            document_type,
            file_name,
            file_path,
            file_url,
            file_size,
            mime_type,
            sync_status,
            odoo_create_date
          ) VALUES (
            ${attachment.id},
            ${attachment.res_model},
            ${attachment.res_id},
            ${ffEntityType},
            ${ffEntityId},
            ${documentType},
            ${downloadResult.filename},
            ${uploadResult.path},
            ${uploadResult.url},
            ${downloadResult.fileSize},
            ${downloadResult.mimetype},
            'synced',
            ${attachment.create_date ? new Date(attachment.create_date) : null}
          )
        `;

        result.synced++;
        result.details.push({
          odooId: attachment.id,
          name: attachment.name,
          model: attachment.res_model,
          action: 'synced',
          ffEntityType,
          ffEntityId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`${attachment.name}: ${message}`);
        result.details.push({
          odooId: attachment.id,
          name: attachment.name,
          model: attachment.res_model,
          action: 'error',
          message,
        });
      }
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Entity attachment sync failed', { error: message });
    result.errors.push(`Sync failed: ${message}`);
    return result;
  }
}

/**
 * Get orphaned documents that need manual linking
 */
export async function getOrphanedDocuments(
  databaseUrl: string,
  options?: { model?: string; limit?: number }
): Promise<
  Array<{
    id: string;
    odooAttachmentId: number;
    odooModel: string;
    odooRecordId: number;
    fileName: string;
    filePath: string;
    documentType: string;
    createdAt: Date;
  }>
> {
  const sql = neon(databaseUrl);

  const rows = await sql<
    Array<{
      id: string;
      odoo_attachment_id: number;
      odoo_model: string;
      odoo_record_id: number;
      file_name: string;
      file_path: string;
      document_type: string;
      created_at: Date;
    }>
  >`
    SELECT
      id,
      odoo_attachment_id,
      odoo_model,
      odoo_record_id,
      file_name,
      file_path,
      document_type,
      created_at
    FROM odoo_documents
    WHERE sync_status = 'orphaned'
    ${options?.model ? sql`AND odoo_model = ${options.model}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${options?.limit || 100}
  `;

  return rows.map((row) => ({
    id: row.id,
    odooAttachmentId: row.odoo_attachment_id,
    odooModel: row.odoo_model,
    odooRecordId: row.odoo_record_id,
    fileName: row.file_name,
    filePath: row.file_path,
    documentType: row.document_type,
    createdAt: row.created_at,
  }));
}

/**
 * Manually link an orphaned document to an FF entity
 */
export async function linkOrphanedDocument(
  databaseUrl: string,
  documentId: string,
  ffEntityType: string,
  ffEntityId: string
): Promise<{ success: boolean; message: string }> {
  const sql = neon(databaseUrl);

  try {
    const result = await sql`
      UPDATE odoo_documents
      SET
        ff_entity_type = ${ffEntityType},
        ff_entity_id = ${ffEntityId},
        sync_status = 'synced',
        updated_at = NOW()
      WHERE id = ${documentId}
        AND sync_status = 'orphaned'
      RETURNING id
    `;

    if (result.length === 0) {
      return { success: false, message: 'Document not found or not orphaned' };
    }

    return { success: true, message: 'Document linked successfully' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message };
  }
}

/**
 * Get attachment sync statistics
 */
export async function getAttachmentSyncStats(
  databaseUrl: string
): Promise<{
  total: number;
  synced: number;
  orphaned: number;
  failed: number;
  byModel: Array<{ model: string; count: number }>;
  byEntityType: Array<{ entityType: string; count: number }>;
}> {
  const sql = neon(databaseUrl);

  const [totals, byModel, byEntity] = await Promise.all([
    sql<
      Array<{
        total: string;
        synced: string;
        orphaned: string;
        failed: string;
      }>
    >`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sync_status = 'synced') as synced,
        COUNT(*) FILTER (WHERE sync_status = 'orphaned') as orphaned,
        COUNT(*) FILTER (WHERE sync_status = 'failed') as failed
      FROM odoo_documents
    `,
    sql<Array<{ model: string; count: string }>>`
      SELECT odoo_model as model, COUNT(*) as count
      FROM odoo_documents
      GROUP BY odoo_model
      ORDER BY count DESC
    `,
    sql<Array<{ entity_type: string; count: string }>>`
      SELECT ff_entity_type as entity_type, COUNT(*) as count
      FROM odoo_documents
      WHERE ff_entity_type IS NOT NULL
      GROUP BY ff_entity_type
      ORDER BY count DESC
    `,
  ]);

  const stats = totals[0] || { total: '0', synced: '0', orphaned: '0', failed: '0' };

  return {
    total: parseInt(stats.total, 10),
    synced: parseInt(stats.synced, 10),
    orphaned: parseInt(stats.orphaned, 10),
    failed: parseInt(stats.failed, 10),
    byModel: byModel.map((m) => ({ model: m.model, count: parseInt(m.count, 10) })),
    byEntityType: byEntity.map((e) => ({
      entityType: e.entity_type,
      count: parseInt(e.count, 10),
    })),
  };
}
