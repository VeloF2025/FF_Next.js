/**
 * RFQ Event Notification Generator
 * Generates notifications for different RFQ lifecycle events
 */

import { RFQ } from '@/types/procurement.types';
import { NotificationContent, RFQNotificationEvent } from './types';
import { BaseRFQGenerator } from './baseGenerator';

export class RFQEventNotificationGenerator extends BaseRFQGenerator {
  /**
   * Generate notification content for RFQ events
   */
  static generateNotificationContent(
    event: RFQNotificationEvent,
    rfq: RFQ,
    additionalData?: Record<string, unknown>
  ): NotificationContent {
    switch (event) {
      case 'created':
        return this.generateCreatedNotification(rfq);
        
      case 'published':
      case 'issued':
        return this.generatePublishedNotification(rfq, additionalData);
        
      case 'response_received':
        return this.generateResponseReceivedNotification(rfq, additionalData);
        
      case 'awarded':
        return this.generateAwardedNotification(rfq, additionalData);
        
      case 'closed':
        return this.generateClosedNotification(rfq, additionalData);
        
      case 'cancelled':
        return this.generateCancelledNotification(rfq, additionalData);
        
      case 'deadline_extended':
        return this.generateDeadlineExtendedNotification(rfq, additionalData);
        
      case 'deadline_approaching':
        return this.generateDeadlineApproachingNotification(rfq);
        
      case 'overdue':
        return this.generateOverdueNotification(rfq);
        
      case 'updated':
        return this.generateUpdatedNotification(rfq, additionalData);
        
      case 'withdrawn':
        return this.generateWithdrawnNotification(rfq, additionalData);
        
      default:
        return this.generateDefaultNotification(rfq, event);
    }
  }

  private static generateCreatedNotification(rfq: RFQ): NotificationContent {
    return {
      title: 'RFQ Created',
      message: `RFQ "${rfq.title}" has been created for project ${rfq.projectId}`,
      type: 'info',
      actions: [
        { 
          label: 'View RFQ', 
          action: 'view_rfq', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id)
        },
        { 
          label: 'Add Items', 
          action: 'add_items',
          href: this.generateRFQLink(rfq.id, '/items')
        }
      ],
      metadata: this.createMetadata(rfq, 'created')
    };
  }

  private static generatePublishedNotification(rfq: RFQ, additionalData?: Record<string, unknown>): NotificationContent {
    const supplierCount = (additionalData?.supplierCount as number | undefined) ?? rfq.invitedSuppliers?.length ?? 0;
    
    return {
      title: 'RFQ Published',
      message: `RFQ "${rfq.title}" has been published to ${supplierCount} suppliers`,
      type: 'success',
      actions: [
        { 
          label: 'View RFQ', 
          action: 'view_rfq', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id)
        },
        { 
          label: 'Track Responses', 
          action: 'track_responses',
          href: this.generateRFQLink(rfq.id, '/responses')
        }
      ],
      metadata: this.createMetadata(rfq, 'issued', { supplierCount })
    };
  }

  private static generateResponseReceivedNotification(rfq: RFQ, additionalData?: Record<string, unknown>): NotificationContent {
    const supplierName = (additionalData?.supplierName as string | undefined) ?? 'A supplier';
    
    return {
      title: 'New RFQ Response',
      message: `${supplierName} has submitted a response to "${rfq.title}"`,
      type: 'info',
      actions: [
        { 
          label: 'Review Response', 
          action: 'review_response', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id, '/responses')
        },
        { 
          label: 'Compare All', 
          action: 'compare_responses',
          href: this.generateRFQLink(rfq.id, '/comparison')
        }
      ],
      metadata: this.createMetadata(rfq, 'response_received', additionalData)
    };
  }

  private static generateAwardedNotification(rfq: RFQ, additionalData?: Record<string, unknown>): NotificationContent {
    const winnerName = (additionalData?.winnerName as string | undefined) ?? 'Selected supplier';
    
    return {
      title: 'RFQ Awarded',
      message: `RFQ "${rfq.title}" has been awarded to ${winnerName}`,
      type: 'success',
      actions: [
        { 
          label: 'View Award', 
          action: 'view_award', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id, '/award')
        }
      ],
      metadata: this.createMetadata(rfq, 'awarded', additionalData)
    };
  }

  private static generateClosedNotification(rfq: RFQ, additionalData?: Record<string, unknown>): NotificationContent {
    return {
      title: 'RFQ Closed',
      message: `RFQ "${rfq.title}" has been closed`,
      type: 'info',
      actions: [
        { 
          label: 'View Summary', 
          action: 'view_summary', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id, '/summary')
        }
      ],
      metadata: this.createMetadata(rfq, 'closed', additionalData)
    };
  }

  private static generateCancelledNotification(rfq: RFQ, additionalData?: Record<string, unknown>): NotificationContent {
    return {
      title: 'RFQ Cancelled',
      message: `RFQ "${rfq.title}" has been cancelled`,
      type: 'warning',
      actions: [
        { 
          label: 'View Details', 
          action: 'view_details',
          href: this.generateRFQLink(rfq.id)
        }
      ],
      metadata: this.createMetadata(rfq, 'cancelled', additionalData)
    };
  }

  private static generateDeadlineExtendedNotification(rfq: RFQ, additionalData?: Record<string, unknown>): NotificationContent {
    const newDeadline = (additionalData?.newDeadline as Date | undefined) ?? rfq.responseDeadline;
    const deadlineText = newDeadline ? this.formatDeadline(newDeadline) : 'a new date';
    
    return {
      title: 'RFQ Deadline Extended',
      message: `Response deadline for "${rfq.title}" has been extended to ${deadlineText}`,
      type: 'info',
      actions: [
        { 
          label: 'View RFQ', 
          action: 'view_rfq', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id)
        }
      ],
      metadata: this.createMetadata(rfq, 'deadline_extended', { newDeadline: deadlineText })
    };
  }

  private static generateDeadlineApproachingNotification(rfq: RFQ): NotificationContent {
    const hoursRemaining = this.getHoursRemaining(rfq);
    
    return {
      title: 'RFQ Deadline Approaching',
      message: `Response deadline for "${rfq.title}" is in ${hoursRemaining} hours`,
      type: 'warning',
      actions: [
        { 
          label: 'Check Responses', 
          action: 'check_responses', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id, '/responses')
        }
      ],
      metadata: this.createMetadata(rfq, 'deadline_approaching', { hoursRemaining })
    };
  }

  private static generateOverdueNotification(rfq: RFQ): NotificationContent {
    return {
      title: 'RFQ Overdue',
      message: `Response deadline for "${rfq.title}" has passed`,
      type: 'error',
      actions: [
        { 
          label: 'Extend Deadline', 
          action: 'extend_deadline', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id, '/extend')
        },
        { 
          label: 'View Responses', 
          action: 'view_responses',
          href: this.generateRFQLink(rfq.id, '/responses')
        }
      ],
      metadata: this.createMetadata(rfq, 'overdue')
    };
  }

  private static generateUpdatedNotification(rfq: RFQ, additionalData?: Record<string, unknown>): NotificationContent {
    const updateType = (additionalData?.updateType as string | undefined) ?? 'details';
    
    return {
      title: 'RFQ Updated',
      message: `RFQ "${rfq.title}" ${updateType} have been updated`,
      type: 'info',
      actions: [
        { 
          label: 'View Changes', 
          action: 'view_changes', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id)
        }
      ],
      metadata: this.createMetadata(rfq, 'updated', additionalData)
    };
  }

  private static generateWithdrawnNotification(rfq: RFQ, additionalData?: Record<string, unknown>): NotificationContent {
    return {
      title: 'RFQ Withdrawn',
      message: `RFQ "${rfq.title}" has been withdrawn from publication`,
      type: 'warning',
      actions: [
        { 
          label: 'View Details', 
          action: 'view_details',
          href: this.generateRFQLink(rfq.id)
        }
      ],
      metadata: this.createMetadata(rfq, 'withdrawn', additionalData)
    };
  }

  private static generateDefaultNotification(rfq: RFQ, event: RFQNotificationEvent): NotificationContent {
    return {
      title: 'RFQ Update',
      message: `RFQ "${rfq.title}" has been updated`,
      type: 'info',
      actions: [
        { 
          label: 'View RFQ', 
          action: 'view_rfq',
          href: this.generateRFQLink(rfq.id)
        }
      ],
      metadata: this.createMetadata(rfq, event)
    };
  }
}