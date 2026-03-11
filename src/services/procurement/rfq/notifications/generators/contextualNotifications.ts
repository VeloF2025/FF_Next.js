/**
 * Contextual RFQ Notification Generator
 * Generates role-based and context-aware notifications
 */

import { RFQ } from '@/types/procurement.types';
import { NotificationContent, UserRole, NotificationContext } from './types';
import { BaseRFQGenerator } from './baseGenerator';

export class ContextualNotificationGenerator extends BaseRFQGenerator {
  /**
   * Generate contextual notification based on user role and RFQ state
   */
  static generateContextualNotification(
    rfq: RFQ,
    userRole: UserRole,
    context?: NotificationContext
  ): NotificationContent {
    const isSupplierUser = userRole === 'supplier';
    const userSupplierInvited = context?.userSupplier && 
      rfq.invitedSuppliers?.includes(context.userSupplier);

    if (isSupplierUser && userSupplierInvited) {
      return this.generateSupplierNotification(rfq, context);
    } else {
      return this.generateBuyerNotification(rfq, userRole, context);
    }
  }

  /**
   * Generate supplier-specific notifications
   */
  static generateSupplierNotification(
    rfq: RFQ,
    context?: NotificationContext
  ): NotificationContent {
    if (this.isOverdue(rfq)) {
      return {
        title: 'RFQ Response Overdue',
        message: `Your response to "${rfq.title}" is overdue`,
        type: 'error',
        actions: [
          { 
            label: 'View RFQ', 
            action: 'view_rfq',
            href: this.generateSupplierRFQLink(rfq.id)
          }
        ],
        metadata: this.createMetadata(rfq, 'overdue', { userType: 'supplier' })
      };
    }

    if (this.isDeadlineApproaching(rfq)) {
      const hoursRemaining = this.getHoursRemaining(rfq);
      return {
        title: 'RFQ Response Due Soon',
        message: `Response to "${rfq.title}" is due in ${hoursRemaining} hours`,
        type: 'warning',
        actions: [
          { 
            label: 'Respond Now', 
            action: 'respond_now', 
            variant: 'primary',
            href: this.generateSupplierRFQLink(rfq.id, '/respond')
          }
        ],
        metadata: this.createMetadata(rfq, 'deadline_approaching', { 
          userType: 'supplier',
          hoursRemaining 
        })
      };
    }

    // Check if already responded
    const hasResponded = context?.userSupplier && 
      rfq.respondedSuppliers?.includes(context.userSupplier);

    if (hasResponded) {
      return {
        title: 'Response Submitted',
        message: `Your response to "${rfq.title}" has been submitted`,
        type: 'success',
        actions: [
          { 
            label: 'View Response', 
            action: 'view_response',
            href: this.generateSupplierRFQLink(rfq.id, '/response')
          },
          { 
            label: 'Edit Response', 
            action: 'edit_response',
            href: this.generateSupplierRFQLink(rfq.id, '/respond')
          }
        ],
        metadata: this.createMetadata(rfq, 'response_received', { userType: 'supplier' })
      };
    }

    // Default invitation notification
    return {
      title: 'New RFQ Invitation',
      message: `You have been invited to respond to "${rfq.title}"`,
      type: 'info',
      actions: [
        { 
          label: 'View Details', 
          action: 'view_details',
          href: this.generateSupplierRFQLink(rfq.id)
        },
        { 
          label: 'Submit Response', 
          action: 'submit_response', 
          variant: 'primary',
          href: this.generateSupplierRFQLink(rfq.id, '/respond')
        }
      ],
      metadata: this.createMetadata(rfq, 'issued', { userType: 'supplier' })
    };
  }

  /**
   * Generate buyer/admin notifications
   */
  static generateBuyerNotification(
    rfq: RFQ,
    userRole: UserRole,
    context?: NotificationContext
  ): NotificationContent {
    const pendingActions = context?.pendingActions || [];
    const recentActivity = context?.recentActivity;

    // Check for pending actions
    if (pendingActions.length > 0) {
      return this.generateActionRequiredNotification(rfq, pendingActions, userRole);
    }

    // Check RFQ status and generate appropriate notification
    switch (rfq.status) {
      case 'draft':
        return this.generateDraftNotification(rfq, userRole);
        
      case 'issued':
      case 'responses_received':
      case 'evaluated':
        return this.generateActiveNotification(rfq, userRole);
        
      case 'closed':
        return this.generateClosedNotification(rfq, userRole);
        
      case 'awarded':
        return this.generateAwardedNotification(rfq, userRole);
        
      default:
        return this.generateDefaultBuyerNotification(rfq, userRole, recentActivity);
    }
  }

  private static generateActionRequiredNotification(
    rfq: RFQ, 
    pendingActions: string[], 
    userRole: UserRole
  ): NotificationContent {
    const primaryAction = pendingActions[0] ?? '';
    const actionCount = pendingActions.length;
    
    let actionText = '';
    let primaryHref = '';
    
    switch (primaryAction) {
      case 'review_responses':
        actionText = 'Review supplier responses';
        primaryHref = this.generateRFQLink(rfq.id, '/responses');
        break;
      case 'extend_deadline':
        actionText = 'Extend response deadline';
        primaryHref = this.generateRFQLink(rfq.id, '/extend');
        break;
      case 'award_rfq':
        actionText = 'Award RFQ to supplier';
        primaryHref = this.generateRFQLink(rfq.id, '/award');
        break;
      case 'publish_rfq':
        actionText = 'Publish RFQ to suppliers';
        primaryHref = this.generateRFQLink(rfq.id, '/publish');
        break;
      default:
        actionText = 'Action required';
        primaryHref = this.generateRFQLink(rfq.id);
    }

    const message = actionCount > 1 
      ? `${actionText} and ${actionCount - 1} other action${actionCount > 2 ? 's' : ''} required for "${rfq.title}"`
      : `${actionText} required for "${rfq.title}"`;

    return {
      title: 'Action Required',
      message,
      type: 'warning',
      actions: [
        { 
          label: 'Take Action', 
          action: primaryAction, 
          variant: 'primary',
          href: primaryHref
        },
        { 
          label: 'View All', 
          action: 'view_all',
          href: this.generateRFQLink(rfq.id)
        }
      ],
      metadata: this.createMetadata(rfq, 'updated', { 
        userType: userRole,
        pendingActions,
        actionCount 
      })
    };
  }

  private static generateDraftNotification(rfq: RFQ, userRole: UserRole): NotificationContent {
    return {
      title: 'Draft RFQ',
      message: `RFQ "${rfq.title}" is in draft status`,
      type: 'info',
      actions: [
        { 
          label: 'Continue Editing', 
          action: 'edit_rfq', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id, '/edit')
        },
        { 
          label: 'Publish', 
          action: 'publish_rfq',
          href: this.generateRFQLink(rfq.id, '/publish')
        }
      ],
      metadata: this.createMetadata(rfq, 'created', { userType: userRole })
    };
  }

  private static generateActiveNotification(rfq: RFQ, userRole: UserRole): NotificationContent {
    const responseCount = rfq.respondedSuppliers?.length || 0;
    const totalSuppliers = rfq.invitedSuppliers?.length || 0;
    
    return {
      title: 'Active RFQ',
      message: `"${rfq.title}" has received ${responseCount} of ${totalSuppliers} responses`,
      type: 'info',
      actions: [
        { 
          label: 'View Responses', 
          action: 'view_responses', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id, '/responses')
        },
        { 
          label: 'Track Progress', 
          action: 'track_progress',
          href: this.generateRFQLink(rfq.id, '/tracking')
        }
      ],
      metadata: this.createMetadata(rfq, 'issued', { 
        userType: userRole,
        responseCount,
        totalSuppliers 
      })
    };
  }

  private static generateClosedNotification(rfq: RFQ, userRole: UserRole): NotificationContent {
    return {
      title: 'RFQ Closed',
      message: `RFQ "${rfq.title}" evaluation is complete`,
      type: 'success',
      actions: [
        { 
          label: 'View Summary', 
          action: 'view_summary', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id, '/summary')
        },
        { 
          label: 'Generate Report', 
          action: 'generate_report',
          href: this.generateRFQLink(rfq.id, '/report')
        }
      ],
      metadata: this.createMetadata(rfq, 'closed', { userType: userRole })
    };
  }

  private static generateAwardedNotification(rfq: RFQ, userRole: UserRole): NotificationContent {
    return {
      title: 'RFQ Awarded',
      message: `RFQ "${rfq.title}" has been successfully awarded`,
      type: 'success',
      actions: [
        { 
          label: 'View Award Details', 
          action: 'view_award', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id, '/award')
        },
        { 
          label: 'Create Purchase Order', 
          action: 'create_po',
          href: this.generateRFQLink(rfq.id, '/create-po')
        }
      ],
      metadata: this.createMetadata(rfq, 'awarded', { userType: userRole })
    };
  }

  private static generateDefaultBuyerNotification(
    rfq: RFQ, 
    userRole: UserRole, 
    recentActivity?: string
  ): NotificationContent {
    const message = recentActivity 
      ? `Recent activity: ${recentActivity} for "${rfq.title}"`
      : `RFQ "${rfq.title}" requires your attention`;

    return {
      title: 'RFQ Update',
      message,
      type: 'info',
      actions: [
        { 
          label: 'View RFQ', 
          action: 'view_rfq', 
          variant: 'primary',
          href: this.generateRFQLink(rfq.id)
        }
      ],
      metadata: this.createMetadata(rfq, 'updated', { 
        userType: userRole,
        recentActivity 
      })
    };
  }
}