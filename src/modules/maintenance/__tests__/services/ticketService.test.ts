/**
 * Ticket Service Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing ticket CRUD operations:
 * - Create ticket with valid data
 * - Create ticket validation (missing required fields)
 * - Get ticket by ID
 * - Get ticket - not found error
 * - Update ticket - partial updates
 * - Delete ticket - soft delete
 * - List tickets with filters (status, type, assignee)
 * - List tickets with pagination
 *
 * 🟢 WORKING: Comprehensive test suite for ticket service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createTicket,
  getTicketById,
  updateTicket,
  deleteTicket,
  listTickets
} from '../../services/ticketService';
import {
  TicketSource,
  TicketType,
  TicketPriority,
  TicketStatus,
  CreateTicketPayload,
  UpdateTicketPayload
} from '../../types/ticket';

// Mock the database utility
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn()
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}));

import { query, queryOne } from '../../utils/db';

describe('Ticket Service - CRUD Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTicket', () => {
    it('should create a ticket with valid data', async () => {
      // 🟢 WORKING: Test ticket creation with all required fields
      const payload: CreateTicketPayload = {
        source: TicketSource.AD_HOC,
        title: 'Fiber cut at Pole 123',
        ticket_type: TicketType.MAINTENANCE,
        description: 'Customer reports no internet connectivity',
        priority: TicketPriority.HIGH,
        dr_number: 'DR-2024-001',
        pole_number: 'POLE-123',
        created_by: 'user-uuid-123'
      };

      const mockCreatedTicket = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ticket_uid: 'FT406824',
        source: payload.source,
        title: payload.title,
        ticket_type: payload.ticket_type,
        description: payload.description,
        priority: payload.priority,
        status: TicketStatus.OPEN,
        dr_number: payload.dr_number,
        pole_number: payload.pole_number,
        created_by: payload.created_by,
        created_at: new Date('2024-01-15T10:00:00Z'),
        updated_at: new Date('2024-01-15T10:00:00Z'),
        qa_ready: false,
        rectification_count: 0,
        sla_breached: false,
        external_id: null,
        project_id: null,
        zone_id: null,
        pon_number: null,
        address: null,
        gps_coordinates: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_to: null,
        assigned_contractor_id: null,
        assigned_team: null,
        guarantee_status: null,
        guarantee_expires_at: null,
        is_billable: null,
        billing_classification: null,
        qa_readiness_check_at: null,
        qa_readiness_failed_reasons: null,
        fault_cause: null,
        fault_cause_details: null,
        sla_due_at: null,
        sla_first_response_at: null,
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockCreatedTicket);

      const result = await createTicket(payload);

      expect(queryOne).toHaveBeenCalled();
      const callArgs = (queryOne as any).mock.calls[0];
      expect(callArgs[0]).toContain('INSERT INTO tickets');
      expect(callArgs[1]).toContain(payload.source);
      expect(callArgs[1]).toContain(payload.title);
      expect(callArgs[1]).toContain(payload.ticket_type);
      expect(result).toEqual(mockCreatedTicket);
      expect(result.ticket_uid).toMatch(/^FT\d{6}$/); // Format: FT + 6 digits
    });

    it('should create a ticket with minimal required fields', async () => {
      // 🟢 WORKING: Test creation with only required fields
      const payload: CreateTicketPayload = {
        source: TicketSource.QCONTACT,
        title: 'Customer complaint',
        ticket_type: TicketType.MAINTENANCE
      };

      const mockCreatedTicket = {
        id: 'ticket-uuid-xyz',
        ticket_uid: 'FT406825',
        source: payload.source,
        title: payload.title,
        ticket_type: payload.ticket_type,
        priority: TicketPriority.NORMAL, // Default priority
        status: TicketStatus.OPEN,
        created_at: new Date(),
        updated_at: new Date(),
        description: null,
        external_id: null,
        project_id: null,
        zone_id: null,
        dr_number: null,
        pole_number: null,
        pon_number: null,
        address: null,
        gps_coordinates: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_to: null,
        assigned_contractor_id: null,
        assigned_team: null,
        guarantee_status: null,
        guarantee_expires_at: null,
        is_billable: null,
        billing_classification: null,
        qa_ready: false,
        qa_readiness_check_at: null,
        qa_readiness_failed_reasons: null,
        fault_cause: null,
        fault_cause_details: null,
        rectification_count: 0,
        sla_due_at: null,
        sla_first_response_at: null,
        sla_breached: false,
        created_by: null,
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockCreatedTicket);

      const result = await createTicket(payload);

      expect(result).toEqual(mockCreatedTicket);
      expect(result.priority).toBe(TicketPriority.NORMAL);
      expect(result.status).toBe(TicketStatus.OPEN);
    });

    it('should reject ticket creation without required fields', async () => {
      // 🟢 WORKING: Test validation for missing required fields
      const invalidPayload = {
        source: TicketSource.AD_HOC,
        title: 'Test ticket'
        // Missing ticket_type (required)
      } as CreateTicketPayload;

      await expect(createTicket(invalidPayload)).rejects.toThrow(
        'ticket_type is required'
      );

      expect(queryOne).not.toHaveBeenCalled();
    });

    it('should reject ticket creation with empty title', async () => {
      // 🟢 WORKING: Test validation for empty title
      const invalidPayload: CreateTicketPayload = {
        source: TicketSource.AD_HOC,
        title: '',
        ticket_type: TicketType.MAINTENANCE
      };

      await expect(createTicket(invalidPayload)).rejects.toThrow(
        'title cannot be empty'
      );

      expect(queryOne).not.toHaveBeenCalled();
    });

    it('should reject ticket creation with invalid source', async () => {
      // 🟢 WORKING: Test validation for invalid enum values
      const invalidPayload = {
        source: 'invalid_source',
        title: 'Test ticket',
        ticket_type: TicketType.MAINTENANCE
      } as CreateTicketPayload;

      await expect(createTicket(invalidPayload)).rejects.toThrow(
        'Invalid source value'
      );

      expect(queryOne).not.toHaveBeenCalled();
    });

    it('should generate unique ticket_uid with FT prefix', async () => {
      // 🟢 WORKING: Test ticket UID generation
      const payload: CreateTicketPayload = {
        source: TicketSource.AD_HOC,
        title: 'Test ticket',
        ticket_type: TicketType.MAINTENANCE
      };

      const mockCreatedTicket = {
        id: 'ticket-uuid-test',
        ticket_uid: 'FT123456',
        source: payload.source,
        title: payload.title,
        ticket_type: payload.ticket_type,
        priority: TicketPriority.NORMAL,
        status: TicketStatus.OPEN,
        created_at: new Date(),
        updated_at: new Date(),
        description: null,
        external_id: null,
        project_id: null,
        zone_id: null,
        dr_number: null,
        pole_number: null,
        pon_number: null,
        address: null,
        gps_coordinates: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_to: null,
        assigned_contractor_id: null,
        assigned_team: null,
        guarantee_status: null,
        guarantee_expires_at: null,
        is_billable: null,
        billing_classification: null,
        qa_ready: false,
        qa_readiness_check_at: null,
        qa_readiness_failed_reasons: null,
        fault_cause: null,
        fault_cause_details: null,
        rectification_count: 0,
        sla_due_at: null,
        sla_first_response_at: null,
        sla_breached: false,
        created_by: null,
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockCreatedTicket);

      const result = await createTicket(payload);

      expect(result.ticket_uid).toMatch(/^FT\d{6}$/);
      expect(result.ticket_uid.length).toBe(8); // FT + 6 digits
    });
  });

  describe('getTicketById', () => {
    it('should retrieve a ticket by ID', async () => {
      // 🟢 WORKING: Test fetching ticket by valid ID
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const mockTicket = {
        id: ticketId,
        ticket_uid: 'FT406824',
        source: TicketSource.AD_HOC,
        title: 'Test ticket',
        ticket_type: TicketType.MAINTENANCE,
        priority: TicketPriority.NORMAL,
        status: TicketStatus.OPEN,
        created_at: new Date('2024-01-15T10:00:00Z'),
        updated_at: new Date('2024-01-15T10:00:00Z'),
        description: null,
        external_id: null,
        project_id: null,
        zone_id: null,
        dr_number: null,
        pole_number: null,
        pon_number: null,
        address: null,
        gps_coordinates: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_to: null,
        assigned_contractor_id: null,
        assigned_team: null,
        guarantee_status: null,
        guarantee_expires_at: null,
        is_billable: null,
        billing_classification: null,
        qa_ready: false,
        qa_readiness_check_at: null,
        qa_readiness_failed_reasons: null,
        fault_cause: null,
        fault_cause_details: null,
        rectification_count: 0,
        sla_due_at: null,
        sla_first_response_at: null,
        sla_breached: false,
        created_by: null,
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockTicket);

      const result = await getTicketById(ticketId);

      expect(queryOne).toHaveBeenCalledWith(
        'SELECT * FROM tickets WHERE id = $1',
        [ticketId]
      );
      expect(result).toEqual(mockTicket);
    });

    it('should throw error when ticket not found', async () => {
      // 🟢 WORKING: Test error handling for non-existent ticket
      const ticketId = '999e4567-e89b-12d3-a456-426614174999';

      (queryOne as any).mockResolvedValue(null);

      await expect(getTicketById(ticketId)).rejects.toThrow(
        `Ticket with ID ${ticketId} not found`
      );

      expect(queryOne).toHaveBeenCalledWith(
        'SELECT * FROM tickets WHERE id = $1',
        [ticketId]
      );
    });

    it('should throw error for invalid UUID format', async () => {
      // 🟢 WORKING: Test validation for invalid ID format
      const invalidId = 'not-a-uuid';

      await expect(getTicketById(invalidId)).rejects.toThrow(
        'Invalid ticket ID format'
      );

      expect(queryOne).not.toHaveBeenCalled();
    });

    it('should retrieve ticket with all optional fields populated', async () => {
      // 🟢 WORKING: Test retrieval with full data
      const ticketId = '223e4567-e89b-12d3-a456-426614174001';
      const mockTicket = {
        id: ticketId,
        ticket_uid: 'FT406826',
        source: TicketSource.QCONTACT,
        external_id: 'QC-12345',
        title: 'Complete ticket',
        description: 'Full description',
        ticket_type: TicketType.MAINTENANCE,
        priority: TicketPriority.HIGH,
        status: TicketStatus.IN_PROGRESS,
        dr_number: 'DR-2024-001',
        project_id: 'project-uuid-123',
        zone_id: 'zone-uuid-456',
        pole_number: 'POLE-123',
        pon_number: 'PON-789',
        address: '123 Main St',
        gps_coordinates: { latitude: -25.7479, longitude: 28.2293 },
        ont_serial: 'ONT-SERIAL-123',
        ont_rx_level: -15.5,
        ont_model: 'HG8245Q2',
        assigned_to: 'user-uuid-789',
        assigned_contractor_id: 'contractor-uuid-456',
        assigned_team: 'Team A',
        guarantee_status: 'under_guarantee',
        guarantee_expires_at: new Date('2025-04-15T00:00:00Z'),
        is_billable: false,
        billing_classification: 'under_guarantee',
        qa_ready: true,
        qa_readiness_check_at: new Date('2024-01-15T12:00:00Z'),
        qa_readiness_failed_reasons: null,
        fault_cause: 'workmanship',
        fault_cause_details: 'Poor splice quality',
        rectification_count: 2,
        sla_due_at: new Date('2024-01-16T10:00:00Z'),
        sla_first_response_at: new Date('2024-01-15T10:30:00Z'),
        sla_breached: false,
        created_at: new Date('2024-01-15T10:00:00Z'),
        created_by: 'user-uuid-creator',
        updated_at: new Date('2024-01-15T12:00:00Z'),
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockTicket);

      const result = await getTicketById(ticketId);

      expect(result).toEqual(mockTicket);
      expect(result.external_id).toBe('QC-12345');
      expect(result.ont_rx_level).toBe(-15.5);
      expect(result.gps_coordinates).toEqual({ latitude: -25.7479, longitude: 28.2293 });
    });
  });

  describe('updateTicket', () => {
    it('should update ticket with partial data', async () => {
      // 🟢 WORKING: Test partial update (only some fields)
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const updatePayload: UpdateTicketPayload = {
        status: TicketStatus.IN_PROGRESS,
        assigned_to: 'user-uuid-123'
      };

      const mockUpdatedTicket = {
        id: ticketId,
        ticket_uid: 'FT406824',
        source: TicketSource.AD_HOC,
        title: 'Test ticket',
        ticket_type: TicketType.MAINTENANCE,
        priority: TicketPriority.NORMAL,
        status: TicketStatus.IN_PROGRESS, // Updated
        assigned_to: 'user-uuid-123', // Updated
        updated_at: new Date(),
        created_at: new Date('2024-01-15T10:00:00Z'),
        description: null,
        external_id: null,
        project_id: null,
        zone_id: null,
        dr_number: null,
        pole_number: null,
        pon_number: null,
        address: null,
        gps_coordinates: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_contractor_id: null,
        assigned_team: null,
        guarantee_status: null,
        guarantee_expires_at: null,
        is_billable: null,
        billing_classification: null,
        qa_ready: false,
        qa_readiness_check_at: null,
        qa_readiness_failed_reasons: null,
        fault_cause: null,
        fault_cause_details: null,
        rectification_count: 0,
        sla_due_at: null,
        sla_first_response_at: null,
        sla_breached: false,
        created_by: null,
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockUpdatedTicket);

      const result = await updateTicket(ticketId, updatePayload);

      expect(queryOne).toHaveBeenCalled();
      const callArgs = (queryOne as any).mock.calls[0];
      expect(callArgs[0]).toContain('UPDATE tickets');
      expect(callArgs[1]).toContain(TicketStatus.IN_PROGRESS);
      expect(callArgs[1]).toContain('user-uuid-123');
      expect(callArgs[1]).toContain(ticketId);
      expect(result.status).toBe(TicketStatus.IN_PROGRESS);
      expect(result.assigned_to).toBe('user-uuid-123');
    });

    it('should update only title field', async () => {
      // 🟢 WORKING: Test single field update
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const updatePayload: UpdateTicketPayload = {
        title: 'Updated title'
      };

      const mockUpdatedTicket = {
        id: ticketId,
        ticket_uid: 'FT406824',
        source: TicketSource.AD_HOC,
        title: 'Updated title', // Updated
        ticket_type: TicketType.MAINTENANCE,
        priority: TicketPriority.NORMAL,
        status: TicketStatus.OPEN,
        updated_at: new Date(),
        created_at: new Date('2024-01-15T10:00:00Z'),
        description: null,
        external_id: null,
        project_id: null,
        zone_id: null,
        dr_number: null,
        pole_number: null,
        pon_number: null,
        address: null,
        gps_coordinates: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_to: null,
        assigned_contractor_id: null,
        assigned_team: null,
        guarantee_status: null,
        guarantee_expires_at: null,
        is_billable: null,
        billing_classification: null,
        qa_ready: false,
        qa_readiness_check_at: null,
        qa_readiness_failed_reasons: null,
        fault_cause: null,
        fault_cause_details: null,
        rectification_count: 0,
        sla_due_at: null,
        sla_first_response_at: null,
        sla_breached: false,
        created_by: null,
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockUpdatedTicket);

      const result = await updateTicket(ticketId, updatePayload);

      expect(result.title).toBe('Updated title');
    });

    it('should throw error when updating non-existent ticket', async () => {
      // 🟢 WORKING: Test error handling for non-existent ticket
      const ticketId = '999e4567-e89b-12d3-a456-426614174999';
      const updatePayload: UpdateTicketPayload = {
        status: TicketStatus.CLOSED
      };

      (queryOne as any).mockResolvedValue(null);

      await expect(updateTicket(ticketId, updatePayload)).rejects.toThrow(
        `Ticket with ID ${ticketId} not found`
      );
    });

    it('should reject empty update payload', async () => {
      // 🟢 WORKING: Test validation for empty update
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const emptyPayload: UpdateTicketPayload = {};

      await expect(updateTicket(ticketId, emptyPayload)).rejects.toThrow(
        'Update payload cannot be empty'
      );

      expect(queryOne).not.toHaveBeenCalled();
    });

    it('should update multiple fields at once', async () => {
      // 🟢 WORKING: Test updating multiple fields
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const updatePayload: UpdateTicketPayload = {
        title: 'Updated title',
        description: 'Updated description',
        priority: TicketPriority.URGENT,
        status: TicketStatus.ASSIGNED,
        assigned_to: 'user-uuid-456',
        dr_number: 'DR-2024-002',
        pole_number: 'POLE-456'
      };

      const mockUpdatedTicket = {
        id: ticketId,
        ticket_uid: 'FT406824',
        source: TicketSource.AD_HOC,
        title: updatePayload.title!,
        description: updatePayload.description!,
        ticket_type: TicketType.MAINTENANCE,
        priority: updatePayload.priority!,
        status: updatePayload.status!,
        assigned_to: updatePayload.assigned_to!,
        dr_number: updatePayload.dr_number!,
        pole_number: updatePayload.pole_number!,
        updated_at: new Date(),
        created_at: new Date('2024-01-15T10:00:00Z'),
        external_id: null,
        project_id: null,
        zone_id: null,
        pon_number: null,
        address: null,
        gps_coordinates: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_contractor_id: null,
        assigned_team: null,
        guarantee_status: null,
        guarantee_expires_at: null,
        is_billable: null,
        billing_classification: null,
        qa_ready: false,
        qa_readiness_check_at: null,
        qa_readiness_failed_reasons: null,
        fault_cause: null,
        fault_cause_details: null,
        rectification_count: 0,
        sla_due_at: null,
        sla_first_response_at: null,
        sla_breached: false,
        created_by: null,
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockUpdatedTicket);

      const result = await updateTicket(ticketId, updatePayload);

      expect(result.title).toBe('Updated title');
      expect(result.description).toBe('Updated description');
      expect(result.priority).toBe(TicketPriority.URGENT);
      expect(result.status).toBe(TicketStatus.ASSIGNED);
      expect(result.assigned_to).toBe('user-uuid-456');
    });

    it('should automatically update updated_at timestamp', async () => {
      // 🟢 WORKING: Test that updated_at is set automatically
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const updatePayload: UpdateTicketPayload = {
        status: TicketStatus.CLOSED
      };

      const now = new Date();
      const mockUpdatedTicket = {
        id: ticketId,
        ticket_uid: 'FT406824',
        source: TicketSource.AD_HOC,
        title: 'Test ticket',
        ticket_type: TicketType.MAINTENANCE,
        priority: TicketPriority.NORMAL,
        status: TicketStatus.CLOSED,
        created_at: new Date('2024-01-15T10:00:00Z'),
        updated_at: now, // Should be updated
        description: null,
        external_id: null,
        project_id: null,
        zone_id: null,
        dr_number: null,
        pole_number: null,
        pon_number: null,
        address: null,
        gps_coordinates: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_to: null,
        assigned_contractor_id: null,
        assigned_team: null,
        guarantee_status: null,
        guarantee_expires_at: null,
        is_billable: null,
        billing_classification: null,
        qa_ready: false,
        qa_readiness_check_at: null,
        qa_readiness_failed_reasons: null,
        fault_cause: null,
        fault_cause_details: null,
        rectification_count: 0,
        sla_due_at: null,
        sla_first_response_at: null,
        sla_breached: false,
        created_by: null,
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockUpdatedTicket);

      const result = await updateTicket(ticketId, updatePayload);

      expect(queryOne).toHaveBeenCalled();
      const callArgs = (queryOne as any).mock.calls[0];
      expect(callArgs[0]).toContain('updated_at = NOW()');
      expect(result.updated_at).toBeDefined();
    });
  });

  describe('deleteTicket', () => {
    it('should soft delete a ticket (mark as cancelled)', async () => {
      // 🟢 WORKING: Test soft delete functionality
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockDeletedTicket = {
        id: ticketId,
        ticket_uid: 'FT406824',
        source: TicketSource.AD_HOC,
        title: 'Test ticket',
        ticket_type: TicketType.MAINTENANCE,
        priority: TicketPriority.NORMAL,
        status: TicketStatus.CANCELLED, // Soft deleted
        created_at: new Date('2024-01-15T10:00:00Z'),
        updated_at: new Date(),
        description: null,
        external_id: null,
        project_id: null,
        zone_id: null,
        dr_number: null,
        pole_number: null,
        pon_number: null,
        address: null,
        gps_coordinates: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_to: null,
        assigned_contractor_id: null,
        assigned_team: null,
        guarantee_status: null,
        guarantee_expires_at: null,
        is_billable: null,
        billing_classification: null,
        qa_ready: false,
        qa_readiness_check_at: null,
        qa_readiness_failed_reasons: null,
        fault_cause: null,
        fault_cause_details: null,
        rectification_count: 0,
        sla_due_at: null,
        sla_first_response_at: null,
        sla_breached: false,
        created_by: null,
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockDeletedTicket);

      const result = await deleteTicket(ticketId);

      expect(queryOne).toHaveBeenCalled();
      const callArgs = (queryOne as any).mock.calls[0];
      expect(callArgs[0]).toContain('UPDATE tickets');
      expect(callArgs[0]).toContain('SET status = $1');
      expect(callArgs[1]).toEqual([TicketStatus.CANCELLED, ticketId]);
      expect(result.status).toBe(TicketStatus.CANCELLED);
    });

    it('should throw error when deleting non-existent ticket', async () => {
      // 🟢 WORKING: Test error handling for non-existent ticket
      const ticketId = '999e4567-e89b-12d3-a456-426614174999';

      (queryOne as any).mockResolvedValue(null);

      await expect(deleteTicket(ticketId)).rejects.toThrow(
        `Ticket with ID ${ticketId} not found`
      );
    });

    it('should prevent hard delete (no actual DELETE query)', async () => {
      // 🟢 WORKING: Ensure we never actually DELETE, only UPDATE status
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockDeletedTicket = {
        id: ticketId,
        ticket_uid: 'FT406824',
        source: TicketSource.AD_HOC,
        title: 'Test ticket',
        ticket_type: TicketType.MAINTENANCE,
        priority: TicketPriority.NORMAL,
        status: TicketStatus.CANCELLED,
        created_at: new Date(),
        updated_at: new Date(),
        description: null,
        external_id: null,
        project_id: null,
        zone_id: null,
        dr_number: null,
        pole_number: null,
        pon_number: null,
        address: null,
        gps_coordinates: null,
        ont_serial: null,
        ont_rx_level: null,
        ont_model: null,
        assigned_to: null,
        assigned_contractor_id: null,
        assigned_team: null,
        guarantee_status: null,
        guarantee_expires_at: null,
        is_billable: null,
        billing_classification: null,
        qa_ready: false,
        qa_readiness_check_at: null,
        qa_readiness_failed_reasons: null,
        fault_cause: null,
        fault_cause_details: null,
        rectification_count: 0,
        sla_due_at: null,
        sla_first_response_at: null,
        sla_breached: false,
        created_by: null,
        closed_at: null,
        closed_by: null
      };

      (queryOne as any).mockResolvedValue(mockDeletedTicket);

      await deleteTicket(ticketId);

      // Verify it's an UPDATE, not DELETE
      expect(queryOne).toHaveBeenCalled();
      const callArgs = (queryOne as any).mock.calls[0];
      expect(callArgs[0]).toContain('UPDATE tickets');
      expect(callArgs[0]).not.toContain('DELETE FROM tickets');
    });
  });

  describe('listTickets', () => {
    it('should list all tickets without filters', async () => {
      // 🟢 WORKING: Test listing all tickets
      const mockTickets = [
        {
          id: 'ticket-1',
          ticket_uid: 'FT406824',
          source: TicketSource.AD_HOC,
          title: 'Ticket 1',
          ticket_type: TicketType.MAINTENANCE,
          priority: TicketPriority.NORMAL,
          status: TicketStatus.OPEN,
          created_at: new Date('2024-01-15T10:00:00Z'),
          updated_at: new Date('2024-01-15T10:00:00Z'),
          description: null,
          external_id: null,
          project_id: null,
          zone_id: null,
          dr_number: null,
          pole_number: null,
          pon_number: null,
          address: null,
          gps_coordinates: null,
          ont_serial: null,
          ont_rx_level: null,
          ont_model: null,
          assigned_to: null,
          assigned_contractor_id: null,
          assigned_team: null,
          guarantee_status: null,
          guarantee_expires_at: null,
          is_billable: null,
          billing_classification: null,
          qa_ready: false,
          qa_readiness_check_at: null,
          qa_readiness_failed_reasons: null,
          fault_cause: null,
          fault_cause_details: null,
          rectification_count: 0,
          sla_due_at: null,
          sla_first_response_at: null,
          sla_breached: false,
          created_by: null,
          closed_at: null,
          closed_by: null
        },
        {
          id: 'ticket-2',
          ticket_uid: 'FT406825',
          source: TicketSource.QCONTACT,
          title: 'Ticket 2',
          ticket_type: TicketType.INCIDENT,
          priority: TicketPriority.HIGH,
          status: TicketStatus.IN_PROGRESS,
          created_at: new Date('2024-01-16T10:00:00Z'),
          updated_at: new Date('2024-01-16T10:00:00Z'),
          description: null,
          external_id: null,
          project_id: null,
          zone_id: null,
          dr_number: null,
          pole_number: null,
          pon_number: null,
          address: null,
          gps_coordinates: null,
          ont_serial: null,
          ont_rx_level: null,
          ont_model: null,
          assigned_to: null,
          assigned_contractor_id: null,
          assigned_team: null,
          guarantee_status: null,
          guarantee_expires_at: null,
          is_billable: null,
          billing_classification: null,
          qa_ready: false,
          qa_readiness_check_at: null,
          qa_readiness_failed_reasons: null,
          fault_cause: null,
          fault_cause_details: null,
          rectification_count: 0,
          sla_due_at: null,
          sla_first_response_at: null,
          sla_breached: false,
          created_by: null,
          closed_at: null,
          closed_by: null
        }
      ];

      (query as any).mockResolvedValue(mockTickets);

      const result = await listTickets({});

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0];
      expect(callArgs[0]).toContain('SELECT * FROM tickets');
      expect(result.tickets).toEqual(mockTickets);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });

    it('should filter tickets by status', async () => {
      // 🟢 WORKING: Test filtering by status
      const mockTickets = [
        {
          id: 'ticket-1',
          ticket_uid: 'FT406824',
          source: TicketSource.AD_HOC,
          title: 'Open Ticket',
          ticket_type: TicketType.MAINTENANCE,
          priority: TicketPriority.NORMAL,
          status: TicketStatus.OPEN,
          created_at: new Date(),
          updated_at: new Date(),
          description: null,
          external_id: null,
          project_id: null,
          zone_id: null,
          dr_number: null,
          pole_number: null,
          pon_number: null,
          address: null,
          gps_coordinates: null,
          ont_serial: null,
          ont_rx_level: null,
          ont_model: null,
          assigned_to: null,
          assigned_contractor_id: null,
          assigned_team: null,
          guarantee_status: null,
          guarantee_expires_at: null,
          is_billable: null,
          billing_classification: null,
          qa_ready: false,
          qa_readiness_check_at: null,
          qa_readiness_failed_reasons: null,
          fault_cause: null,
          fault_cause_details: null,
          rectification_count: 0,
          sla_due_at: null,
          sla_first_response_at: null,
          sla_breached: false,
          created_by: null,
          closed_at: null,
          closed_by: null
        }
      ];

      (query as any).mockResolvedValue(mockTickets);

      const result = await listTickets({ status: TicketStatus.OPEN });

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0];
      expect(callArgs[0]).toContain('WHERE');
      expect(callArgs[0]).toContain('status = $1');
      expect(callArgs[1]).toContain(TicketStatus.OPEN);
      expect(result.tickets).toEqual(mockTickets);
    });

    it('should filter tickets by ticket type', async () => {
      // 🟢 WORKING: Test filtering by ticket type
      const mockTickets = [
        {
          id: 'ticket-1',
          ticket_uid: 'FT406824',
          source: TicketSource.AD_HOC,
          title: 'Maintenance Ticket',
          ticket_type: TicketType.MAINTENANCE,
          priority: TicketPriority.NORMAL,
          status: TicketStatus.OPEN,
          created_at: new Date(),
          updated_at: new Date(),
          description: null,
          external_id: null,
          project_id: null,
          zone_id: null,
          dr_number: null,
          pole_number: null,
          pon_number: null,
          address: null,
          gps_coordinates: null,
          ont_serial: null,
          ont_rx_level: null,
          ont_model: null,
          assigned_to: null,
          assigned_contractor_id: null,
          assigned_team: null,
          guarantee_status: null,
          guarantee_expires_at: null,
          is_billable: null,
          billing_classification: null,
          qa_ready: false,
          qa_readiness_check_at: null,
          qa_readiness_failed_reasons: null,
          fault_cause: null,
          fault_cause_details: null,
          rectification_count: 0,
          sla_due_at: null,
          sla_first_response_at: null,
          sla_breached: false,
          created_by: null,
          closed_at: null,
          closed_by: null
        }
      ];

      (query as any).mockResolvedValue(mockTickets);

      const result = await listTickets({ ticket_type: TicketType.MAINTENANCE });

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0];
      expect(callArgs[0]).toContain('ticket_type = $1');
      expect(callArgs[1]).toContain(TicketType.MAINTENANCE);
      expect(result.tickets).toEqual(mockTickets);
    });

    it('should filter tickets by assigned user', async () => {
      // 🟢 WORKING: Test filtering by assignee
      const assigneeId = 'user-uuid-123';
      const mockTickets = [
        {
          id: 'ticket-1',
          ticket_uid: 'FT406824',
          source: TicketSource.AD_HOC,
          title: 'Assigned Ticket',
          ticket_type: TicketType.MAINTENANCE,
          priority: TicketPriority.NORMAL,
          status: TicketStatus.ASSIGNED,
          assigned_to: assigneeId,
          created_at: new Date(),
          updated_at: new Date(),
          description: null,
          external_id: null,
          project_id: null,
          zone_id: null,
          dr_number: null,
          pole_number: null,
          pon_number: null,
          address: null,
          gps_coordinates: null,
          ont_serial: null,
          ont_rx_level: null,
          ont_model: null,
          assigned_contractor_id: null,
          assigned_team: null,
          guarantee_status: null,
          guarantee_expires_at: null,
          is_billable: null,
          billing_classification: null,
          qa_ready: false,
          qa_readiness_check_at: null,
          qa_readiness_failed_reasons: null,
          fault_cause: null,
          fault_cause_details: null,
          rectification_count: 0,
          sla_due_at: null,
          sla_first_response_at: null,
          sla_breached: false,
          created_by: null,
          closed_at: null,
          closed_by: null
        }
      ];

      (query as any).mockResolvedValue(mockTickets);

      const result = await listTickets({ assigned_to: assigneeId });

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0];
      expect(callArgs[0]).toContain('assigned_to = $1');
      expect(callArgs[1]).toContain(assigneeId);
      expect(result.tickets).toEqual(mockTickets);
    });

    it('should filter tickets with multiple criteria', async () => {
      // 🟢 WORKING: Test filtering with multiple filters
      const mockTickets = [
        {
          id: 'ticket-1',
          ticket_uid: 'FT406824',
          source: TicketSource.AD_HOC,
          title: 'Filtered Ticket',
          ticket_type: TicketType.MAINTENANCE,
          priority: TicketPriority.HIGH,
          status: TicketStatus.IN_PROGRESS,
          assigned_to: 'user-uuid-123',
          created_at: new Date(),
          updated_at: new Date(),
          description: null,
          external_id: null,
          project_id: null,
          zone_id: null,
          dr_number: null,
          pole_number: null,
          pon_number: null,
          address: null,
          gps_coordinates: null,
          ont_serial: null,
          ont_rx_level: null,
          ont_model: null,
          assigned_contractor_id: null,
          assigned_team: null,
          guarantee_status: null,
          guarantee_expires_at: null,
          is_billable: null,
          billing_classification: null,
          qa_ready: false,
          qa_readiness_check_at: null,
          qa_readiness_failed_reasons: null,
          fault_cause: null,
          fault_cause_details: null,
          rectification_count: 0,
          sla_due_at: null,
          sla_first_response_at: null,
          sla_breached: false,
          created_by: null,
          closed_at: null,
          closed_by: null
        }
      ];

      (query as any).mockResolvedValue(mockTickets);

      const result = await listTickets({
        status: TicketStatus.IN_PROGRESS,
        ticket_type: TicketType.MAINTENANCE,
        assigned_to: 'user-uuid-123'
      });

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0];
      expect(callArgs[0]).toContain('WHERE');
      expect(callArgs[1]).toContain(TicketStatus.IN_PROGRESS);
      expect(callArgs[1]).toContain(TicketType.MAINTENANCE);
      expect(callArgs[1]).toContain('user-uuid-123');
      expect(result.tickets).toEqual(mockTickets);
    });

    it('should support pagination with page and pageSize', async () => {
      // 🟢 WORKING: Test pagination
      const mockTickets = [
        {
          id: 'ticket-3',
          ticket_uid: 'FT406826',
          source: TicketSource.AD_HOC,
          title: 'Ticket 3',
          ticket_type: TicketType.MAINTENANCE,
          priority: TicketPriority.NORMAL,
          status: TicketStatus.OPEN,
          created_at: new Date(),
          updated_at: new Date(),
          description: null,
          external_id: null,
          project_id: null,
          zone_id: null,
          dr_number: null,
          pole_number: null,
          pon_number: null,
          address: null,
          gps_coordinates: null,
          ont_serial: null,
          ont_rx_level: null,
          ont_model: null,
          assigned_to: null,
          assigned_contractor_id: null,
          assigned_team: null,
          guarantee_status: null,
          guarantee_expires_at: null,
          is_billable: null,
          billing_classification: null,
          qa_ready: false,
          qa_readiness_check_at: null,
          qa_readiness_failed_reasons: null,
          fault_cause: null,
          fault_cause_details: null,
          rectification_count: 0,
          sla_due_at: null,
          sla_first_response_at: null,
          sla_breached: false,
          created_by: null,
          closed_at: null,
          closed_by: null
        }
      ];

      (query as any).mockResolvedValue(mockTickets);

      const result = await listTickets({ page: 2, pageSize: 10 });

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0];
      expect(callArgs[0]).toContain('LIMIT');
      expect(callArgs[0]).toContain('OFFSET');
      // Page 2 with pageSize 10 = OFFSET 10
      expect(callArgs[1]).toContain(10); // Both limit and offset are 10
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });

    it('should use default pagination (page 1, pageSize 50)', async () => {
      // 🟢 WORKING: Test default pagination values
      const mockTickets = [];

      (query as any).mockResolvedValue(mockTickets);

      const result = await listTickets({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0];
      expect(callArgs[0]).toContain('LIMIT');
      expect(callArgs[0]).toContain('OFFSET');
      expect(callArgs[1]).toContain(50); // Default page size
      expect(callArgs[1]).toContain(0);  // Page 1 offset
    });

    it('should order tickets by created_at DESC by default', async () => {
      // 🟢 WORKING: Test default ordering (newest first)
      const mockTickets = [];

      (query as any).mockResolvedValue(mockTickets);

      await listTickets({});

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0];
      expect(callArgs[0]).toContain('ORDER BY created_at DESC');
    });

    it('should return empty array when no tickets found', async () => {
      // 🟢 WORKING: Test empty result set
      (query as any).mockResolvedValue([]);

      const result = await listTickets({});

      expect(result.tickets).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
