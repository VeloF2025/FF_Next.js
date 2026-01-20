/**
 * BOQ CRUD Operations
 * Basic create, read, update, delete operations for BOQs
 * Migrated from Firebase to Neon PostgreSQL
 */

import { neon } from '@neondatabase/serverless';
import { BOQ, BOQFormData, BOQStatusType } from '@/types/procurement/boq.types';
import { log } from '@/lib/logger';

// Initialize Neon connection
const sql = neon(process.env.DATABASE_URL!);

/**
 * BOQ CRUD operations
 */
export class BOQCrud {
  /**
   * Get all BOQs with optional filtering
   */
  static async getAll(filter?: { projectId?: string; status?: BOQStatusType }): Promise<BOQ[]> {
    try {
      const conditions = [];
      const params: any[] = [];
      let paramCount = 1;

      if (filter?.projectId) {
        conditions.push(`project_id = $${paramCount}`);
        params.push(filter.projectId);
        paramCount++;
      }
      if (filter?.status) {
        conditions.push(`status = $${paramCount}`);
        params.push(filter.status);
        paramCount++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      const result = await sql(
        `SELECT 
          b.*,
          COUNT(DISTINCT bi.id) as actual_item_count,
          SUM(bi.amount) as calculated_total
        FROM boqs b
        LEFT JOIN boq_items bi ON b.id = bi.boq_id
        ${whereClause}
        GROUP BY b.id
        ORDER BY b.created_at DESC`,
        params
      );

      return result.map(row => ({
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        title: row.name,
        description: row.description,
        status: row.status as BOQStatusType,
        version: row.version,
        uploadedBy: row.uploaded_by,
        itemCount: parseInt(row.actual_item_count) || row.item_count || 0,
        mappedItems: row.mapped_items || 0,
        unmappedItems: row.unmapped_items || 0,
        exceptionsCount: row.exceptions_count || 0,
        totalEstimatedValue: parseFloat(row.calculated_total) || row.total_estimated_value || 0,
        currency: row.currency || 'ZAR',
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        rejectedBy: row.rejected_by,
        rejectedAt: row.rejected_at,
        rejectionReason: row.rejection_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        uploadedAt: row.uploaded_at
      } as BOQ));
    } catch (error) {
      log.error('Error fetching BOQs:', { data: error }, 'boqCrud');
      throw error;
    }
  }

  /**
   * Get BOQ by ID
   */
  static async getById(id: string): Promise<BOQ> {
    try {
      const result = await sql`
        SELECT 
          b.*,
          COUNT(DISTINCT bi.id) as actual_item_count,
          SUM(bi.amount) as calculated_total,
          json_agg(DISTINCT bi.*) FILTER (WHERE bi.id IS NOT NULL) as items
        FROM boqs b
        LEFT JOIN boq_items bi ON b.id = bi.boq_id
        WHERE b.id = ${id}
        GROUP BY b.id`;
      
      if (result.length === 0) {
        throw new Error('BOQ not found');
      }
      
      const row = result[0];
      return {
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        title: row.name,
        description: row.description,
        status: row.status as BOQStatusType,
        version: row.version,
        uploadedBy: row.uploaded_by,
        items: row.items || [],
        itemCount: parseInt(row.actual_item_count) || row.item_count || 0,
        mappedItems: row.mapped_items || 0,
        unmappedItems: row.unmapped_items || 0,
        exceptionsCount: row.exceptions_count || 0,
        totalEstimatedValue: parseFloat(row.calculated_total) || row.total_estimated_value || 0,
        currency: row.currency || 'ZAR',
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        rejectedBy: row.rejected_by,
        rejectedAt: row.rejected_at,
        rejectionReason: row.rejection_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        uploadedAt: row.uploaded_at
      } as BOQ;
    } catch (error) {
      log.error('Error fetching BOQ:', { data: error }, 'boqCrud');
      throw error;
    }
  }

  /**
   * Create new BOQ
   */
  static async create(data: BOQFormData): Promise<string> {
    try {
      const result = await sql`
        INSERT INTO boqs (
          project_id,
          name,
          description,
          status,
          version,
          uploaded_by,
          item_count,
          mapped_items,
          unmapped_items,
          exceptions_count,
          total_estimated_value,
          currency,
          uploaded_at
        ) VALUES (
          ${data.projectId},
          ${data.title || 'Untitled BOQ'},
          ${data.description || ''},
          ${'draft'},
          ${data.version || 1},
          ${data.uploadedBy || 'system'},
          ${0},
          ${0},
          ${0},
          ${0},
          ${data.totalEstimatedValue || 0},
          ${data.currency || 'ZAR'},
          ${new Date().toISOString()}
        )
        RETURNING id`;
      
      // Add BOQ items if provided
      if (data.items && data.items.length > 0) {
        for (let i = 0; i < data.items.length; i++) {
          const item = data.items[i];
          await sql`
            INSERT INTO boq_items (
              boq_id,
              project_id,
              item_number,
              description,
              unit,
              quantity,
              rate,
              amount,
              category,
              sequence_number
            ) VALUES (
              ${result[0].id},
              ${data.projectId},
              ${item.itemNumber || (i + 1).toString()},
              ${item.description},
              ${item.unit || 'EA'},
              ${item.quantity || 0},
              ${item.rate || 0},
              ${(item.quantity || 0) * (item.rate || 0)},
              ${item.category || ''},
              ${i + 1}
            )`;
        }
        
        // Update item count
        await sql`
          UPDATE boqs 
          SET item_count = ${data.items.length},
              total_estimated_value = (
                SELECT SUM(amount) FROM boq_items WHERE boq_id = ${result[0].id}
              )
          WHERE id = ${result[0].id}`;
      }
      
      return result[0].id;
    } catch (error) {
      log.error('Error creating BOQ:', { data: error }, 'boqCrud');
      throw error;
    }
  }

  /**
   * Update existing BOQ
   */
  static async update(id: string, data: Partial<BOQFormData>): Promise<void> {
    try {
      const updateFields = [];
      const params = [];
      let paramCount = 1;
      
      if (data.title !== undefined) {
        updateFields.push(`name = $${paramCount}`);
        params.push(data.title);
        paramCount++;
      }
      if (data.description !== undefined) {
        updateFields.push(`description = $${paramCount}`);
        params.push(data.description);
        paramCount++;
      }
      if (data.status !== undefined) {
        updateFields.push(`status = $${paramCount}`);
        params.push(data.status);
        paramCount++;
      }
      if (data.version !== undefined) {
        updateFields.push(`version = $${paramCount}`);
        params.push(data.version);
        paramCount++;
      }
      if (data.totalEstimatedValue !== undefined) {
        updateFields.push(`total_estimated_value = $${paramCount}`);
        params.push(data.totalEstimatedValue);
        paramCount++;
      }
      
      updateFields.push(`updated_at = $${paramCount}`);
      params.push(new Date().toISOString());
      paramCount++;
      
      params.push(id);
      
      await sql(
        `UPDATE boqs SET ${updateFields.join(', ')} WHERE id = $${paramCount}`,
        params
      );
    } catch (error) {
      log.error('Error updating BOQ:', { data: error }, 'boqCrud');
      throw error;
    }
  }

  /**
   * Delete BOQ
   */
  static async delete(id: string): Promise<void> {
    try {
      await sql`DELETE FROM boqs WHERE id = ${id}`;
    } catch (error) {
      log.error('Error deleting BOQ:', { data: error }, 'boqCrud');
      throw error;
    }
  }

  /**
   * Update BOQ status
   */
  static async updateStatus(id: string, status: BOQStatusType, userId?: string): Promise<void> {
    try {
      const updateFields = [`status = $1`, `updated_at = $2`];
      const params = [status, new Date().toISOString()];
      
      if (status === 'approved') {
        updateFields.push(`approved_at = $3`, `approved_by = $4`);
        params.push(new Date().toISOString(), userId || 'system');
      } else if (status === 'archived') {
        updateFields.push(`rejected_at = $3`, `rejected_by = $4`);
        params.push(new Date().toISOString(), userId || 'system');
      }
      
      params.push(id);
      
      await sql(
        `UPDATE boqs SET ${updateFields.join(', ')} WHERE id = $${params.length}`,
        params
      );
    } catch (error) {
      log.error('Error updating BOQ status:', { data: error }, 'boqCrud');
      throw error;
    }
  }

  /**
   * Get BOQs by project
   */
  static async getByProject(projectId: string): Promise<BOQ[]> {
    return this.getAll({ projectId });
  }

  /**
   * Get BOQs by status
   */
  static async getByStatus(status: BOQStatusType): Promise<BOQ[]> {
    return this.getAll({ status });
  }

  /**
   * Check if BOQ exists
   */
  static async exists(id: string): Promise<boolean> {
    try {
      const result = await sql`
        SELECT EXISTS(
          SELECT 1 FROM boqs WHERE id = ${id}
        ) as exists`;
      return result[0].exists;
    } catch (error) {
      log.error('Error checking BOQ existence:', { data: error }, 'boqCrud');
      return false;
    }
  }

  /**
   * Add BOQ items
   */
  static async addItems(boqId: string, projectId: string, items: any[]): Promise<void> {
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await sql`
          INSERT INTO boq_items (
            boq_id,
            project_id,
            item_number,
            description,
            unit,
            quantity,
            rate,
            amount,
            category,
            material_code,
            sequence_number
          ) VALUES (
            ${boqId},
            ${projectId},
            ${item.itemNumber || (i + 1).toString()},
            ${item.description},
            ${item.unit || 'EA'},
            ${item.quantity || 0},
            ${item.rate || 0},
            ${(item.quantity || 0) * (item.rate || 0)},
            ${item.category || ''},
            ${item.materialCode || ''},
            ${i + 1}
          )`;
      }
      
      // Update counts and totals
      await sql`
        UPDATE boqs 
        SET 
          item_count = (SELECT COUNT(*) FROM boq_items WHERE boq_id = ${boqId}),
          total_estimated_value = (SELECT SUM(amount) FROM boq_items WHERE boq_id = ${boqId}),
          updated_at = ${new Date().toISOString()}
        WHERE id = ${boqId}`;
    } catch (error) {
      log.error('Error adding BOQ items:', { data: error }, 'boqCrud');
      throw error;
    }
  }

  /**
   * Get BOQ items
   */
  static async getItems(boqId: string): Promise<any[]> {
    try {
      const result = await sql`
        SELECT * FROM boq_items 
        WHERE boq_id = ${boqId}
        ORDER BY sequence_number, item_number`;
      
      return result.map(item => ({
        id: item.id,
        boqId: item.boq_id,
        projectId: item.project_id,
        itemNumber: item.item_number,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
        category: item.category,
        materialCode: item.material_code,
        isMapped: item.is_mapped,
        mappedMaterialId: item.mapped_material_id,
        mappingConfidence: item.mapping_confidence
      }));
    } catch (error) {
      log.error('Error fetching BOQ items:', { data: error }, 'boqCrud');
      throw error;
    }
  }

  /**
   * Link BOQ to RFQ
   */
  static async linkToRFQ(boqId: string, rfqId: string, linkType: string = 'full'): Promise<void> {
    try {
      await sql`
        INSERT INTO boq_rfq_links (
          boq_id,
          rfq_id,
          link_type,
          created_by
        ) VALUES (
          ${boqId},
          ${rfqId},
          ${linkType},
          ${'system'}
        )
        ON CONFLICT (boq_id, rfq_id) 
        DO UPDATE SET link_type = ${linkType}`;
    } catch (error) {
      log.error('Error linking BOQ to RFQ:', { data: error }, 'boqCrud');
      throw error;
    }
  }
}