/**
 * Escalation Service Tests
 * 🟢 WORKING: Comprehensive test suite for escalation service (TDD)
 *
 * Tests written FIRST before implementation
 * Coverage target: 90%+
 *
 * Test scenarios:
 * - Create escalation record
 * - Create infrastructure ticket for escalation
 * - Link contributing tickets to escalation
 * - List active escalations with filters
 * - Resolve escalation
 * - Update escalation status
 * - Get escalation by ID
 * - Prevent duplicate escalations
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as escalationService from '../../services/escalationService';
import * as ticketService from '../../services/ticketService';
import * as db from '../../utils/db';
import {
  EscalationScopeType,
  EscalationStatus,
  EscalationType,
  CreateEscalationPayload,
  ResolveEscalationPayload,
} from '../../types/escalation';
import { TicketSource, TicketType } from '../../types/ticket';

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock database
vi.mock('../../utils/db');

// Mock ticket service
vi.mock('../../services/ticketService');

describe('EscalationService (TDD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createEscalation', () => {
    it('should create escalation record with valid data', async () => {
      // Arrange
      const payload: CreateEscalationPayload = {
        scope_type: EscalationScopeType.POLE,
        scope_value: 'POLE-123',
        project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        fault_count: 5,
        fault_threshold: 3,
        contributing_tickets: ['ticket-1', 'ticket-2', 'ticket-3'],
        escalation_type: EscalationType.INVESTIGATION,
      };

      const mockEscalation = {
        id: '11111111-1111-1111-1111-111111111111',
        scope_type: 'pole',
        scope_value: 'POLE-123',
        project_id: '22222222-2222-2222-2222-222222222222',
        fault_count: 5,
        fault_threshold: 3,
        contributing_tickets: ['33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555'],
        escalation_ticket_id: null,
        escalation_type: 'investigation',
        status: 'open',
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date('2024-01-15T10:00:00Z'),
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockEscalation);

      // Act
      const result = await escalationService.createEscalation(payload);

      // Assert
      expect(result).toEqual(mockEscalation);
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO repeat_fault_escalations'),
        expect.arrayContaining([
          'pole',
          'POLE-123',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          5,
          3,
          JSON.stringify(['ticket-1', 'ticket-2', 'ticket-3']),
          'investigation',
        ])
      );
    });

    it('should create escalation without project_id', async () => {
      // Arrange
      const payload: CreateEscalationPayload = {
        scope_type: EscalationScopeType.PON,
        scope_value: 'PON-456',
        fault_count: 6,
        fault_threshold: 5,
        contributing_tickets: ['ticket-4', 'ticket-5'],
      };

      const mockEscalation = {
        id: '22222222-2222-2222-2222-222222222222',
        scope_type: 'pon',
        scope_value: 'PON-456',
        project_id: null,
        fault_count: 6,
        fault_threshold: 5,
        contributing_tickets: ['ticket-4', 'ticket-5'],
        escalation_ticket_id: null,
        escalation_type: null,
        status: 'open',
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date('2024-01-15T10:00:00Z'),
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockEscalation);

      // Act
      const result = await escalationService.createEscalation(payload);

      // Assert
      expect(result).toEqual(mockEscalation);
      expect(result.project_id).toBeNull();
    });

    it('should validate required fields', async () => {
      // Arrange - missing scope_value
      const invalidPayload = {
        scope_type: EscalationScopeType.POLE,
        scope_value: '',
        fault_count: 5,
        fault_threshold: 3,
        contributing_tickets: ['ticket-1'],
      } as CreateEscalationPayload;

      // Act & Assert
      await expect(escalationService.createEscalation(invalidPayload)).rejects.toThrow(
        'scope_value is required'
      );
    });

    it('should validate contributing_tickets is non-empty array', async () => {
      // Arrange
      const invalidPayload = {
        scope_type: EscalationScopeType.POLE,
        scope_value: 'POLE-123',
        fault_count: 5,
        fault_threshold: 3,
        contributing_tickets: [],
      } as CreateEscalationPayload;

      // Act & Assert
      await expect(escalationService.createEscalation(invalidPayload)).rejects.toThrow(
        'contributing_tickets must be a non-empty array'
      );
    });

    it('should set default status to open', async () => {
      // Arrange
      const payload: CreateEscalationPayload = {
        scope_type: EscalationScopeType.ZONE,
        scope_value: 'ZONE-789',
        fault_count: 12,
        fault_threshold: 10,
        contributing_tickets: ['ticket-6'],
      };

      const mockEscalation = {
        id: '33333333-3333-3333-3333-333333333333',
        status: 'open',
        scope_type: 'zone',
        scope_value: 'ZONE-789',
        project_id: null,
        fault_count: 12,
        fault_threshold: 10,
        contributing_tickets: ['ticket-6'],
        escalation_ticket_id: null,
        escalation_type: null,
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockEscalation);

      // Act
      const result = await escalationService.createEscalation(payload);

      // Assert
      expect(result.status).toBe('open');
    });
  });

  describe('createInfrastructureTicket', () => {
    it('should create infrastructure ticket and link to escalation', async () => {
      // Arrange
      const escalationId = '11111111-1111-1111-1111-111111111111';
      const mockEscalation = {
        id: escalationId,
        scope_type: 'pole',
        scope_value: 'POLE-123',
        project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        fault_count: 5,
        fault_threshold: 3,
        contributing_tickets: ['ticket-1', 'ticket-2'],
        escalation_ticket_id: null,
        escalation_type: 'investigation',
        status: 'open',
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date(),
      };

      const mockTicket = {
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        ticket_uid: 'FT123456',
        title: 'Infrastructure Investigation: Pole POLE-123',
        description: expect.stringContaining('5 repeat faults detected'),
        ticket_type: 'maintenance',
        source: 'construction',
        priority: 'high',
        status: 'open',
        project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        pole_number: 'POLE-123',
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(mockEscalation) // getEscalationById
        .mockResolvedValueOnce({ ...mockEscalation, escalation_ticket_id: mockTicket.id }); // update

      vi.mocked(ticketService.createTicket).mockResolvedValue(mockTicket as any);

      // Act
      const result = await escalationService.createInfrastructureTicket(
        escalationId,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      );

      // Assert
      expect(result.infrastructure_ticket).toEqual(mockTicket);
      expect(result.escalation.escalation_ticket_id).toBe(mockTicket.id);
      expect(ticketService.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('POLE-123'),
          ticket_type: 'maintenance',
          source: 'construction',
          priority: 'high',
        })
      );
    });

    it('should generate appropriate title for PON escalation', async () => {
      // Arrange
      const escalationId = '22222222-2222-2222-2222-222222222222';
      const mockEscalation = {
        id: escalationId,
        scope_type: 'pon',
        scope_value: 'PON-456',
        project_id: null,
        fault_count: 7,
        fault_threshold: 5,
        contributing_tickets: ['ticket-3'],
        escalation_ticket_id: null,
        escalation_type: 'inspection',
        status: 'open',
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date(),
      };

      const mockTicket = {
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        ticket_uid: 'FT234567',
        title: 'PON Inspection: PON-456',
        pon_number: 'PON-456',
      };

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(mockEscalation)
        .mockResolvedValueOnce({ ...mockEscalation, escalation_ticket_id: mockTicket.id });

      vi.mocked(ticketService.createTicket).mockResolvedValue(mockTicket as any);

      // Act
      await escalationService.createInfrastructureTicket(escalationId, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

      // Assert
      expect(ticketService.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('PON-456'),
          pon_number: 'PON-456',
        })
      );
    });

    it('should throw error if escalation already has infrastructure ticket', async () => {
      // Arrange
      const escalationId = '11111111-1111-1111-1111-111111111111';
      const mockEscalation = {
        id: escalationId,
        escalation_ticket_id: 'existing-ticket-id',
        scope_type: 'pole',
        scope_value: 'POLE-123',
        project_id: null,
        fault_count: 5,
        fault_threshold: 3,
        contributing_tickets: ['ticket-1'],
        escalation_type: null,
        status: 'open',
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockEscalation);

      // Act & Assert
      await expect(
        escalationService.createInfrastructureTicket(escalationId, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
      ).rejects.toThrow('Infrastructure ticket already exists for this escalation');
    });

    it('should throw error if escalation not found', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValue(null);

      // Act & Assert
      await expect(
        escalationService.createInfrastructureTicket('99999999-9999-9999-9999-999999999999', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
      ).rejects.toThrow('Escalation not found');
    });
  });

  describe('getEscalationById', () => {
    it('should retrieve escalation by ID', async () => {
      // Arrange
      const mockEscalation = {
        id: '11111111-1111-1111-1111-111111111111',
        scope_type: 'pole',
        scope_value: 'POLE-123',
        project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        fault_count: 5,
        fault_threshold: 3,
        contributing_tickets: ['ticket-1', 'ticket-2'],
        escalation_ticket_id: null,
        escalation_type: 'investigation',
        status: 'open',
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date('2024-01-15T10:00:00Z'),
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockEscalation);

      // Act
      const result = await escalationService.getEscalationById('11111111-1111-1111-1111-111111111111');

      // Assert
      expect(result).toEqual(mockEscalation);
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM repeat_fault_escalations'),
        ['11111111-1111-1111-1111-111111111111']
      );
    });

    it('should throw error if escalation not found', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValue(null);

      // Act & Assert
      await expect(escalationService.getEscalationById('99999999-9999-9999-9999-999999999999')).rejects.toThrow(
        'Escalation not found'
      );
    });

    it('should validate UUID format', async () => {
      // Act & Assert
      await expect(escalationService.getEscalationById('not-a-uuid')).rejects.toThrow(
        'Invalid escalation ID format'
      );
    });
  });

  describe('listEscalations', () => {
    it('should list all escalations when no filters provided', async () => {
      // Arrange
      const mockEscalations = [
        {
          id: 'escalation-1',
          scope_type: 'pole',
          scope_value: 'POLE-123',
          status: 'open',
          fault_count: 5,
          created_at: new Date(),
        },
        {
          id: 'escalation-2',
          scope_type: 'pon',
          scope_value: 'PON-456',
          status: 'investigating',
          fault_count: 7,
          created_at: new Date(),
        },
      ];

      vi.mocked(db.query).mockResolvedValue(mockEscalations as any);

      // Act
      const result = await escalationService.listEscalations();

      // Assert
      expect(result).toHaveLength(2);
      expect(result).toEqual(mockEscalations);
    });

    it('should filter by scope_type', async () => {
      // Arrange
      const mockEscalations = [
        {
          id: 'escalation-1',
          scope_type: 'pole',
          scope_value: 'POLE-123',
          status: 'open',
        },
      ];

      vi.mocked(db.query).mockResolvedValue(mockEscalations as any);

      // Act
      const result = await escalationService.listEscalations({
        scope_type: EscalationScopeType.POLE,
      });

      // Assert
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE scope_type = $1'),
        expect.arrayContaining(['pole'])
      );
    });

    it('should filter by status', async () => {
      // Arrange
      const mockEscalations = [
        {
          id: 'escalation-1',
          scope_type: 'pole',
          scope_value: 'POLE-123',
          status: 'open',
        },
      ];

      vi.mocked(db.query).mockResolvedValue(mockEscalations as any);

      // Act
      const result = await escalationService.listEscalations({
        status: EscalationStatus.OPEN,
      });

      // Assert
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $1'),
        expect.arrayContaining(['open'])
      );
    });

    it('should filter by multiple statuses', async () => {
      // Arrange
      vi.mocked(db.query).mockResolvedValue([]);

      // Act
      await escalationService.listEscalations({
        status: [EscalationStatus.OPEN, EscalationStatus.INVESTIGATING],
      });

      // Assert
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('open','investigating')"),
        expect.any(Array)
      );
    });

    it('should filter by project_id', async () => {
      // Arrange
      vi.mocked(db.query).mockResolvedValue([]);

      // Act
      await escalationService.listEscalations({
        project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      });

      // Assert
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('project_id = $'),
        expect.arrayContaining(['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'])
      );
    });

    it('should return empty array when no escalations found', async () => {
      // Arrange
      vi.mocked(db.query).mockResolvedValue([]);

      // Act
      const result = await escalationService.listEscalations();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('resolveEscalation', () => {
    it('should resolve escalation with resolution notes', async () => {
      // Arrange
      const escalationId = '11111111-1111-1111-1111-111111111111';
      const payload: ResolveEscalationPayload = {
        resolved_by: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        resolution_notes: 'Pole replaced, issue resolved',
        status: EscalationStatus.RESOLVED,
      };

      const mockResolvedEscalation = {
        id: escalationId,
        scope_type: 'pole',
        scope_value: 'POLE-123',
        project_id: null,
        fault_count: 5,
        fault_threshold: 3,
        contributing_tickets: ['ticket-1'],
        escalation_ticket_id: 'infra-ticket-1',
        escalation_type: 'replacement',
        status: 'resolved',
        resolution_notes: 'Pole replaced, issue resolved',
        resolved_at: new Date('2024-01-20T15:00:00Z'),
        resolved_by: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        created_at: new Date('2024-01-15T10:00:00Z'),
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockResolvedEscalation);

      // Act
      const result = await escalationService.resolveEscalation(escalationId, payload);

      // Assert
      expect(result.status).toBe('resolved');
      expect(result.resolution_notes).toBe('Pole replaced, issue resolved');
      expect(result.resolved_by).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
      expect(result.resolved_at).toBeDefined();
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE repeat_fault_escalations'),
        expect.arrayContaining(['resolved', 'Pole replaced, issue resolved', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', escalationId])
      );
    });

    it('should allow no_action status', async () => {
      // Arrange
      const payload: ResolveEscalationPayload = {
        resolved_by: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        resolution_notes: 'False positive, no action needed',
        status: EscalationStatus.NO_ACTION,
      };

      const mockEscalation = {
        id: '22222222-2222-2222-2222-222222222222',
        status: 'no_action',
        resolution_notes: 'False positive, no action needed',
        resolved_by: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        resolved_at: new Date(),
        scope_type: 'pon',
        scope_value: 'PON-456',
        project_id: null,
        fault_count: 6,
        fault_threshold: 5,
        contributing_tickets: ['ticket-2'],
        escalation_ticket_id: null,
        escalation_type: null,
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockEscalation);

      // Act
      const result = await escalationService.resolveEscalation('22222222-2222-2222-2222-222222222222', payload);

      // Assert
      expect(result.status).toBe('no_action');
    });

    it('should validate required fields', async () => {
      // Arrange - missing resolution_notes
      const invalidPayload = {
        resolved_by: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        resolution_notes: '',
        status: EscalationStatus.RESOLVED,
      } as ResolveEscalationPayload;

      // Act & Assert
      await expect(
        escalationService.resolveEscalation('11111111-1111-1111-1111-111111111111', invalidPayload)
      ).rejects.toThrow('resolution_notes is required');
    });

    it('should validate UUID format', async () => {
      // Arrange
      const payload: ResolveEscalationPayload = {
        resolved_by: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        resolution_notes: 'Test',
        status: EscalationStatus.RESOLVED,
      };

      // Act & Assert
      await expect(escalationService.resolveEscalation('not-a-uuid', payload)).rejects.toThrow(
        'Invalid escalation ID format'
      );
    });
  });

  describe('updateEscalationStatus', () => {
    it('should update escalation status to investigating', async () => {
      // Arrange
      const escalationId = '11111111-1111-1111-1111-111111111111';
      const mockUpdatedEscalation = {
        id: escalationId,
        scope_type: 'pole',
        scope_value: 'POLE-123',
        status: 'investigating',
        project_id: null,
        fault_count: 5,
        fault_threshold: 3,
        contributing_tickets: ['ticket-1'],
        escalation_ticket_id: null,
        escalation_type: null,
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockUpdatedEscalation);

      // Act
      const result = await escalationService.updateEscalationStatus(
        escalationId,
        EscalationStatus.INVESTIGATING
      );

      // Assert
      expect(result.status).toBe('investigating');
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE repeat_fault_escalations'),
        ['investigating', escalationId]
      );
    });

    it('should validate UUID format', async () => {
      // Act & Assert
      await expect(
        escalationService.updateEscalationStatus('not-a-uuid', EscalationStatus.INVESTIGATING)
      ).rejects.toThrow('Invalid escalation ID format');
    });
  });

  describe('checkForDuplicateEscalation', () => {
    it('should return existing escalation if active one exists', async () => {
      // Arrange
      const mockExistingEscalation = {
        id: 'existing-escalation-id',
        scope_type: 'pole',
        scope_value: 'POLE-123',
        status: 'open',
        project_id: null,
        fault_count: 4,
        fault_threshold: 3,
        contributing_tickets: ['ticket-1'],
        escalation_ticket_id: null,
        escalation_type: null,
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date(),
      };

      vi.mocked(db.queryOne).mockResolvedValue(mockExistingEscalation);

      // Act
      const result = await escalationService.checkForDuplicateEscalation(
        EscalationScopeType.POLE,
        'POLE-123'
      );

      // Assert
      expect(result).toEqual(mockExistingEscalation);
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('open', 'investigating')"),
        ['pole', 'POLE-123']
      );
    });

    it('should return null if no active escalation exists', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValue(null);

      // Act
      const result = await escalationService.checkForDuplicateEscalation(
        EscalationScopeType.PON,
        'PON-456'
      );

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('linkContributingTickets', () => {
    it('should add new contributing tickets to existing escalation', async () => {
      // Arrange
      const escalationId = '11111111-1111-1111-1111-111111111111';
      const existingTickets = ['ticket-1', 'ticket-2'];
      const newTickets = ['ticket-3', 'ticket-4'];

      const mockEscalation = {
        id: escalationId,
        contributing_tickets: existingTickets,
        scope_type: 'pole',
        scope_value: 'POLE-123',
        project_id: null,
        fault_count: 2,
        fault_threshold: 3,
        escalation_ticket_id: null,
        escalation_type: null,
        status: 'open',
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date(),
      };

      const mockUpdatedEscalation = {
        ...mockEscalation,
        contributing_tickets: [...existingTickets, ...newTickets],
        fault_count: 4,
      };

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(mockEscalation) // getEscalationById
        .mockResolvedValueOnce(mockUpdatedEscalation); // update

      // Act
      const result = await escalationService.linkContributingTickets(escalationId, newTickets);

      // Assert
      expect(result.contributing_tickets).toHaveLength(4);
      expect(result.contributing_tickets).toEqual([...existingTickets, ...newTickets]);
      expect(result.fault_count).toBe(4);
    });

    it('should not add duplicate tickets', async () => {
      // Arrange
      const escalationId = '11111111-1111-1111-1111-111111111111';
      const existingTickets = ['ticket-1', 'ticket-2'];
      const duplicateTickets = ['ticket-2', 'ticket-3']; // ticket-2 is duplicate

      const mockEscalation = {
        id: escalationId,
        contributing_tickets: existingTickets,
        scope_type: 'pole',
        scope_value: 'POLE-123',
        project_id: null,
        fault_count: 2,
        fault_threshold: 3,
        escalation_ticket_id: null,
        escalation_type: null,
        status: 'open',
        resolution_notes: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date(),
      };

      const mockUpdatedEscalation = {
        ...mockEscalation,
        contributing_tickets: ['ticket-1', 'ticket-2', 'ticket-3'],
        fault_count: 3,
      };

      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(mockEscalation)
        .mockResolvedValueOnce(mockUpdatedEscalation);

      // Act
      const result = await escalationService.linkContributingTickets(
        escalationId,
        duplicateTickets
      );

      // Assert
      expect(result.contributing_tickets).toHaveLength(3);
      expect(result.contributing_tickets).toEqual(['ticket-1', 'ticket-2', 'ticket-3']);
    });

    it('should validate escalation exists', async () => {
      // Arrange
      vi.mocked(db.queryOne).mockResolvedValue(null);

      // Act & Assert
      await expect(
        escalationService.linkContributingTickets('99999999-9999-9999-9999-999999999999', ['ticket-1'])
      ).rejects.toThrow('Escalation not found');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully on create', async () => {
      // Arrange
      const payload: CreateEscalationPayload = {
        scope_type: EscalationScopeType.POLE,
        scope_value: 'POLE-123',
        fault_count: 5,
        fault_threshold: 3,
        contributing_tickets: ['ticket-1'],
      };

      vi.mocked(db.queryOne).mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(escalationService.createEscalation(payload)).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should handle database errors on list', async () => {
      // Arrange
      vi.mocked(db.query).mockRejectedValue(new Error('Query timeout'));

      // Act & Assert
      await expect(escalationService.listEscalations()).rejects.toThrow('Query timeout');
    });
  });
});
