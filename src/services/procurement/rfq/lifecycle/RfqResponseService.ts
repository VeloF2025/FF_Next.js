/**
 * RFQ Response Service
 * Manages supplier responses and response selection
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { RFQStatus } from '@/types/procurement.types';
import { RfqCrudService } from '../core/RfqCrudService';
import { RfqNotificationService } from '../notifications/RfqNotificationService';
import { generateResponseNumber } from '../utils/rfqNumberGenerator';

const sql: any = neon(process.env.DATABASE_URL!);

export class RfqResponseService {
  /**
   * Submit supplier response
   */
  static async submitResponse(rfqId: string, response: any): Promise<string> {
    try {
      const responseNumber = await generateResponseNumber(rfqId);

      const result = await sql`
        INSERT INTO rfq_responses (
          rfq_id, supplier_id, supplier_name, response_number,
          total_amount, currency, validity_period,
          payment_terms, delivery_terms, delivery_date,
          status, attachments, technical_compliance,
          commercial_terms, notes
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
          ${JSON.stringify(response.attachments || [])},
          ${response.technicalCompliance || true},
          ${JSON.stringify(response.commercialTerms || {})},
          ${response.notes || ''}
        )
        RETURNING id`;

      const responseId = result[0].id;

      // Add response items if provided
      if (response.items && response.items.length > 0) {
        for (const item of response.items) {
          await sql`
            INSERT INTO rfq_response_items (
              response_id, rfq_item_id, unit_price, total_price,
              discount_percent, delivery_days, compliance_status,
              alternative_offered, alternative_description, notes
            ) VALUES (
              ${responseId},
              ${item.rfqItemId},
              ${item.unitPrice},
              ${item.totalPrice || item.quantity * item.unitPrice},
              ${item.discountPercent || 0},
              ${item.deliveryDays || 0},
              ${item.complianceStatus || 'compliant'},
              ${item.alternativeOffered || false},
              ${item.alternativeDescription || ''},
              ${item.notes || ''}
            )`;
        }
      }

      // Update RFQ status if first response
      const responseCount = await sql`
        SELECT COUNT(*) as count FROM rfq_responses WHERE rfq_id = ${rfqId}`;

      if (responseCount[0].count === 1) {
        await RfqCrudService.updateStatus(rfqId, RFQStatus.RESPONSES_RECEIVED);
      }

      // Create notification
      await RfqNotificationService.createNotification(rfqId, {
        type: 'response_received',
        recipientType: 'internal',
        subject: `Response received for RFQ`,
        message: `Supplier ${response.supplierName} has submitted a response`
      });

      log.info('RFQ response submitted', { rfqId, responseId }, 'RfqResponseService');
      return responseId;
    } catch (error) {
      log.error('Error submitting RFQ response:', { data: error }, 'RfqResponseService');
      throw error;
    }
  }

  /**
   * Select winning response and award RFQ
   */
  static async selectResponse(rfqId: string, responseId: string, reason?: string): Promise<void> {
    try {
      // Update response as selected
      await sql`
        UPDATE rfq_responses
        SET
          status = 'accepted',
          evaluation_status = 'winner',
          reviewed_at = ${new Date().toISOString()}
        WHERE id = ${responseId}`;

      // Update other responses as not selected
      await sql`
        UPDATE rfq_responses
        SET
          status = 'rejected',
          evaluation_status = 'not_selected'
        WHERE rfq_id = ${rfqId} AND id != ${responseId}`;

      // Update RFQ with selection
      await sql`
        UPDATE rfqs
        SET
          selected_response_id = ${responseId},
          selection_reason = ${reason || ''},
          status = ${RFQStatus.AWARDED},
          awarded_date = ${new Date().toISOString()},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${rfqId}`;

      // Create award notification
      await RfqNotificationService.createNotification(rfqId, {
        type: 'award',
        recipientType: 'all',
        subject: `RFQ Awarded`,
        message: `RFQ has been awarded to the selected supplier`
      });

      log.info('RFQ response selected', { rfqId, responseId }, 'RfqResponseService');
    } catch (error) {
      log.error('Error selecting RFQ response:', { data: error }, 'RfqResponseService');
      throw error;
    }
  }

  /**
   * Get responses for an RFQ
   */
  static async getResponses(rfqId: string): Promise<any[]> {
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

      return responses.map((response: any) => ({
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
      log.error('Error fetching RFQ responses:', { data: error }, 'RfqResponseService');
      return [];
    }
  }
}
