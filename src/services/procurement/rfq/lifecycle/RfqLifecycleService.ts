/**
 * RFQ Lifecycle Service
 * Manages RFQ status transitions and lifecycle events
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { RFQStatus } from '@/types/procurement.types';
import { RfqCrudService } from '../core/RfqCrudService';
import { RfqNotificationService } from '../notifications/RfqNotificationService';
import { validateStatusTransition } from '../utils/rfqStatusValidator';

const sql = neon(process.env.DATABASE_URL!);

export class RfqLifecycleService {
  /**
   * Send RFQ to suppliers (transition from DRAFT to ISSUED)
   */
  static async sendToSuppliers(id: string, supplierIds?: string[]): Promise<void> {
    try {
      const rfq = await RfqCrudService.getById(id);

      if (!validateStatusTransition(rfq.status as RFQStatus, RFQStatus.ISSUED)) {
        throw new Error(`Cannot transition from ${rfq.status} to ${RFQStatus.ISSUED}`);
      }

      const suppliers = supplierIds || rfq.invitedSuppliers;

      await sql`
        UPDATE rfqs
        SET
          status = ${RFQStatus.ISSUED},
          invited_suppliers = ${JSON.stringify(suppliers)},
          issue_date = ${new Date().toISOString()},
          sent_at = ${new Date().toISOString()},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${id}`;

      // Create notifications for each supplier
      for (const supplierId of suppliers!) {
        await RfqNotificationService.createSupplierNotification(id, supplierId, 'invitation');
      }

      log.info('RFQ sent to suppliers', { rfqId: id, supplierCount: suppliers!.length }, 'RfqLifecycleService');
    } catch (error) {
      log.error('Error sending RFQ to suppliers:', { data: error }, 'RfqLifecycleService');
      throw error;
    }
  }

  /**
   * Close RFQ
   */
  static async closeRFQ(rfqId: string, reason: string): Promise<void> {
    try {
      await sql`
        UPDATE rfqs
        SET
          status = ${RFQStatus.CLOSED},
          closed_at = ${new Date().toISOString()},
          closure_reason = ${reason},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${rfqId}`;

      log.info('RFQ closed', { rfqId, reason }, 'RfqLifecycleService');
    } catch (error) {
      log.error('Error closing RFQ:', { data: error }, 'RfqLifecycleService');
      throw error;
    }
  }

  /**
   * Cancel RFQ
   */
  static async cancelRFQ(rfqId: string, reason: string): Promise<void> {
    try {
      await sql`
        UPDATE rfqs
        SET
          status = ${RFQStatus.CANCELLED},
          cancelled_at = ${new Date().toISOString()},
          cancellation_reason = ${reason},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${rfqId}`;

      await RfqNotificationService.createNotification(rfqId, {
        type: 'cancellation',
        recipientType: 'all',
        subject: `RFQ Cancelled`,
        message: `RFQ has been cancelled. Reason: ${reason}`
      });

      log.info('RFQ cancelled', { rfqId, reason }, 'RfqLifecycleService');
    } catch (error) {
      log.error('Error cancelling RFQ:', { data: error }, 'RfqLifecycleService');
      throw error;
    }
  }

  /**
   * Extend RFQ deadline
   */
  static async extendDeadline(rfqId: string, newDeadline: Date, reason?: string): Promise<void> {
    try {
      const rfq = await RfqCrudService.getById(rfqId);

      await sql`
        UPDATE rfqs
        SET
          response_deadline = ${newDeadline.toISOString()},
          closing_date = ${newDeadline.toISOString()},
          deadline_extensions = ${JSON.stringify({
            extendedAt: new Date().toISOString(),
            reason: reason || 'Deadline extended',
            previousDeadline: rfq.responseDeadline
          })},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${rfqId}`;

      await RfqNotificationService.createNotification(rfqId, {
        type: 'deadline_extended',
        recipientType: 'all',
        subject: `RFQ Deadline Extended`,
        message: `The deadline for RFQ ${rfq.rfqNumber} has been extended to ${newDeadline.toISOString().split('T')[0]}`
      });

      log.info('RFQ deadline extended', { rfqId, newDeadline }, 'RfqLifecycleService');
    } catch (error) {
      log.error('Error extending RFQ deadline:', { data: error }, 'RfqLifecycleService');
      throw error;
    }
  }
}
