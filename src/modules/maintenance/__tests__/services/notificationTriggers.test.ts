/**
 * Notification Triggers Service Tests
 * TDD: Tests written FIRST before implementation
 *
 * Test Coverage:
 * - Trigger on ticket assignment
 * - Trigger on QA rejection
 * - Trigger on ticket closure
 * - Trigger on SLA warning
 * - No duplicate notifications
 * - Notification preferences respected
 * - Batch event processing
 * - Error handling and recovery
 *
 * 🟢 WORKING: Comprehensive test suite for automatic WhatsApp notification triggers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock database
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

// Mock WhatsApp service
vi.mock('../../services/whatsappService', () => ({
  getDefaultWhatsAppService: vi.fn(),
}));

// Import types
import type { Ticket } from '../../types/ticket';
import { TicketStatus, TicketPriority, TicketType, TicketSource } from '../../types/ticket';
import type { WhatsAppNotification } from '../../types/whatsapp';
import { RecipientType, NotificationStatus, NotificationUseCase } from '../../types/whatsapp';

// Import the database mocks
import { query, queryOne } from '../../utils/db';

// Import WhatsApp service mock
import { getDefaultWhatsAppService } from '../../services/whatsappService';

// Import the service under test
import {
  NotificationTriggerService,
  createNotificationTriggerService,
  type NotificationEvent,
  type NotificationEventType,
  type NotificationPreferences,
  type TriggerResult,
} from '../../services/notificationTriggers';

describe('NotificationTriggerService', () => {
  let service: NotificationTriggerService;
  let mockWhatsAppService: any;
  const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
  const mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
  const mockGetDefaultWhatsAppService = getDefaultWhatsAppService as unknown as ReturnType<typeof vi.fn>;

  // Sample ticket data
  const sampleTicket: Ticket = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    ticket_uid: 'FT406824',
    source: TicketSource.MANUAL,
    external_id: null,
    title: 'Fiber installation required',
    description: 'Customer needs fiber installation at DR12345',
    ticket_type: TicketType.NEW_INSTALLATION,
    priority: TicketPriority.NORMAL,
    status: TicketStatus.ASSIGNED,
    dr_number: 'DR12345',
    project_id: 'proj-123',
    zone_id: 'zone-456',
    pole_number: 'POLE-789',
    pon_number: 'PON-101',
    address: '123 Main Street',
    gps_coordinates: null,
    ont_serial: null,
    ont_rx_level: null,
    ont_model: null,
    assigned_to: 'user-123',
    assigned_contractor_id: 'contractor-456',
    assigned_team: 'Team A',
    guarantee_status: null,
    guarantee_expires_at: null,
    is_billable: false,
    billing_classification: null,
    qa_ready: false,
    qa_readiness_check_at: null,
    qa_readiness_failed_reasons: null,
    fault_cause: null,
    fault_cause_details: null,
    rectification_count: 0,
    sla_due_at: new Date(Date.now() + 86400000), // 24 hours from now
    sla_first_response_at: null,
    sla_breached: false,
    created_at: new Date(),
    created_by: 'creator-123',
    updated_at: new Date(),
    closed_at: null,
    closed_by: null,
  };

  // Sample user/assignee data
  const sampleAssignee = {
    id: 'user-123',
    name: 'John Technician',
    phone: '+27821234567',
  };

  // Sample contractor data
  const sampleContractor = {
    id: 'contractor-456',
    name: 'ABC Contractors',
    phone: '+27827654321',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock WhatsApp service
    mockWhatsAppService = {
      sendNotification: vi.fn().mockResolvedValue({
        id: 'notif-123',
        status: NotificationStatus.SENT,
      } as WhatsAppNotification),
    };

    mockGetDefaultWhatsAppService.mockReturnValue(mockWhatsAppService);

    service = createNotificationTriggerService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to mock user lookup
  const mockUserLookup = (user: any) => {
    mockQueryOne.mockResolvedValueOnce(user);
  };

  // Helper to mock contractor lookup
  const mockContractorLookup = (contractor: any) => {
    mockQueryOne.mockResolvedValueOnce(contractor);
  };

  // Helper to mock duplicate check (no duplicates)
  const mockNoDuplicates = () => {
    mockQueryOne.mockResolvedValueOnce(null);
  };

  // Helper to mock duplicate check (duplicate exists)
  const mockDuplicateExists = () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'existing-notif-123',
      ticket_id: sampleTicket.id,
    });
  };

  describe('Ticket Assignment Trigger', () => {
    it('should send notification when ticket is assigned to technician', async () => {
      const event: NotificationEvent = {
        type: 'ticket.assigned',
        ticket_id: sampleTicket.id,
        ticket: sampleTicket,
        previous_status: TicketStatus.OPEN,
        new_status: TicketStatus.ASSIGNED,
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);
      mockNoDuplicates();

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(true);
      expect(mockWhatsAppService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: sampleTicket.id,
          recipient_type: RecipientType.TECHNICIAN,
          recipient_phone: sampleAssignee.phone,
          recipient_name: sampleAssignee.name,
          template_id: NotificationUseCase.TICKET_ASSIGNED,
          variables: expect.objectContaining({
            ticket_uid: sampleTicket.ticket_uid,
            assignee_name: sampleAssignee.name,
            dr_number: sampleTicket.dr_number,
            ticket_title: sampleTicket.title,
          }),
        })
      );
    });

    it('should send notification when ticket is assigned to contractor', async () => {
      const ticketWithContractor = {
        ...sampleTicket,
        assigned_to: null,
        assigned_contractor_id: 'contractor-456',
      };

      const event: NotificationEvent = {
        type: 'ticket.assigned',
        ticket_id: ticketWithContractor.id,
        ticket: ticketWithContractor,
        previous_status: TicketStatus.OPEN,
        new_status: TicketStatus.ASSIGNED,
        timestamp: new Date(),
      };

      mockContractorLookup(sampleContractor);
      mockNoDuplicates();

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(true);
      expect(mockWhatsAppService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient_type: RecipientType.CONTRACTOR,
          recipient_phone: sampleContractor.phone,
          recipient_name: sampleContractor.name,
        })
      );
    });

    it('should NOT send duplicate notification if already sent recently', async () => {
      const event: NotificationEvent = {
        type: 'ticket.assigned',
        ticket_id: sampleTicket.id,
        ticket: sampleTicket,
        previous_status: TicketStatus.OPEN,
        new_status: TicketStatus.ASSIGNED,
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);
      mockDuplicateExists();

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(false);
      expect(result.skipped_reason).toBe('duplicate');
      expect(mockWhatsAppService.sendNotification).not.toHaveBeenCalled();
    });

    it('should not send notification if assignee has no phone number', async () => {
      const event: NotificationEvent = {
        type: 'ticket.assigned',
        ticket_id: sampleTicket.id,
        ticket: sampleTicket,
        previous_status: TicketStatus.OPEN,
        new_status: TicketStatus.ASSIGNED,
        timestamp: new Date(),
      };

      mockUserLookup({ ...sampleAssignee, phone: null });

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(false);
      expect(result.skipped_reason).toBe('no_phone');
      expect(mockWhatsAppService.sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('QA Rejection Trigger', () => {
    it('should send notification when ticket is rejected by QA', async () => {
      const rejectedTicket = {
        ...sampleTicket,
        status: TicketStatus.QA_REJECTED,
      };

      const event: NotificationEvent = {
        type: 'ticket.qa_rejected',
        ticket_id: rejectedTicket.id,
        ticket: rejectedTicket,
        previous_status: TicketStatus.QA_IN_PROGRESS,
        new_status: TicketStatus.QA_REJECTED,
        metadata: {
          rejection_reason: 'Missing photos for steps 5 and 7',
        },
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);
      mockNoDuplicates();

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(true);
      expect(mockWhatsAppService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: rejectedTicket.id,
          recipient_type: RecipientType.TECHNICIAN,
          template_id: NotificationUseCase.QA_REJECTED,
          variables: expect.objectContaining({
            ticket_uid: rejectedTicket.ticket_uid,
            assignee_name: sampleAssignee.name,
            rejection_reason: 'Missing photos for steps 5 and 7',
          }),
        })
      );
    });

    it('should use default rejection reason if not provided', async () => {
      const rejectedTicket = {
        ...sampleTicket,
        status: TicketStatus.QA_REJECTED,
      };

      const event: NotificationEvent = {
        type: 'ticket.qa_rejected',
        ticket_id: rejectedTicket.id,
        ticket: rejectedTicket,
        previous_status: TicketStatus.QA_IN_PROGRESS,
        new_status: TicketStatus.QA_REJECTED,
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);
      mockNoDuplicates();

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(mockWhatsAppService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: expect.objectContaining({
            rejection_reason: expect.any(String),
          }),
        })
      );
    });
  });

  describe('Ticket Closure Trigger', () => {
    it('should send notification when ticket is closed', async () => {
      const closedTicket = {
        ...sampleTicket,
        status: TicketStatus.CLOSED,
        closed_at: new Date(),
      };

      const event: NotificationEvent = {
        type: 'ticket.closed',
        ticket_id: closedTicket.id,
        ticket: closedTicket,
        previous_status: TicketStatus.HANDED_TO_MAINTENANCE,
        new_status: TicketStatus.CLOSED,
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);
      mockNoDuplicates();

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(true);
      expect(mockWhatsAppService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: closedTicket.id,
          recipient_type: RecipientType.TECHNICIAN,
          template_id: NotificationUseCase.TICKET_CLOSED,
          variables: expect.objectContaining({
            ticket_uid: closedTicket.ticket_uid,
            assignee_name: sampleAssignee.name,
          }),
        })
      );
    });
  });

  describe('SLA Warning Trigger', () => {
    it('should send notification when SLA is approaching', async () => {
      const slaWarningTicket = {
        ...sampleTicket,
        sla_due_at: new Date(Date.now() + 3600000), // 1 hour from now
      };

      const event: NotificationEvent = {
        type: 'ticket.sla_warning',
        ticket_id: slaWarningTicket.id,
        ticket: slaWarningTicket,
        metadata: {
          sla_due_time: slaWarningTicket.sla_due_at?.toISOString(),
        },
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);
      mockNoDuplicates();

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(true);
      expect(mockWhatsAppService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: slaWarningTicket.id,
          recipient_type: RecipientType.TECHNICIAN,
          template_id: NotificationUseCase.SLA_WARNING,
          variables: expect.objectContaining({
            ticket_uid: slaWarningTicket.ticket_uid,
            assignee_name: sampleAssignee.name,
            sla_due_time: expect.any(String),
          }),
        })
      );
    });
  });

  describe('Notification Preferences', () => {
    it('should respect notification preferences when provided', async () => {
      const preferences: NotificationPreferences = {
        ticket_assigned: false, // Disabled
        qa_rejected: true,
        ticket_closed: true,
        sla_warning: true,
      };

      const serviceWithPrefs = createNotificationTriggerService({
        preferences,
      });

      const event: NotificationEvent = {
        type: 'ticket.assigned',
        ticket_id: sampleTicket.id,
        ticket: sampleTicket,
        previous_status: TicketStatus.OPEN,
        new_status: TicketStatus.ASSIGNED,
        timestamp: new Date(),
      };

      const result = await serviceWithPrefs.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(false);
      expect(result.skipped_reason).toBe('disabled_by_preferences');
      expect(mockWhatsAppService.sendNotification).not.toHaveBeenCalled();
    });

    it('should send notification when preference is enabled', async () => {
      const preferences: NotificationPreferences = {
        ticket_assigned: true,
        qa_rejected: true,
        ticket_closed: true,
        sla_warning: true,
      };

      const serviceWithPrefs = createNotificationTriggerService({
        preferences,
      });

      const event: NotificationEvent = {
        type: 'ticket.assigned',
        ticket_id: sampleTicket.id,
        ticket: sampleTicket,
        previous_status: TicketStatus.OPEN,
        new_status: TicketStatus.ASSIGNED,
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);
      mockNoDuplicates();

      const result = await serviceWithPrefs.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(true);
    });
  });

  describe('Batch Event Processing', () => {
    it('should process multiple events in batch', async () => {
      const events: NotificationEvent[] = [
        {
          type: 'ticket.assigned',
          ticket_id: sampleTicket.id,
          ticket: sampleTicket,
          previous_status: TicketStatus.OPEN,
          new_status: TicketStatus.ASSIGNED,
          timestamp: new Date(),
        },
        {
          type: 'ticket.assigned',
          ticket_id: '223e4567-e89b-12d3-a456-426614174001',
          ticket: { ...sampleTicket, id: '223e4567-e89b-12d3-a456-426614174001' },
          previous_status: TicketStatus.OPEN,
          new_status: TicketStatus.ASSIGNED,
          timestamp: new Date(),
        },
      ];

      // Mock lookups for both events
      mockUserLookup(sampleAssignee);
      mockNoDuplicates();
      mockUserLookup(sampleAssignee);
      mockNoDuplicates();

      const results = await service.handleBatchEvents(events);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(mockWhatsAppService.sendNotification).toHaveBeenCalledTimes(2);
    });

    it('should handle partial failures in batch processing', async () => {
      const events: NotificationEvent[] = [
        {
          type: 'ticket.assigned',
          ticket_id: sampleTicket.id,
          ticket: sampleTicket,
          previous_status: TicketStatus.OPEN,
          new_status: TicketStatus.ASSIGNED,
          timestamp: new Date(),
        },
        {
          type: 'ticket.assigned',
          ticket_id: '223e4567-e89b-12d3-a456-426614174001',
          ticket: { ...sampleTicket, id: '223e4567-e89b-12d3-a456-426614174001' },
          previous_status: TicketStatus.OPEN,
          new_status: TicketStatus.ASSIGNED,
          timestamp: new Date(),
        },
      ];

      // First succeeds, second fails
      mockUserLookup(sampleAssignee);
      mockNoDuplicates();
      mockUserLookup(null); // User not found

      const results = await service.handleBatchEvents(events);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].notification_sent).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[1].notification_sent).toBe(false);
      expect(results[1].skipped_reason).toBe('assignee_not_found');
    });
  });

  describe('Error Handling', () => {
    it('should handle WhatsApp service errors gracefully', async () => {
      const event: NotificationEvent = {
        type: 'ticket.assigned',
        ticket_id: sampleTicket.id,
        ticket: sampleTicket,
        previous_status: TicketStatus.OPEN,
        new_status: TicketStatus.ASSIGNED,
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);
      mockNoDuplicates();
      mockWhatsAppService.sendNotification.mockRejectedValueOnce(
        new Error('WhatsApp service unavailable')
      );

      const result = await service.handleEvent(event);

      expect(result.success).toBe(false);
      expect(result.notification_sent).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle database errors during duplicate check', async () => {
      const event: NotificationEvent = {
        type: 'ticket.assigned',
        ticket_id: sampleTicket.id,
        ticket: sampleTicket,
        previous_status: TicketStatus.OPEN,
        new_status: TicketStatus.ASSIGNED,
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);
      mockQueryOne.mockRejectedValueOnce(new Error('Database connection lost'));

      const result = await service.handleEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle unknown event types gracefully', async () => {
      const event: NotificationEvent = {
        type: 'ticket.unknown_event' as any,
        ticket_id: sampleTicket.id,
        ticket: sampleTicket,
        timestamp: new Date(),
      };

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(false);
      expect(result.skipped_reason).toBe('unsupported_event_type');
    });
  });

  describe('Duplicate Prevention', () => {
    it('should prevent duplicate notifications within time window', async () => {
      const event: NotificationEvent = {
        type: 'ticket.assigned',
        ticket_id: sampleTicket.id,
        ticket: sampleTicket,
        previous_status: TicketStatus.OPEN,
        new_status: TicketStatus.ASSIGNED,
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);

      // Mock recent notification (within last 5 minutes)
      mockQueryOne.mockResolvedValueOnce({
        id: 'recent-notif-123',
        ticket_id: sampleTicket.id,
        message_template: NotificationUseCase.TICKET_ASSIGNED,
        created_at: new Date(Date.now() - 60000), // 1 minute ago
      });

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(false);
      expect(result.skipped_reason).toBe('duplicate');
    });

    it('should allow notification if previous was outside time window', async () => {
      const event: NotificationEvent = {
        type: 'ticket.assigned',
        ticket_id: sampleTicket.id,
        ticket: sampleTicket,
        previous_status: TicketStatus.OPEN,
        new_status: TicketStatus.ASSIGNED,
        timestamp: new Date(),
      };

      mockUserLookup(sampleAssignee);

      // Mock old notification (outside time window)
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await service.handleEvent(event);

      expect(result.success).toBe(true);
      expect(result.notification_sent).toBe(true);
    });
  });

  describe('Service Configuration', () => {
    it('should create service with default configuration', () => {
      const defaultService = createNotificationTriggerService();
      expect(defaultService).toBeDefined();
      expect(defaultService).toBeInstanceOf(NotificationTriggerService);
    });

    it('should create service with custom duplicate prevention window', () => {
      const customService = createNotificationTriggerService({
        duplicate_prevention_window_minutes: 10,
      });
      expect(customService).toBeDefined();
    });

    it('should create service with custom preferences', () => {
      const customService = createNotificationTriggerService({
        preferences: {
          ticket_assigned: true,
          qa_rejected: false,
          ticket_closed: true,
          sla_warning: true,
        },
      });
      expect(customService).toBeDefined();
    });
  });
});
