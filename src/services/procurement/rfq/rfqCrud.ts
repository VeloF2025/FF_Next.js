/**
 * RFQ CRUD Operations
 * Basic create, read, update, delete operations for RFQs
 * Migrated from Firebase to Neon PostgreSQL
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { 
  RFQ, 
  RFQFormData, 
  RFQStatus
} from '@/types/procurement.types';

// Initialize Neon connection
const sql = neon(process.env.DATABASE_URL!);

/**
 * RFQ CRUD operations
 */
export class RFQCrud {
  /**
   * Get all RFQs with optional filtering
   */
  static async getAll(filter?: { 
    projectId?: string; 
    status?: RFQStatus; 
    supplierId?: string 
  }): Promise<RFQ[]> {
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
      if (filter?.supplierId) {
        conditions.push(`invited_suppliers::jsonb @> $${paramCount}::jsonb`);
        params.push(JSON.stringify([filter.supplierId]));
        paramCount++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      const result = await sql(
        `SELECT 
          r.*,
          COUNT(DISTINCT ri.id) as item_count,
          COUNT(DISTINCT rr.id) as response_count
        FROM rfqs r
        LEFT JOIN rfq_items ri ON r.id = ri.rfq_id
        LEFT JOIN rfq_responses rr ON r.id = rr.rfq_id
        ${whereClause}
        GROUP BY r.id
        ORDER BY r.created_at DESC`,
        params
      );

      return result.map(row => ({
        id: row.id,
        projectId: row.project_id,
        rfqNumber: row.rfq_number,
        title: row.title,
        description: row.description,
        status: row.status as RFQStatus,
        issueDate: row.issue_date,
        responseDeadline: row.response_deadline || row.closing_date,
        invitedSuppliers: row.invited_suppliers || [],
        itemCount: parseInt(row.item_count) || 0,
        responseCount: parseInt(row.response_count) || 0,
        paymentTerms: row.payment_terms,
        deliveryTerms: row.delivery_terms,
        validityPeriod: row.validity_period || 30,
        currency: row.currency || 'ZAR',
        technicalRequirements: row.technical_requirements,
        totalBudgetEstimate: row.total_budget_estimate,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      } as RFQ));
    } catch (error) {
      log.error('Error fetching RFQs:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Get RFQ by ID
   */
  static async getById(id: string): Promise<RFQ> {
    try {
      const result = await sql`
        SELECT 
          r.*,
          COUNT(DISTINCT ri.id) as item_count,
          COUNT(DISTINCT rr.id) as response_count,
          json_agg(DISTINCT ri.*) FILTER (WHERE ri.id IS NOT NULL) as items
        FROM rfqs r
        LEFT JOIN rfq_items ri ON r.id = ri.rfq_id
        LEFT JOIN rfq_responses rr ON r.id = rr.rfq_id
        WHERE r.id = ${id}
        GROUP BY r.id`;
      
      if (result.length === 0) {
        throw new Error('RFQ not found');
      }
      
      const row = result[0];
      return {
        id: row.id,
        projectId: row.project_id,
        rfqNumber: row.rfq_number,
        title: row.title,
        description: row.description,
        status: row.status as RFQStatus,
        issueDate: row.issue_date,
        responseDeadline: row.response_deadline || row.closing_date,
        invitedSuppliers: row.invited_suppliers || [],
        items: row.items || [],
        itemCount: parseInt(row.item_count) || 0,
        responseCount: parseInt(row.response_count) || 0,
        paymentTerms: row.payment_terms,
        deliveryTerms: row.delivery_terms,
        validityPeriod: row.validity_period || 30,
        currency: row.currency || 'ZAR',
        technicalRequirements: row.technical_requirements,
        totalBudgetEstimate: row.total_budget_estimate,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      } as RFQ;
    } catch (error) {
      log.error('Error fetching RFQ:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Create new RFQ
   */
  static async create(data: RFQFormData): Promise<string> {
    try {
      // Generate unique RFQ number
      const rfqNumber = `RFQ-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      
      const responseDeadline = data.responseDeadline ? 
        new Date(data.responseDeadline).toISOString() : 
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const result = await sql`
        INSERT INTO rfqs (
          project_id,
          rfq_number,
          title,
          description,
          status,
          issue_date,
          response_deadline,
          invited_suppliers,
          payment_terms,
          delivery_terms,
          validity_period,
          currency,
          technical_requirements,
          total_budget_estimate,
          created_by
        ) VALUES (
          ${data.projectId},
          ${rfqNumber},
          ${data.title},
          ${data.description || ''},
          ${RFQStatus.DRAFT},
          ${new Date().toISOString()},
          ${responseDeadline},
          ${JSON.stringify(data.supplierIds || [])},
          ${data.paymentTerms || ''},
          ${data.deliveryTerms || ''},
          ${data.validityPeriod || 30},
          ${data.currency || 'ZAR'},
          ${data.technicalRequirements || ''},
          ${data.totalBudgetEstimate || 0},
          ${data.createdBy || 'system'}
        )
        RETURNING id`;
      
      // Insert items if provided
      if (data.items && data.items.length > 0) {
        for (let i = 0; i < data.items.length; i++) {
          const item = data.items[i];
          await sql`
            INSERT INTO rfq_items (
              rfq_id,
              line_number,
              description,
              specifications,
              quantity,
              uom,
              category
            ) VALUES (
              ${result[0].id},
              ${i + 1},
              ${item.description},
              ${item.specifications || ''},
              ${item.quantity},
              ${item.unit || 'EA'},
              ${item.category || ''}
            )`;
        }
      }
      
      return result[0].id;
    } catch (error) {
      log.error('Error creating RFQ:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Update existing RFQ
   */
  static async update(id: string, data: Partial<RFQFormData>): Promise<void> {
    try {
      const updateFields = [];
      const params = [];
      let paramCount = 1;
      
      if (data.title !== undefined) {
        updateFields.push(`title = $${paramCount}`);
        params.push(data.title);
        paramCount++;
      }
      if (data.description !== undefined) {
        updateFields.push(`description = $${paramCount}`);
        params.push(data.description);
        paramCount++;
      }
      if (data.responseDeadline !== undefined) {
        updateFields.push(`response_deadline = $${paramCount}`);
        params.push(new Date(data.responseDeadline).toISOString());
        paramCount++;
      }
      if (data.supplierIds !== undefined) {
        updateFields.push(`invited_suppliers = $${paramCount}`);
        params.push(JSON.stringify(data.supplierIds));
        paramCount++;
      }
      if (data.paymentTerms !== undefined) {
        updateFields.push(`payment_terms = $${paramCount}`);
        params.push(data.paymentTerms);
        paramCount++;
      }
      if (data.deliveryTerms !== undefined) {
        updateFields.push(`delivery_terms = $${paramCount}`);
        params.push(data.deliveryTerms);
        paramCount++;
      }
      if (data.technicalRequirements !== undefined) {
        updateFields.push(`technical_requirements = $${paramCount}`);
        params.push(data.technicalRequirements);
        paramCount++;
      }
      if (data.totalBudgetEstimate !== undefined) {
        updateFields.push(`total_budget_estimate = $${paramCount}`);
        params.push(data.totalBudgetEstimate);
        paramCount++;
      }
      
      updateFields.push(`updated_at = $${paramCount}`);
      params.push(new Date().toISOString());
      paramCount++;
      
      params.push(id);
      
      await sql(
        `UPDATE rfqs SET ${updateFields.join(', ')} WHERE id = $${paramCount}`,
        params
      );
    } catch (error) {
      log.error('Error updating RFQ:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Delete RFQ
   */
  static async delete(id: string): Promise<void> {
    try {
      await sql`DELETE FROM rfqs WHERE id = ${id}`;
    } catch (error) {
      log.error('Error deleting RFQ:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Update RFQ status
   */
  static async updateStatus(id: string, status: RFQStatus, userId?: string): Promise<void> {
    try {
      await sql`
        UPDATE rfqs 
        SET 
          status = ${status},
          updated_at = ${new Date().toISOString()},
          created_by = ${userId || 'system'}
        WHERE id = ${id}`;
    } catch (error) {
      log.error('Error updating RFQ status:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Get RFQs by project
   */
  static async getByProject(projectId: string): Promise<RFQ[]> {
    return this.getAll({ projectId });
  }

  /**
   * Get RFQs by status
   */
  static async getByStatus(status: RFQStatus): Promise<RFQ[]> {
    return this.getAll({ status });
  }

  /**
   * Get active RFQs (non-closed statuses)
   */
  static async getActive(): Promise<RFQ[]> {
    try {
      const activeStatuses = [RFQStatus.DRAFT, RFQStatus.ISSUED, RFQStatus.RESPONSES_RECEIVED];
      
      const result = await sql`
        SELECT 
          r.*,
          COUNT(DISTINCT ri.id) as item_count,
          COUNT(DISTINCT rr.id) as response_count
        FROM rfqs r
        LEFT JOIN rfq_items ri ON r.id = ri.rfq_id
        LEFT JOIN rfq_responses rr ON r.id = rr.rfq_id
        WHERE r.status = ANY(${activeStatuses})
        GROUP BY r.id
        ORDER BY r.created_at DESC`;
      
      return result.map(row => ({
        id: row.id,
        projectId: row.project_id,
        rfqNumber: row.rfq_number,
        title: row.title,
        description: row.description,
        status: row.status as RFQStatus,
        issueDate: row.issue_date,
        responseDeadline: row.response_deadline || row.closing_date,
        invitedSuppliers: row.invited_suppliers || [],
        itemCount: parseInt(row.item_count) || 0,
        responseCount: parseInt(row.response_count) || 0,
        paymentTerms: row.payment_terms,
        deliveryTerms: row.delivery_terms,
        validityPeriod: row.validity_period || 30,
        currency: row.currency || 'ZAR',
        technicalRequirements: row.technical_requirements,
        totalBudgetEstimate: row.total_budget_estimate,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      } as RFQ));
    } catch (error) {
      log.error('Error fetching active RFQs:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Check if RFQ exists
   */
  static async exists(id: string): Promise<boolean> {
    try {
      const result = await sql`
        SELECT EXISTS(
          SELECT 1 FROM rfqs WHERE id = ${id}
        ) as exists`;
      return result[0].exists;
    } catch (error) {
      log.error('Error checking RFQ existence:', { data: error }, 'rfqCrud');
      return false;
    }
  }

  /**
   * Add RFQ items
   */
  static async addItems(rfqId: string, items: any[]): Promise<void> {
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await sql`
          INSERT INTO rfq_items (
            rfq_id,
            line_number,
            description,
            specifications,
            quantity,
            uom,
            category,
            estimated_unit_price,
            estimated_total_price
          ) VALUES (
            ${rfqId},
            ${i + 1},
            ${item.description},
            ${item.specifications || ''},
            ${item.quantity},
            ${item.unit || 'EA'},
            ${item.category || ''},
            ${item.estimatedUnitPrice || 0},
            ${item.estimatedTotalPrice || item.quantity * (item.estimatedUnitPrice || 0)}
          )`;
      }
      
      // Update item count
      await sql`
        UPDATE rfqs 
        SET total_items = (SELECT COUNT(*) FROM rfq_items WHERE rfq_id = ${rfqId})
        WHERE id = ${rfqId}`;
    } catch (error) {
      log.error('Error adding RFQ items:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Get RFQ items
   */
  static async getItems(rfqId: string): Promise<any[]> {
    try {
      const result = await sql`
        SELECT * FROM rfq_items 
        WHERE rfq_id = ${rfqId}
        ORDER BY line_number`;
      
      return result.map(item => ({
        id: item.id,
        lineNumber: item.line_number,
        description: item.description,
        specifications: item.specifications,
        quantity: item.quantity,
        unit: item.uom,
        category: item.category,
        estimatedUnitPrice: item.estimated_unit_price,
        estimatedTotalPrice: item.estimated_total_price
      }));
    } catch (error) {
      log.error('Error fetching RFQ items:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Submit RFQ response
   */
  static async submitResponse(rfqId: string, response: any): Promise<string> {
    try {
      const responseNumber = `RSP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      
      const result = await sql`
        INSERT INTO rfq_responses (
          rfq_id,
          supplier_id,
          supplier_name,
          response_number,
          total_amount,
          currency,
          validity_period,
          payment_terms,
          delivery_terms,
          delivery_date,
          status,
          attachments
        ) VALUES (
          ${rfqId},
          ${response.supplierId},
          ${response.supplierName},
          ${responseNumber},
          ${response.totalAmount},
          ${response.currency || 'ZAR'},
          ${response.validityPeriod || 30},
          ${response.paymentTerms || ''},
          ${response.deliveryTerms || ''},
          ${response.deliveryDate ? new Date(response.deliveryDate).toISOString() : null},
          'submitted',
          ${JSON.stringify(response.attachments || [])}
        )
        RETURNING id`;
      
      // Add response items if provided
      if (response.items && response.items.length > 0) {
        for (const item of response.items) {
          await sql`
            INSERT INTO rfq_response_items (
              response_id,
              rfq_item_id,
              unit_price,
              total_price,
              discount_percent,
              delivery_days,
              notes
            ) VALUES (
              ${result[0].id},
              ${item.rfqItemId},
              ${item.unitPrice},
              ${item.totalPrice},
              ${item.discountPercent || 0},
              ${item.deliveryDays || 0},
              ${item.notes || ''}
            )`;
        }
      }
      
      // Update RFQ response count
      await sql`
        UPDATE rfqs 
        SET responses_received = (SELECT COUNT(*) FROM rfq_responses WHERE rfq_id = ${rfqId})
        WHERE id = ${rfqId}`;
      
      return result[0].id;
    } catch (error) {
      log.error('Error submitting RFQ response:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Get RFQ responses
   */
  static async getResponses(rfqId: string): Promise<any[]> {
    try {
      const result = await sql`
        SELECT 
          r.*,
          s.company_name,
          s.email as supplier_email,
          s.phone as supplier_phone
        FROM rfq_responses r
        LEFT JOIN suppliers s ON r.supplier_id = s.id
        WHERE r.rfq_id = ${rfqId}
        ORDER BY r.submission_date DESC`;
      
      return result.map(response => ({
        id: response.id,
        rfqId: response.rfq_id,
        supplierId: response.supplier_id,
        supplierName: response.supplier_name || response.company_name,
        supplierEmail: response.supplier_email,
        supplierPhone: response.supplier_phone,
        responseNumber: response.response_number,
        submissionDate: response.submission_date,
        totalAmount: response.total_amount,
        currency: response.currency,
        status: response.status,
        evaluationScore: response.evaluation_score,
        evaluationNotes: response.evaluation_notes
      }));
    } catch (error) {
      log.error('Error fetching RFQ responses:', { data: error }, 'rfqCrud');
      throw error;
    }
  }

  /**
   * Create RFQ notification
   */
  static async createNotification(rfqId: string, notification: any): Promise<void> {
    try {
      await sql`
        INSERT INTO rfq_notifications (
          rfq_id,
          notification_type,
          recipient_type,
          recipient_id,
          recipient_email,
          subject,
          message,
          status,
          metadata
        ) VALUES (
          ${rfqId},
          ${notification.type},
          ${notification.recipientType},
          ${notification.recipientId || null},
          ${notification.recipientEmail || null},
          ${notification.subject},
          ${notification.message},
          'pending',
          ${JSON.stringify(notification.metadata || {})}
        )`;
    } catch (error) {
      log.error('Error creating RFQ notification:', { data: error }, 'rfqCrud');
      throw error;
    }
  }
}
