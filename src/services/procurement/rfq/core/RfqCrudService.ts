/**
 * RFQ CRUD Service
 * Core create, read, update, delete operations for RFQs
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { RFQ, RFQFormData, RFQStatus } from '@/types/procurement.types';
import { RfqItemService } from './RfqItemService';
import { RfqNotificationService } from '../notifications/RfqNotificationService';
import { generateRFQNumber } from '../utils/rfqNumberGenerator';

const sql = neon(process.env.DATABASE_URL!);

export class RfqCrudService {
  /**
   * Create new RFQ with items
   */
  static async create(data: RFQFormData): Promise<string> {
    try {
      const rfqNumber = await generateRFQNumber(data.projectId);

      const rfqResult = await sql`
        INSERT INTO rfqs (
          project_id, rfq_number, title, description, status,
          issue_date, response_deadline, closing_date,
          invited_suppliers, payment_terms, delivery_terms,
          validity_period, currency, technical_requirements,
          total_budget_estimate, created_by
        ) VALUES (
          ${data.projectId},
          ${rfqNumber},
          ${data.title},
          ${data.description || ''},
          ${data.status || RFQStatus.DRAFT},
          ${new Date().toISOString()},
          ${data.responseDeadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()},
          ${data.closingDate || data.responseDeadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()},
          ${JSON.stringify(data.supplierIds || [])},
          ${data.paymentTerms || 'Net 30 days'},
          ${data.deliveryTerms || 'Ex Works'},
          ${data.validityPeriod || 30},
          ${data.currency || 'ZAR'},
          ${data.technicalRequirements || ''},
          ${data.totalBudgetEstimate || 0},
          ${data.createdBy || 'system'}
        )
        RETURNING id`;

      const rfqId = rfqResult[0].id;

      // Add items if provided
      if (data.items && data.items.length > 0) {
        await RfqItemService.addItems(rfqId, data.items);
      }

      // Create initial notification
      await RfqNotificationService.createNotification(rfqId, {
        type: 'created',
        recipientType: 'internal',
        subject: `New RFQ Created: ${rfqNumber}`,
        message: `RFQ ${rfqNumber} has been created for project ${data.projectId}`
      });

      log.info('RFQ created successfully', { rfqId, rfqNumber }, 'RfqCrudService');
      return rfqId;
    } catch (error) {
      log.error('Error creating RFQ:', { data: error }, 'RfqCrudService');
      throw error;
    }
  }

  /**
   * Get RFQ by ID with all related data
   */
  static async getById(id: string): Promise<RFQ> {
    try {
      const rfqResult = await sql`
        SELECT
          r.*,
          COUNT(DISTINCT ri.id) as item_count,
          COUNT(DISTINCT rr.id) as response_count,
          COUNT(DISTINCT rn.id) as notification_count
        FROM rfqs r
        LEFT JOIN rfq_items ri ON r.id = ri.rfq_id
        LEFT JOIN rfq_responses rr ON r.id = rr.rfq_id
        LEFT JOIN rfq_notifications rn ON r.id = rn.rfq_id
        WHERE r.id = ${id}
        GROUP BY r.id`;

      if (rfqResult.length === 0) {
        throw new Error('RFQ not found');
      }

      const items = await RfqItemService.getItems(id);
      const responses = await this.getResponses(id);

      const rfq = rfqResult[0];
      return {
        id: rfq.id,
        projectId: rfq.project_id,
        rfqNumber: rfq.rfq_number,
        title: rfq.title,
        description: rfq.description,
        status: rfq.status as RFQStatus,
        issueDate: rfq.issue_date,
        responseDeadline: rfq.response_deadline,
        closingDate: rfq.closing_date,
        invitedSuppliers: JSON.parse(rfq.invited_suppliers || '[]'),
        items,
        responses,
        itemCount: parseInt(rfq.item_count) || 0,
        responseCount: parseInt(rfq.response_count) || 0,
        paymentTerms: rfq.payment_terms,
        deliveryTerms: rfq.delivery_terms,
        validityPeriod: rfq.validity_period || 30,
        currency: rfq.currency || 'ZAR',
        technicalRequirements: rfq.technical_requirements,
        totalBudgetEstimate: rfq.total_budget_estimate,
        createdBy: rfq.created_by,
        createdAt: rfq.created_at,
        updatedAt: rfq.updated_at
      } as RFQ;
    } catch (error) {
      log.error('Error fetching RFQ:', { data: error }, 'RfqCrudService');
      throw error;
    }
  }

  /**
   * Update RFQ
   */
  static async update(id: string, data: Partial<RFQFormData>): Promise<void> {
    try {
      const updateFields = [];
      const values = [];

      if (data.title !== undefined) {
        updateFields.push('title');
        values.push(data.title);
      }
      if (data.description !== undefined) {
        updateFields.push('description');
        values.push(data.description);
      }
      if (data.responseDeadline !== undefined) {
        updateFields.push('response_deadline');
        values.push(new Date(data.responseDeadline).toISOString());
      }
      if (data.closingDate !== undefined) {
        updateFields.push('closing_date');
        values.push(new Date(data.closingDate).toISOString());
      }
      if (data.supplierIds !== undefined) {
        updateFields.push('invited_suppliers');
        values.push(JSON.stringify(data.supplierIds));
      }
      if (data.paymentTerms !== undefined) {
        updateFields.push('payment_terms');
        values.push(data.paymentTerms);
      }
      if (data.deliveryTerms !== undefined) {
        updateFields.push('delivery_terms');
        values.push(data.deliveryTerms);
      }
      if (data.technicalRequirements !== undefined) {
        updateFields.push('technical_requirements');
        values.push(data.technicalRequirements);
      }
      if (data.totalBudgetEstimate !== undefined) {
        updateFields.push('total_budget_estimate');
        values.push(data.totalBudgetEstimate);
      }

      if (updateFields.length > 0) {
        updateFields.push('updated_at');
        values.push(new Date().toISOString());

        const setClause = updateFields.map((f, i) => `${f} = $${i + 1}`).join(', ');
        values.push(id);

        await sql(`UPDATE rfqs SET ${setClause} WHERE id = $${values.length}`, values);
      }

      log.info('RFQ updated successfully', { rfqId: id }, 'RfqCrudService');
    } catch (error) {
      log.error('Error updating RFQ:', { data: error }, 'RfqCrudService');
      throw error;
    }
  }

  /**
   * Delete RFQ
   */
  static async delete(id: string): Promise<void> {
    try {
      await sql`DELETE FROM rfqs WHERE id = ${id}`;
      log.info('RFQ deleted successfully', { rfqId: id }, 'RfqCrudService');
    } catch (error) {
      log.error('Error deleting RFQ:', { data: error }, 'RfqCrudService');
      throw error;
    }
  }

  /**
   * Update RFQ status
   */
  static async updateStatus(id: string, status: RFQStatus): Promise<void> {
    try {
      await sql`
        UPDATE rfqs
        SET
          status = ${status},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${id}`;
    } catch (error) {
      log.error('Error updating RFQ status:', { data: error }, 'RfqCrudService');
      throw error;
    }
  }

  /**
   * Get RFQ responses (helper method)
   */
  private static async getResponses(rfqId: string): Promise<any[]> {
    try {
      const responses = await sql`
        SELECT
          r.*,
          s.company_name,
          s.email as supplier_email,
          s.phone as supplier_phone
        FROM rfq_responses r
        LEFT JOIN suppliers s ON r.supplier_id = s.id
        WHERE r.rfq_id = ${rfqId}
        ORDER BY r.submission_date DESC`;

      return responses.map(response => ({
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
        validityPeriod: response.validity_period,
        paymentTerms: response.payment_terms,
        deliveryTerms: response.delivery_terms,
        deliveryDate: response.delivery_date,
        deliveryDays: response.delivery_days,
        status: response.status,
        evaluationScore: response.evaluation_score,
        evaluationStatus: response.evaluation_status,
        evaluationNotes: response.evaluation_notes
      }));
    } catch (error) {
      log.error('Error fetching RFQ responses:', { data: error }, 'RfqCrudService');
      return [];
    }
  }
}
