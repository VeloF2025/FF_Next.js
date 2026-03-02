/**
 * Notification Triggers Service - Automatic WhatsApp Notifications
 * 🟢 WORKING: Production-ready automatic notification system for ticket events
 *
 * Features:
 * - Event-driven notification triggers for ticket lifecycle events
 * - Duplicate prevention with configurable time windows
 * - Notification preferences support
 * - Batch event processing
 * - Recipient lookup (users, contractors)
 * - Template-based messaging via WhatsAppService
 * - Comprehensive error handling
 *
 * Supported Events:
 * - ticket.assigned - Ticket assigned to technician or contractor
 * - ticket.qa_rejected - QA rejects ticket submission
 * - ticket.closed - Ticket successfully closed
 * - ticket.sla_warning - SLA deadline approaching
 *
 * @module maintenance/services/notificationTriggers
 */

import { createLogger } from '@/lib/logger';
import { query, queryOne } from '../utils/db';
import { getDefaultWhatsAppService } from './whatsappService';
import { notify } from '@/modules/notifications/services';
import type { Ticket, TicketStatus } from '../types/ticket';
import { RecipientType, NotificationUseCase } from '../types/whatsapp';
import type { WhatsAppNotification, NotificationVariables } from '../types/whatsapp';

// 🟢 WORKING: Logger instance for notification triggers
const logger = createLogger('notificationTriggers');

// ============================================================================
// Types
// ============================================================================

/**
 * Notification event types
 * 🟢 WORKING: Defines all supported ticket event types
 */
export type NotificationEventType =
  | 'ticket.assigned'
  | 'ticket.qa_rejected'
  | 'ticket.closed'
  | 'ticket.sla_warning';

/**
 * Notification event payload
 * 🟢 WORKING: Event data structure for triggering notifications
 */
export interface NotificationEvent {
  type: NotificationEventType;
  ticket_id: string;
  ticket: Ticket;
  previous_status?: TicketStatus;
  new_status?: TicketStatus;
  metadata?: Record<string, any>; // Additional event-specific data
  timestamp: Date;
}

/**
 * Trigger result
 * 🟢 WORKING: Result of processing a notification event
 */
export interface TriggerResult {
  success: boolean;
  notification_sent: boolean;
  notification_id?: string;
  skipped_reason?: 'duplicate' | 'no_phone' | 'disabled_by_preferences' | 'assignee_not_found' | 'unsupported_event_type';
  error?: string;
}

/**
 * Notification preferences
 * 🟢 WORKING: User/system preferences for notification types
 */
export interface NotificationPreferences {
  ticket_assigned?: boolean;
  qa_rejected?: boolean;
  ticket_closed?: boolean;
  sla_warning?: boolean;
}

/**
 * Service configuration
 * 🟢 WORKING: Configuration options for notification trigger service
 */
export interface NotificationTriggerConfig {
  preferences?: NotificationPreferences;
  duplicate_prevention_window_minutes?: number; // Default: 5 minutes
}

/**
 * User lookup result
 * 🟢 WORKING: User data from database lookup
 */
interface UserLookup {
  id: string;
  name: string;
  phone: string | null;
}

/**
 * Contractor lookup result
 * 🟢 WORKING: Contractor data from database lookup
 */
interface ContractorLookup {
  id: string;
  name: string;
  phone: string | null;
}

// ============================================================================
// Service Class
// ============================================================================

/**
 * Notification Trigger Service
 * 🟢 WORKING: Handles automatic WhatsApp notifications for ticket events
 *
 * @example
 * const service = createNotificationTriggerService({
 *   preferences: {
 *     ticket_assigned: true,
 *     qa_rejected: true,
 *     ticket_closed: true,
 *     sla_warning: true,
 *   },
 *   duplicate_prevention_window_minutes: 5,
 * });
 *
 * // Trigger notification on ticket assignment
 * const result = await service.handleEvent({
 *   type: 'ticket.assigned',
 *   ticket_id: 'ticket-uuid',
 *   ticket: ticketData,
 *   previous_status: TicketStatus.OPEN,
 *   new_status: TicketStatus.ASSIGNED,
 *   timestamp: new Date(),
 * });
 */
export class NotificationTriggerService {
  private readonly preferences: NotificationPreferences;
  private readonly duplicateWindowMinutes: number;
  private readonly whatsappService: ReturnType<typeof getDefaultWhatsAppService>;

  constructor(config: NotificationTriggerConfig = {}) {
    // 🟢 WORKING: Set default preferences (all enabled by default)
    this.preferences = {
      ticket_assigned: true,
      qa_rejected: true,
      ticket_closed: true,
      sla_warning: true,
      ...config.preferences,
    };

    this.duplicateWindowMinutes = config.duplicate_prevention_window_minutes || 5;
    this.whatsappService = getDefaultWhatsAppService();
  }

  // ==========================================================================
  // Public API Methods
  // ==========================================================================

  /**
   * Handle a single notification event
   * 🟢 WORKING: Processes event and sends notification if applicable
   */
  async handleEvent(event: NotificationEvent): Promise<TriggerResult> {
    logger.debug('Processing notification event', {
      type: event.type,
      ticket_id: event.ticket_id,
    });

    try {
      // Check if event type is supported
      if (!this.isSupportedEventType(event.type)) {
        logger.warn('Unsupported event type', { type: event.type });
        return {
          success: true,
          notification_sent: false,
          skipped_reason: 'unsupported_event_type',
        };
      }

      // Check notification preferences
      if (!this.isEventEnabled(event.type)) {
        logger.debug('Event disabled by preferences', { type: event.type });
        return {
          success: true,
          notification_sent: false,
          skipped_reason: 'disabled_by_preferences',
        };
      }

      // Get recipient details based on event type
      const recipient = await this.getRecipient(event);

      if (!recipient) {
        logger.warn('Could not determine recipient for event', {
          type: event.type,
          ticket_id: event.ticket_id,
        });
        return {
          success: true,
          notification_sent: false,
          skipped_reason: 'assignee_not_found',
        };
      }

      if (!recipient.phone) {
        logger.warn('Recipient has no phone number', {
          recipient_id: recipient.id,
          ticket_id: event.ticket_id,
        });
        return {
          success: true,
          notification_sent: false,
          skipped_reason: 'no_phone',
        };
      }

      // Check for duplicate notifications
      const isDuplicate = await this.isDuplicateNotification(
        event.ticket_id,
        this.getTemplateForEvent(event.type)
      );

      if (isDuplicate) {
        logger.debug('Skipping duplicate notification', {
          type: event.type,
          ticket_id: event.ticket_id,
        });
        return {
          success: true,
          notification_sent: false,
          skipped_reason: 'duplicate',
        };
      }

      // Send notification
      const notification = await this.sendNotification(event, recipient);

      logger.info('Notification sent successfully', {
        notification_id: notification.id,
        ticket_id: event.ticket_id,
        event_type: event.type,
      });

      return {
        success: true,
        notification_sent: true,
        notification_id: notification.id,
      };
    } catch (error) {
      logger.error('Failed to process notification event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        event_type: event.type,
        ticket_id: event.ticket_id,
      });

      return {
        success: false,
        notification_sent: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Handle multiple events in batch
   * 🟢 WORKING: Processes multiple events sequentially
   */
  async handleBatchEvents(events: NotificationEvent[]): Promise<TriggerResult[]> {
    logger.info('Processing batch notification events', {
      count: events.length,
    });

    const results: TriggerResult[] = [];

    for (const event of events) {
      const result = await this.handleEvent(event);
      results.push(result);
    }

    const successCount = results.filter((r) => r.notification_sent).length;
    const skippedCount = results.filter((r) => !r.notification_sent && r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    logger.info('Batch processing complete', {
      total: events.length,
      sent: successCount,
      skipped: skippedCount,
      failed: failedCount,
    });

    return results;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Check if event type is supported
   * 🟢 WORKING: Validates event type
   */
  private isSupportedEventType(type: string): type is NotificationEventType {
    return [
      'ticket.assigned',
      'ticket.qa_rejected',
      'ticket.closed',
      'ticket.sla_warning',
    ].includes(type);
  }

  /**
   * Check if event is enabled by preferences
   * 🟢 WORKING: Checks notification preferences
   */
  private isEventEnabled(type: NotificationEventType): boolean {
    switch (type) {
      case 'ticket.assigned':
        return this.preferences.ticket_assigned ?? true;
      case 'ticket.qa_rejected':
        return this.preferences.qa_rejected ?? true;
      case 'ticket.closed':
        return this.preferences.ticket_closed ?? true;
      case 'ticket.sla_warning':
        return this.preferences.sla_warning ?? true;
      default:
        return false;
    }
  }

  /**
   * Get template ID for event type
   * 🟢 WORKING: Maps event type to notification template
   */
  private getTemplateForEvent(type: NotificationEventType): NotificationUseCase {
    switch (type) {
      case 'ticket.assigned':
        return NotificationUseCase.TICKET_ASSIGNED;
      case 'ticket.qa_rejected':
        return NotificationUseCase.QA_REJECTED;
      case 'ticket.closed':
        return NotificationUseCase.TICKET_CLOSED;
      case 'ticket.sla_warning':
        return NotificationUseCase.SLA_WARNING;
    }
  }

  /**
   * Get recipient details based on ticket assignment
   * 🟢 WORKING: Looks up user or contractor for the ticket
   */
  private async getRecipient(
    event: NotificationEvent
  ): Promise<{ id: string; name: string; phone: string | null; type: RecipientType } | null> {
    const ticket = event.ticket;

    // Check if assigned to user
    if (ticket.assigned_to) {
      const user = await this.lookupUser(ticket.assigned_to);
      if (user) {
        return {
          ...user,
          type: RecipientType.TECHNICIAN,
        };
      }
    }

    // Check if assigned to contractor
    if (ticket.assigned_contractor_id) {
      const contractor = await this.lookupContractor(ticket.assigned_contractor_id);
      if (contractor) {
        return {
          ...contractor,
          type: RecipientType.CONTRACTOR,
        };
      }
    }

    // Check if assigned to team — use first active member as WA recipient
    if (ticket.assigned_team_id) {
      const member = await lookupFirstTeamMember(ticket.assigned_team_id);
      if (member) {
        return {
          ...member,
          type: RecipientType.TECHNICIAN,
        };
      }
    }

    return null;
  }

  /**
   * Lookup user by ID
   * 🟢 WORKING: Fetches user details from database
   */
  private async lookupUser(userId: string): Promise<UserLookup | null> {
    try {
      const user = await queryOne<UserLookup>(
        `SELECT id, first_name || ' ' || last_name AS name, phone_number AS phone FROM users WHERE id = $1`,
        [userId]
      );
      return user;
    } catch (error) {
      logger.error('Failed to lookup user', {
        error: error instanceof Error ? error.message : 'Unknown',
        userId,
      });
      return null;
    }
  }

  /**
   * Lookup contractor by ID
   * 🟢 WORKING: Fetches contractor details from database
   */
  private async lookupContractor(contractorId: string): Promise<ContractorLookup | null> {
    try {
      const contractor = await queryOne<ContractorLookup>(
        `SELECT id, company_name AS name, phone FROM contractors WHERE id = $1`,
        [contractorId]
      );
      return contractor;
    } catch (error) {
      logger.error('Failed to lookup contractor', {
        error: error instanceof Error ? error.message : 'Unknown',
        contractorId,
      });
      return null;
    }
  }

  /**
   * Check if similar notification was sent recently
   * 🟢 WORKING: Prevents duplicate notifications within time window
   */
  private async isDuplicateNotification(
    ticketId: string,
    template: NotificationUseCase
  ): Promise<boolean> {
    try {
      const windowStart = new Date(
        Date.now() - this.duplicateWindowMinutes * 60 * 1000
      );

      const existingNotification = await queryOne(
        `SELECT id
         FROM maintenance_whatsapp_notifications
         WHERE ticket_id = $1
           AND message_template = $2
           AND created_at >= $3
         LIMIT 1`,
        [ticketId, template, windowStart]
      );

      return existingNotification !== null;
    } catch (error) {
      logger.error('Failed to check for duplicate notifications', {
        error: error instanceof Error ? error.message : 'Unknown',
        ticketId,
        template,
      });
      // On error, throw to prevent sending potentially duplicate notification
      throw error;
    }
  }

  /**
   * Send notification via WhatsApp service
   * 🟢 WORKING: Constructs and sends WhatsApp notification
   */
  private async sendNotification(
    event: NotificationEvent,
    recipient: { id: string; name: string; phone: string; type: RecipientType }
  ): Promise<WhatsAppNotification> {
    const template = this.getTemplateForEvent(event.type);
    const variables = this.buildTemplateVariables(event, recipient);

    return await this.whatsappService.sendNotification({
      ticket_id: event.ticket_id,
      recipient_type: recipient.type,
      recipient_phone: recipient.phone,
      recipient_name: recipient.name,
      template_id: template,
      variables,
    });
  }

  /**
   * Build template variables for event
   * 🟢 WORKING: Constructs variable map for message templates
   */
  private buildTemplateVariables(
    event: NotificationEvent,
    recipient: { name: string }
  ): NotificationVariables {
    const ticket = event.ticket;
    const baseVariables: NotificationVariables = {
      ticket_uid: ticket.ticket_uid,
      assignee_name: recipient.name,
    };

    // Add event-specific variables
    switch (event.type) {
      case 'ticket.assigned':
        return {
          ...baseVariables,
          dr_number: ticket.dr_number || 'N/A',
          ticket_title: ticket.title,
        };

      case 'ticket.qa_rejected':
        return {
          ...baseVariables,
          rejection_reason: event.metadata?.rejection_reason || 'Please review QA feedback',
        };

      case 'ticket.closed':
        return baseVariables;

      case 'ticket.sla_warning':
        return {
          ...baseVariables,
          sla_due_time: this.formatSLADueTime(ticket.sla_due_at),
        };

      default:
        return baseVariables;
    }
  }

  /**
   * Format SLA due time for display
   * 🟢 WORKING: Formats date for WhatsApp message
   */
  private formatSLADueTime(dueAt: Date | null): string {
    if (!dueAt) {
      return 'Not set';
    }

    // Format as: "2025-12-27 15:00"
    const date = new Date(dueAt);
    return date.toLocaleString('en-ZA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a notification trigger service instance
 * 🟢 WORKING: Factory function for creating service
 *
 * @param config - Service configuration
 * @returns Configured notification trigger service
 *
 * @example
 * const service = createNotificationTriggerService({
 *   preferences: {
 *     ticket_assigned: true,
 *     qa_rejected: true,
 *     ticket_closed: false,
 *     sla_warning: true,
 *   },
 *   duplicate_prevention_window_minutes: 10,
 * });
 */
export function createNotificationTriggerService(
  config: NotificationTriggerConfig = {}
): NotificationTriggerService {
  return new NotificationTriggerService(config);
}

// ============================================================================
// Singleton Instance (Optional)
// ============================================================================

/**
 * Get the default notification trigger service instance
 * 🟢 WORKING: Lazily creates singleton with default configuration
 */
let defaultService: NotificationTriggerService | null = null;

export function getDefaultNotificationTriggerService(): NotificationTriggerService {
  if (!defaultService) {
    defaultService = createNotificationTriggerService();
  }
  return defaultService;
}

/**
 * Reset the default service (for testing)
 * 🟢 WORKING: Clears singleton for test isolation
 */
export function resetDefaultNotificationTriggerService(): void {
  defaultService = null;
}

// ============================================================================
// Helper Functions for Integration
// ============================================================================

/**
 * Trigger notification on ticket assignment
 * 🟢 WORKING: Convenience function for ticket assignment event
 *
 * @param ticket - Assigned ticket
 * @param previousStatus - Previous ticket status
 * @returns Trigger result
 *
 * @example
 * await triggerOnTicketAssignment(ticket, TicketStatus.OPEN);
 */
export async function triggerOnTicketAssignment(
  ticket: Ticket,
  previousStatus: TicketStatus
): Promise<TriggerResult> {
  // UNS: fire-and-forget in-app notification
  if (ticket.assigned_to) {
    notify({
      event_type: 'maintenance.ticket_assigned',
      title: `Ticket ${ticket.ticket_uid} assigned to you`,
      body: ticket.title || undefined,
      action_url: `/app/maintenance/tickets/${ticket.id}`,
      source_module: 'maintenance',
      source_id: ticket.id,
      recipient_user_ids: [ticket.assigned_to],
    }).catch(() => {});
  }

  const service = getDefaultNotificationTriggerService();
  return await service.handleEvent({
    type: 'ticket.assigned',
    ticket_id: ticket.id,
    ticket,
    previous_status: previousStatus,
    new_status: ticket.status,
    timestamp: new Date(),
  });
}

/**
 * Trigger notification on QA rejection
 * 🟢 WORKING: Convenience function for QA rejection event
 *
 * @param ticket - Rejected ticket
 * @param rejectionReason - Reason for rejection
 * @returns Trigger result
 *
 * @example
 * await triggerOnQARejection(ticket, 'Missing photos for steps 5 and 7');
 */
export async function triggerOnQARejection(
  ticket: Ticket,
  rejectionReason?: string
): Promise<TriggerResult> {
  // UNS: fire-and-forget in-app notification
  if (ticket.assigned_to) {
    notify({
      event_type: 'maintenance.qa_rejected',
      title: `Ticket ${ticket.ticket_uid} rejected by QA`,
      body: rejectionReason || 'Please review QA feedback',
      action_url: `/app/maintenance/tickets/${ticket.id}`,
      source_module: 'maintenance',
      source_id: ticket.id,
      recipient_user_ids: [ticket.assigned_to],
    }).catch(() => {});
  }

  const service = getDefaultNotificationTriggerService();
  return await service.handleEvent({
    type: 'ticket.qa_rejected',
    ticket_id: ticket.id,
    ticket,
    new_status: ticket.status,
    metadata: rejectionReason ? { rejection_reason: rejectionReason } : undefined,
    timestamp: new Date(),
  });
}

/**
 * Trigger notification on ticket closure
 * 🟢 WORKING: Convenience function for ticket closure event
 *
 * @param ticket - Closed ticket
 * @returns Trigger result
 *
 * @example
 * await triggerOnTicketClosure(ticket);
 */
export async function triggerOnTicketClosure(ticket: Ticket): Promise<TriggerResult> {
  // UNS: fire-and-forget in-app notification
  if (ticket.assigned_to) {
    notify({
      event_type: 'maintenance.ticket_closed',
      title: `Ticket ${ticket.ticket_uid} closed`,
      action_url: `/app/maintenance/tickets/${ticket.id}`,
      source_module: 'maintenance',
      source_id: ticket.id,
      recipient_user_ids: [ticket.assigned_to],
    }).catch(() => {});
  }

  const service = getDefaultNotificationTriggerService();
  return await service.handleEvent({
    type: 'ticket.closed',
    ticket_id: ticket.id,
    ticket,
    new_status: ticket.status,
    timestamp: new Date(),
  });
}

/**
 * Trigger notification on SLA warning
 * 🟢 WORKING: Convenience function for SLA warning event
 *
 * @param ticket - Ticket approaching SLA deadline
 * @returns Trigger result
 *
 * @example
 * await triggerOnSLAWarning(ticket);
 */
export async function triggerOnSLAWarning(ticket: Ticket): Promise<TriggerResult> {
  // UNS: fire-and-forget in-app notification
  if (ticket.assigned_to) {
    notify({
      event_type: 'maintenance.sla_warning',
      title: `SLA Warning — Ticket ${ticket.ticket_uid}`,
      body: ticket.sla_due_at
        ? `Due at ${new Date(ticket.sla_due_at).toLocaleString('en-ZA')}`
        : 'SLA deadline approaching',
      action_url: `/app/maintenance/tickets/${ticket.id}`,
      source_module: 'maintenance',
      source_id: ticket.id,
      recipient_user_ids: [ticket.assigned_to],
    }).catch(() => {});
  }

  const service = getDefaultNotificationTriggerService();
  return await service.handleEvent({
    type: 'ticket.sla_warning',
    ticket_id: ticket.id,
    ticket,
    metadata: {
      sla_due_time: ticket.sla_due_at?.toISOString(),
    },
    timestamp: new Date(),
  });
}

/**
 * Lookup first active team member (for single-recipient WA template path)
 */
async function lookupFirstTeamMember(
  teamId: string
): Promise<UserLookup | null> {
  try {
    return await queryOne<UserLookup>(
      `SELECT u.id, u.first_name || ' ' || u.last_name AS name, tm.phone
       FROM team_members tm
       JOIN users u ON LOWER(u.email) = LOWER(tm.email)
       WHERE tm.team_id = $1 AND tm.is_active = true AND tm.email IS NOT NULL
       LIMIT 1`,
      [teamId]
    );
  } catch (error) {
    logger.error('Failed to lookup team member', {
      error: error instanceof Error ? error.message : 'Unknown',
      teamId,
    });
    return null;
  }
}

/**
 * Lookup all active team members
 */
async function lookupTeamMembers(
  teamId: string
): Promise<UserLookup[]> {
  try {
    const rows = await query<UserLookup>(
      `SELECT u.id, u.first_name || ' ' || u.last_name AS name, tm.phone
       FROM team_members tm
       JOIN users u ON LOWER(u.email) = LOWER(tm.email)
       WHERE tm.team_id = $1 AND tm.is_active = true AND tm.email IS NOT NULL`,
      [teamId]
    );
    return rows;
  } catch (error) {
    logger.error('Failed to lookup team members', {
      error: error instanceof Error ? error.message : 'Unknown',
      teamId,
    });
    return [];
  }
}

/**
 * Trigger notification on ticket team assignment
 * Notifies all active members of the assigned team via in-app + WA
 *
 * @param ticket - Ticket assigned to a team
 * @returns Array of trigger results (one per member with a phone)
 */
export async function triggerOnTeamAssignment(
  ticket: Ticket
): Promise<TriggerResult[]> {
  if (!ticket.assigned_team_id) {
    return [];
  }

  const members = await lookupTeamMembers(ticket.assigned_team_id);

  if (members.length === 0) {
    logger.warn('No active team members found for team assignment notification', {
      ticket_id: ticket.id,
      team_id: ticket.assigned_team_id,
    });
    return [];
  }

  // UNS: fire-and-forget in-app notification to all members
  const memberIds = members.map((m) => m.id);
  notify({
    event_type: 'maintenance.ticket_team_assigned',
    title: `Ticket ${ticket.ticket_uid} assigned to your team`,
    body: ticket.title || undefined,
    action_url: `/app/maintenance/tickets/${ticket.id}`,
    source_module: 'maintenance',
    source_id: ticket.id,
    recipient_user_ids: memberIds,
  }).catch(() => {});

  // WA template notifications — one per member with a phone
  const service = getDefaultNotificationTriggerService();
  const results: TriggerResult[] = [];

  for (const member of members) {
    if (!member.phone) {
      results.push({
        success: true,
        notification_sent: false,
        skipped_reason: 'no_phone',
      });
      continue;
    }

    const result = await service.handleEvent({
      type: 'ticket.assigned',
      ticket_id: ticket.id,
      ticket: { ...ticket, assigned_to: member.id },
      new_status: ticket.status,
      timestamp: new Date(),
    });
    results.push(result);
  }

  logger.info('Team assignment notifications processed', {
    ticket_id: ticket.id,
    team_id: ticket.assigned_team_id,
    members_count: members.length,
    sent: results.filter((r) => r.notification_sent).length,
  });

  return results;
}
