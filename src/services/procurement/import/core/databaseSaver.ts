/**
 * BOQ Import Database Saver
 * Handles saving BOQ data to Neon database
 * UPDATED: Real database operations
 */

import { neon } from '@neondatabase/serverless';
import { ProcurementContext } from '../../../../types/procurement/base.types';
import { ImportConfig, MappingResults, SaveResult } from './types';
import { log } from '../../../../lib/logger';
import { sanitizeText } from '@/lib/security/sanitization';

// Initialize Neon client
const sql = neon(process.env.DATABASE_URL!);

export class BOQImportDatabaseSaver {
  /**
   * Save BOQ data to Neon database
   */
  async saveBOQData(
    mappingResults: MappingResults,
    context: ProcurementContext,
    config: ImportConfig
  ): Promise<SaveResult> {
    try {
      // Create BOQ record
      const boqId = await this.createBOQRecord(context, mappingResults);

      // Save mapped items
      const itemsCreated = await this.saveMappedItems(boqId, mappingResults.mapped, config, context);

      // Save exceptions
      const exceptionsCreated = await this.saveExceptions(boqId, mappingResults.exceptions, context);

      // Update BOQ with final counts
      await this.updateBOQCounts(boqId, itemsCreated, exceptionsCreated);

      return {
        boqId,
        itemsCreated,
        exceptionsCreated,
      };
    } catch (error) {
      log.error('Error saving BOQ data:', { data: error }, 'databaseSaver');
      throw new Error(
        `Database save failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Create BOQ record in database
   */
  private async createBOQRecord(
    context: ProcurementContext,
    mappingResults: MappingResults
  ): Promise<string> {
    const totalItems = mappingResults.mapped.length + mappingResults.exceptions.length;
    const mappedItems = mappingResults.mapped.length;
    const unmappedItems = mappingResults.exceptions.length;

    // Calculate total estimated value
    const totalValue = mappingResults.mapped.reduce((sum, item) => {
      const itemTotal =
        item.unitPrice && item.quantity ? item.quantity * item.unitPrice : item.totalPrice || 0;
      return sum + itemTotal;
    }, 0);

    // Calculate average mapping confidence
    const avgConfidence =
      mappingResults.mapped.length > 0
        ? mappingResults.mapped.reduce((sum, item) => sum + (item.catalogMatch?.confidence || 0), 0) /
          mappingResults.mapped.length
        : 0;

    const result = await sql`
      INSERT INTO boqs (
        project_id,
        title,
        description,
        status,
        mapping_status,
        mapping_confidence,
        item_count,
        mapped_items,
        unmapped_items,
        exceptions_count,
        total_estimated_value,
        currency,
        import_source,
        created_at,
        updated_at
      ) VALUES (
        ${context.projectId || null},
        ${`BOQ Import - ${new Date().toISOString().split('T')[0]}`},
        ${'Imported via BOQ Import Tool'},
        ${'draft'},
        ${unmappedItems > 0 ? 'partial' : 'complete'},
        ${Math.round(avgConfidence * 100)},
        ${totalItems},
        ${mappedItems},
        ${unmappedItems},
        ${unmappedItems},
        ${totalValue},
        ${(context.metadata?.currency as string) || 'ZAR'},
        ${'excel_import'},
        ${new Date().toISOString()},
        ${new Date().toISOString()}
      )
      RETURNING id
    `;

    return result[0].id;
  }

  /**
   * Save mapped BOQ items to database
   */
  private async saveMappedItems(
    boqId: string,
    mappedItems: MappingResults['mapped'],
    config: ImportConfig,
    context: ProcurementContext
  ): Promise<number> {
    let itemsCreated = 0;

    for (let i = 0; i < mappedItems.length; i++) {
      const item = mappedItems[i];

      try {
        // Handle duplicate checking based on config
        if (config.duplicateHandling === 'skip') {
          const exists = await this.checkItemExists(boqId, item);
          if (exists) {
            continue;
          }
        }

        await this.saveItem(boqId, item, i + 1, context);
        itemsCreated++;
      } catch (error) {
        log.warn(`Failed to save item: ${item.description}`, { data: error }, 'databaseSaver');
      }
    }

    return itemsCreated;
  }

  /**
   * Save mapping exceptions to database
   */
  private async saveExceptions(
    boqId: string,
    exceptions: MappingResults['exceptions'],
    context: ProcurementContext
  ): Promise<number> {
    let exceptionsCreated = 0;

    for (const exception of exceptions) {
      try {
        await this.saveException(boqId, exception, context);
        exceptionsCreated++;
      } catch (error) {
        log.warn(
          `Failed to save exception: ${exception.exception.id}`,
          { data: error },
          'databaseSaver'
        );
      }
    }

    return exceptionsCreated;
  }

  /**
   * Check if BOQ item already exists (by item_code within same BOQ)
   */
  private async checkItemExists(boqId: string, item: MappingResults['mapped'][0]): Promise<boolean> {
    if (!item.itemCode) return false;

    const result = await sql`
      SELECT EXISTS (
        SELECT 1 FROM boq_items
        WHERE boq_id = ${boqId}::uuid
        AND item_code = ${item.itemCode}
      ) as exists
    `;

    return result[0]?.exists || false;
  }

  /**
   * Save individual BOQ item
   */
  private async saveItem(
    boqId: string,
    item: MappingResults['mapped'][0],
    lineNumber: number,
    context: ProcurementContext
  ): Promise<void> {
    const totalPrice = item.unitPrice && item.quantity ? item.quantity * item.unitPrice : null;

    await sql`
      INSERT INTO boq_items (
        boq_id,
        project_id,
        line_number,
        item_code,
        description,
        category,
        quantity,
        uom,
        unit_price,
        total_price,
        catalog_item_id,
        catalog_item_code,
        catalog_item_name,
        mapping_confidence,
        mapping_status,
        specifications,
        procurement_status,
        created_at,
        updated_at
      ) VALUES (
        ${boqId}::uuid,
        ${context.projectId || null},
        ${lineNumber},
        ${item.itemCode ? sanitizeText(item.itemCode) : null},
        ${sanitizeText(item.description || 'No description')},
        ${item.category ? sanitizeText(item.category) : null},
        ${item.quantity || 0},
        ${item.uom || 'each'},
        ${item.unitPrice || null},
        ${totalPrice},
        ${item.catalogMatch?.catalogItem?.id || null},
        ${item.catalogMatch?.catalogItem?.code || null},
        ${item.catalogMatch?.catalogItem?.description || null},
        ${item.catalogMatch?.confidence ? Math.round(item.catalogMatch.confidence * 100) : null},
        ${item.catalogMatch ? 'mapped' : 'unmapped'},
        ${item.remarks ? JSON.stringify({ notes: item.remarks }) : null},
        ${'pending'},
        ${new Date().toISOString()},
        ${new Date().toISOString()}
      )
    `;
  }

  /**
   * Save mapping exception
   */
  private async saveException(
    boqId: string,
    exceptionItem: MappingResults['exceptions'][0],
    context: ProcurementContext
  ): Promise<void> {
    const { exception, ...itemData } = exceptionItem;

    await sql`
      INSERT INTO boq_import_exceptions (
        boq_id,
        project_id,
        line_number,
        item_code,
        description,
        quantity,
        uom,
        unit_price,
        category,
        exception_type,
        exception_message,
        suggestions,
        status,
        priority,
        created_at,
        updated_at
      ) VALUES (
        ${boqId}::uuid,
        ${context.projectId || null},
        ${itemData.lineNumber || null},
        ${itemData.itemCode ? sanitizeText(itemData.itemCode) : null},
        ${sanitizeText(itemData.description || 'No description')},
        ${itemData.quantity || null},
        ${itemData.uom || null},
        ${itemData.unitPrice || null},
        ${itemData.category ? sanitizeText(itemData.category) : null},
        ${'no_match'},
        ${'No catalog match found for this item'},
        ${exception.suggestions ? JSON.stringify(exception.suggestions) : '[]'},
        ${exception.status || 'pending'},
        ${exception.priority || 'medium'},
        ${new Date().toISOString()},
        ${new Date().toISOString()}
      )
    `;
  }

  /**
   * Update BOQ with final counts after import
   */
  private async updateBOQCounts(
    boqId: string,
    itemsCreated: number,
    exceptionsCreated: number
  ): Promise<void> {
    await sql`
      UPDATE boqs
      SET
        item_count = ${itemsCreated + exceptionsCreated},
        mapped_items = ${itemsCreated},
        unmapped_items = ${exceptionsCreated},
        exceptions_count = ${exceptionsCreated},
        mapping_status = ${exceptionsCreated > 0 ? 'partial' : 'complete'},
        updated_at = ${new Date().toISOString()}
      WHERE id = ${boqId}::uuid
    `;
  }

  /**
   * Update BOQ status after save completion
   */
  async updateBOQStatus(
    boqId: string,
    status: 'draft' | 'processing' | 'completed' | 'failed'
  ): Promise<void> {
    await sql`
      UPDATE boqs
      SET
        status = ${status},
        updated_at = ${new Date().toISOString()}
      WHERE id = ${boqId}::uuid
    `;
  }

  /**
   * Get BOQ save statistics
   */
  async getSaveStatistics(boqId: string): Promise<{
    totalItems: number;
    savedItems: number;
    failedItems: number;
    totalExceptions: number;
    savedExceptions: number;
  }> {
    // Get BOQ details
    const boqResult = await sql`
      SELECT item_count, mapped_items, unmapped_items, exceptions_count
      FROM boqs
      WHERE id = ${boqId}::uuid
    `;

    if (!boqResult[0]) {
      return {
        totalItems: 0,
        savedItems: 0,
        failedItems: 0,
        totalExceptions: 0,
        savedExceptions: 0,
      };
    }

    const boq = boqResult[0];

    // Count actual saved items
    const itemCountResult = await sql`
      SELECT COUNT(*) as count FROM boq_items WHERE boq_id = ${boqId}::uuid
    `;

    // Count actual saved exceptions
    const exceptionCountResult = await sql`
      SELECT COUNT(*) as count FROM boq_import_exceptions WHERE boq_id = ${boqId}::uuid
    `;

    const savedItems = parseInt(itemCountResult[0]?.count) || 0;
    const savedExceptions = parseInt(exceptionCountResult[0]?.count) || 0;

    return {
      totalItems: parseInt(boq.item_count) || 0,
      savedItems,
      failedItems: (parseInt(boq.mapped_items) || 0) - savedItems,
      totalExceptions: parseInt(boq.exceptions_count) || 0,
      savedExceptions,
    };
  }

  /**
   * Get pending exceptions for a BOQ
   */
  async getPendingExceptions(boqId: string): Promise<
    Array<{
      id: string;
      itemCode: string | null;
      description: string;
      exceptionType: string;
      suggestions: unknown[];
      priority: string;
    }>
  > {
    const result = await sql`
      SELECT id, item_code, description, exception_type, suggestions, priority
      FROM boq_import_exceptions
      WHERE boq_id = ${boqId}::uuid
      AND status = 'pending'
      ORDER BY priority DESC, created_at ASC
    `;

    return result.map((row) => ({
      id: row.id,
      itemCode: row.item_code,
      description: row.description,
      exceptionType: row.exception_type,
      suggestions: row.suggestions || [],
      priority: row.priority,
    }));
  }

  /**
   * Resolve an exception by creating a new BOQ item
   */
  async resolveException(
    exceptionId: string,
    resolution: {
      catalogItemId?: string;
      customItemData?: {
        itemCode: string;
        description: string;
        category: string;
        uom: string;
        unitPrice: number;
      };
      notes?: string;
      resolvedBy: string;
    }
  ): Promise<string | null> {
    // Get the exception
    const exceptionResult = await sql`
      SELECT * FROM boq_import_exceptions WHERE id = ${exceptionId}::uuid
    `;

    if (!exceptionResult[0]) {
      throw new Error('Exception not found');
    }

    const exception = exceptionResult[0];

    // Create the BOQ item
    const itemResult = await sql`
      INSERT INTO boq_items (
        boq_id,
        project_id,
        item_code,
        description,
        category,
        quantity,
        uom,
        unit_price,
        total_price,
        catalog_item_id,
        mapping_status,
        procurement_status,
        created_at,
        updated_at
      ) VALUES (
        ${exception.boq_id}::uuid,
        ${exception.project_id},
        ${sanitizeText(resolution.customItemData?.itemCode || exception.item_code || '')},
        ${sanitizeText(resolution.customItemData?.description || exception.description || '')},
        ${sanitizeText(resolution.customItemData?.category || exception.category || '')},
        ${exception.quantity},
        ${resolution.customItemData?.uom || exception.uom},
        ${resolution.customItemData?.unitPrice || exception.unit_price},
        ${exception.quantity && (resolution.customItemData?.unitPrice || exception.unit_price) ? exception.quantity * (resolution.customItemData?.unitPrice || exception.unit_price) : null},
        ${resolution.catalogItemId || null},
        ${'manual'},
        ${'pending'},
        ${new Date().toISOString()},
        ${new Date().toISOString()}
      )
      RETURNING id
    `;

    const newItemId = itemResult[0]?.id;

    // Update the exception as resolved
    await sql`
      UPDATE boq_import_exceptions
      SET
        status = 'resolved',
        resolved_by = ${resolution.resolvedBy},
        resolved_at = ${new Date().toISOString()},
        resolution_notes = ${resolution.notes || null},
        resolved_item_id = ${newItemId}::uuid,
        updated_at = ${new Date().toISOString()}
      WHERE id = ${exceptionId}::uuid
    `;

    // Update BOQ counts
    await sql`
      UPDATE boqs
      SET
        mapped_items = mapped_items + 1,
        unmapped_items = GREATEST(unmapped_items - 1, 0),
        updated_at = ${new Date().toISOString()}
      WHERE id = ${exception.boq_id}::uuid
    `;

    return newItemId || null;
  }
}
