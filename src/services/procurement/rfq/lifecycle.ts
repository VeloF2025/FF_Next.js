/**
 * RFQ Lifecycle Management Service
 * Handles RFQ workflow, responses, and status transitions
 * Fully migrated to use Neon PostgreSQL
 */

import { neon } from '@neondatabase/serverless';
import { RFQStatus } from '@/types/procurement.types';
import { RFQCrud } from './rfqCrud';
import { EmailNotificationService } from './notifications/emailNotificationService';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Utility to convert various date formats to Date object
 */
function toDate(timestampOrDate: Date | string | number | any): Date {
  if (!timestampOrDate) {
    return new Date();
  }
  
  // If it's already a Date, return it
  if (timestampOrDate instanceof Date) {
    return timestampOrDate;
  }
  
  // If it's a timestamp number, convert it
  if (typeof timestampOrDate === 'number') {
    return new Date(timestampOrDate);
  }
  
  // If it's a string, parse it
  if (typeof timestampOrDate === 'string') {
    return new Date(timestampOrDate);
  }
  
  // Fallback: try to parse as date
  return new Date(timestampOrDate);
}

/**
 * RFQ Lifecycle Management - Wrapper around Neon service for backward compatibility
 */
export class RFQLifecycle {
  /**
   * Send RFQ to suppliers (transition from DRAFT to ISSUED)
   */
  static async sendToSuppliers(id: string): Promise<void> {
    try {
      // Get RFQ details
      const rfq = await RFQCrud.getById(id);
      
      // Update status to ISSUED
      await RFQCrud.updateStatus(id, RFQStatus.ISSUED);
      
      // Send invitations to suppliers
      if (rfq.invitedSuppliers && rfq.invitedSuppliers.length > 0) {
        await EmailNotificationService.sendRFQInvitations(id, rfq.invitedSuppliers);
      }
      
      log.info('RFQ sent to suppliers', { rfqId: id, supplierCount: rfq.invitedSuppliers?.length }, 'lifecycle');
    } catch (error) {
      log.error('Error sending RFQ to suppliers:', { data: error }, 'lifecycle');
      throw error;
    }
  }

  /**
   * Submit a supplier response to an RFQ
   */
  static async submitResponse(rfqId: string, response: any): Promise<string> {
    try {
      // Submit response using CRUD service
      const responseId = await RFQCrud.submitResponse(rfqId, response);
      
      // Update RFQ status if this is the first response
      const responses = await RFQCrud.getResponses(rfqId);
      if (responses.length === 1) {
        await RFQCrud.updateStatus(rfqId, RFQStatus.RESPONSES_RECEIVED);
      }
      
      log.info('RFQ response submitted', { rfqId, responseId, supplierId: response.supplierId }, 'lifecycle');
      return responseId;
    } catch (error) {
      log.error('Error submitting RFQ response:', { data: error }, 'lifecycle');
      throw error;
    }
  }

  /**
   * Get all responses for an RFQ
   */
  static async getResponses(rfqId: string): Promise<any[]> {
    try {
      return await RFQCrud.getResponses(rfqId);
    } catch (error) {
      log.error('Error fetching RFQ responses:', { data: error }, 'lifecycle');
      throw error;
    }
  }

  /**
   * Select winning response and award RFQ
   */
  static async selectResponse(rfqId: string, responseId: string, reason?: string, userId?: string): Promise<void> {
    try {
      // Update response as selected
      await sql`
        UPDATE rfq_responses 
        SET 
          status = 'accepted',
          evaluated_by = ${userId || 'system'},
          evaluated_at = ${new Date().toISOString()},
          evaluation_notes = ${reason || 'Selected as winning bid'}
        WHERE id = ${responseId}`;
      
      // Update other responses as rejected
      await sql`
        UPDATE rfq_responses 
        SET status = 'rejected'
        WHERE rfq_id = ${rfqId} AND id != ${responseId} AND status = 'submitted'`;
      
      // Update RFQ status to AWARDED
      await RFQCrud.updateStatus(rfqId, RFQStatus.AWARDED, userId);
      
      // Get all supplier IDs for notifications
      const responses = await RFQCrud.getResponses(rfqId);
      const allSupplierIds = responses.map(r => r.supplierId);
      const winningResponse = responses.find(r => r.id === responseId);
      
      // Send award notifications
      if (winningResponse) {
        await EmailNotificationService.sendAwardNotification(
          rfqId,
          winningResponse.supplierId,
          allSupplierIds
        );
      }
      
      log.info('RFQ response selected', { rfqId, responseId, userId }, 'lifecycle');
    } catch (error) {
      log.error('Error selecting RFQ response:', { data: error }, 'lifecycle');
      throw error;
    }
  }

  /**
   * Compare responses for an RFQ
   */
  static async compareResponses(rfqId: string): Promise<{
    responses: any[];
    lowestPrice: any;
    fastestDelivery: any;
    bestPaymentTerms: any;
  }> {
    try {
      const responses = await RFQLifecycle.getResponses(rfqId);
      
      if (responses.length === 0) {
        throw new Error('No responses to compare');
      }
      
      const lowestPrice = responses.reduce((min, r) => 
        r.totalAmount < min.totalAmount ? r : min
      );
      
      const fastestDelivery = responses.reduce((min, r) => 
        r.deliveryLeadTime < min.deliveryLeadTime ? r : min
      );
      
      // Simple comparison - could be more sophisticated
      const bestPaymentTerms = responses.reduce((best, r) => {
        const currentDays = parseInt(best.paymentTerms.match(/\d+/)?.[0] || '0');
        const newDays = parseInt(r.paymentTerms.match(/\d+/)?.[0] || '0');
        return newDays > currentDays ? r : best;
      });
      
      return {
        responses,
        lowestPrice,
        fastestDelivery,
        bestPaymentTerms
      };
    } catch (error) {
      log.error('Error comparing RFQ responses:', { data: error }, 'lifecycle');
      throw error;
    }
  }

  /**
   * Close RFQ without awarding (transition to CLOSED)
   */
  static async closeRFQ(rfqId: string, reason: string, userId?: string): Promise<void> {
    try {
      await sql`
        UPDATE rfqs 
        SET 
          status = ${RFQStatus.CLOSED},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${rfqId}`;
      
      // Store closure reason in notification metadata
      await RFQCrud.createNotification(rfqId, {
        type: 'rfq_deadline',
        recipientType: 'internal',
        recipientId: userId || 'system',
        subject: 'RFQ Closed',
        message: `RFQ closed without awarding: ${reason}`,
        metadata: { closureReason: reason }
      });
      
      log.info('RFQ closed', { rfqId, reason, userId }, 'lifecycle');
    } catch (error) {
      log.error('Error closing RFQ:', { data: error }, 'lifecycle');
      throw error;
    }
  }

  /**
   * Cancel RFQ (transition to CANCELLED)
   */
  static async cancelRFQ(rfqId: string, reason: string, userId?: string): Promise<void> {
    try {
      await RFQCrud.updateStatus(rfqId, RFQStatus.CANCELLED, userId);
      
      // Store cancellation reason
      await RFQCrud.createNotification(rfqId, {
        type: 'rfq_deadline',
        recipientType: 'all',
        subject: 'RFQ Cancelled',
        message: `This RFQ has been cancelled. Reason: ${reason}`,
        metadata: { cancellationReason: reason, cancelledBy: userId }
      });
      
      // Send notifications to all invited suppliers
      const rfq = await RFQCrud.getById(rfqId);
      if (rfq.invitedSuppliers && rfq.invitedSuppliers.length > 0) {
        for (const supplierId of rfq.invitedSuppliers) {
          await RFQCrud.createNotification(rfqId, {
            type: 'rfq_deadline',
            recipientType: 'supplier',
            recipientId: supplierId,
            subject: `RFQ ${rfq.rfqNumber} Cancelled`,
            message: `RFQ ${rfq.rfqNumber} - ${rfq.title} has been cancelled.`
          });
        }
      }
      
      log.info('RFQ cancelled', { rfqId, reason, userId }, 'lifecycle');
    } catch (error) {
      log.error('Error cancelling RFQ:', { data: error }, 'lifecycle');
      throw error;
    }
  }

  /**
   * Extend RFQ deadline
   */
  static async extendDeadline(rfqId: string, newDeadline: Date, reason?: string, userId?: string): Promise<void> {
    try {
      const currentRFQ = await RFQCrud.getById(rfqId);
      const previousDeadline = currentRFQ.responseDeadline;
      
      // Update deadline
      await sql`
        UPDATE rfqs 
        SET 
          response_deadline = ${newDeadline.toISOString()},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${rfqId}`;
      
      // Create notification about extension
      await RFQCrud.createNotification(rfqId, {
        type: 'rfq_deadline',
        recipientType: 'all',
        subject: 'RFQ Deadline Extended',
        message: `Deadline extended from ${new Date(previousDeadline).toISOString().split('T')[0]} to ${newDeadline.toISOString().split('T')[0]}. ${reason || ''}`,
        metadata: {
          previousDeadline,
          newDeadline: newDeadline.toISOString(),
          extendedBy: userId,
          reason
        }
      });
      
      // Send email notifications to suppliers
      if (currentRFQ.invitedSuppliers && currentRFQ.invitedSuppliers.length > 0) {
        await EmailNotificationService.sendDeadlineReminder(rfqId);
      }
      
      log.info('RFQ deadline extended', { rfqId, newDeadline, reason, userId }, 'lifecycle');
    } catch (error) {
      log.error('Error extending RFQ deadline:', { data: error }, 'lifecycle');
      throw error;
    }
  }

  /**
   * Get current deadline for an RFQ
   */
  private static async getCurrentDeadline(rfqId: string): Promise<Date> {
    const rfq = await RFQCrud.getById(rfqId);
    return toDate(rfq.responseDeadline);
  }

  /**
   * Check if RFQ is past deadline
   */
  static async isRFQPastDeadline(rfqId: string): Promise<boolean> {
    try {
      const rfq = await RFQCrud.getById(rfqId);
      const deadline = toDate(rfq.responseDeadline);
      return new Date() > deadline;
    } catch (error) {
      log.error('Error checking RFQ deadline:', { data: error }, 'lifecycle');
      return false;
    }
  }

  /**
   * Get RFQ status transition history
   */
  static async getStatusHistory(_rfqId: string): Promise<Array<{
    status: RFQStatus;
    timestamp: Date;
    userId: string;
    reason?: string;
  }>> {
    // This would typically require a separate status history collection
    // For now, return empty array - implement based on your requirements
    return [];
  }

  /**
   * Validate RFQ can transition to new status
   */
  static validateStatusTransition(currentStatus: RFQStatus, newStatus: RFQStatus): boolean {
    const validTransitions: Record<RFQStatus, RFQStatus[]> = {
      [RFQStatus.DRAFT]: [RFQStatus.READY_TO_SEND, RFQStatus.CANCELLED],
      [RFQStatus.READY_TO_SEND]: [RFQStatus.ISSUED, RFQStatus.CANCELLED],
      [RFQStatus.ISSUED]: [RFQStatus.RESPONSES_RECEIVED, RFQStatus.CLOSED, RFQStatus.CANCELLED],
      [RFQStatus.RESPONSES_RECEIVED]: [RFQStatus.EVALUATED, RFQStatus.AWARDED, RFQStatus.CLOSED, RFQStatus.CANCELLED],
      [RFQStatus.EVALUATED]: [RFQStatus.AWARDED, RFQStatus.CLOSED, RFQStatus.CANCELLED],
      [RFQStatus.AWARDED]: [RFQStatus.CLOSED],
      [RFQStatus.CLOSED]: [],
      [RFQStatus.CANCELLED]: []
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }
}