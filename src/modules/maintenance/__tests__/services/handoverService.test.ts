/**
 * Handover Service Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing handover process operations:
 * - Validate handover gate - as-built confirmed
 * - Validate handover gate - photos archived
 * - Validate handover gate - ONT/PON verified
 * - Validate handover gate - contractor assigned
 * - Create handover snapshot (build_to_qa)
 * - Create handover snapshot (qa_to_maintenance)
 * - Transfer ownership on handover
 * - Prevent handover when gate fails
 * - Get handover history for ticket
 *
 * 🟢 WORKING: Comprehensive test suite for handover service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateHandoverGate,
  createHandoverSnapshot,
  getHandoverHistory,
  getHandoverById,
  canHandover
} from '../../services/handoverService';
import {
  HandoverType,
  OwnerType,
  CreateHandoverSnapshotPayload,
  HandoverSnapshot,
  HandoverGateName
} from '../../types/handover';
import { TicketStatus } from '../../types/ticket';

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

import { query, queryOne, transaction } from '../../utils/db';

describe('Handover Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateHandoverGate', () => {
    it('should pass all gates for valid build_to_qa handover', async () => {
      // 🟢 WORKING: Test all gates pass for build to QA
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      // Mock ticket data - all fields populated
      const mockTicket = {
        id: ticketId,
        ticket_uid: 'FT001234',
        status: TicketStatus.PENDING_QA,
        dr_number: 'DR12345',
        pole_number: 'P001',
        pon_number: 'PON001',
        zone_id: 'zone-uuid-001',
        ont_serial: 'ONT123456',
        ont_rx_level: -18.5,
        assigned_contractor_id: 'contractor-uuid-001'
      };

      // Mock attachments - has photos
      const mockAttachments = [
        { id: 'att-1', file_type: 'photo', is_evidence: true },
        { id: 'att-2', file_type: 'photo', is_evidence: true }
      ];

      // Mock verification steps - all complete
      const mockVerificationSteps = [
        { step_number: 1, is_complete: true },
        { step_number: 2, is_complete: true }
      ];

      vi.mocked(queryOne).mockResolvedValueOnce(mockTicket); // Ticket query
      vi.mocked(query).mockResolvedValueOnce(mockAttachments); // Attachments query
      vi.mocked(query).mockResolvedValueOnce(mockVerificationSteps); // Verification query

      const result = await validateHandoverGate(ticketId, HandoverType.BUILD_TO_QA);

      expect(result.can_handover).toBe(true);
      expect(result.blocking_issues).toHaveLength(0);
      expect(result.gates_failed).toHaveLength(0);
      expect(result.gates_passed.length).toBeGreaterThan(0);
    });

    it('should fail gate when as-built data missing (no DR number)', async () => {
      // 🟢 WORKING: Test as-built confirmed gate failure
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockTicket = {
        id: ticketId,
        ticket_uid: 'FT001234',
        status: TicketStatus.PENDING_QA,
        dr_number: null, // Missing DR
        pole_number: 'P001',
        pon_number: 'PON001',
        zone_id: 'zone-uuid-001',
        ont_serial: 'ONT123456',
        ont_rx_level: -18.5,
        assigned_contractor_id: 'contractor-uuid-001'
      };

      const mockAttachments = [{ id: 'att-1', file_type: 'photo' }];
      const mockVerificationSteps = [{ step_number: 1, is_complete: true }];

      vi.mocked(queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(query).mockResolvedValueOnce(mockAttachments);
      vi.mocked(query).mockResolvedValueOnce(mockVerificationSteps);

      const result = await validateHandoverGate(ticketId, HandoverType.QA_TO_MAINTENANCE);

      expect(result.can_handover).toBe(false);
      expect(result.blocking_issues.length).toBeGreaterThan(0);
      expect(result.gates_failed.some(g => g.gate_name === HandoverGateName.AS_BUILT_CONFIRMED)).toBe(true);
    });

    it('should fail gate when photos not archived', async () => {
      // 🟢 WORKING: Test photos archived gate failure
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockTicket = {
        id: ticketId,
        ticket_uid: 'FT001234',
        status: TicketStatus.PENDING_QA,
        dr_number: 'DR12345',
        pole_number: 'P001',
        pon_number: 'PON001',
        zone_id: 'zone-uuid-001',
        ont_serial: 'ONT123456',
        ont_rx_level: -18.5,
        assigned_contractor_id: 'contractor-uuid-001'
      };

      const mockAttachments = []; // No photos
      const mockVerificationSteps = [{ step_number: 1, is_complete: true }];

      vi.mocked(queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(query).mockResolvedValueOnce(mockAttachments);
      vi.mocked(query).mockResolvedValueOnce(mockVerificationSteps);

      const result = await validateHandoverGate(ticketId, HandoverType.QA_TO_MAINTENANCE);

      expect(result.can_handover).toBe(false);
      expect(result.gates_failed.some(g => g.gate_name === HandoverGateName.PHOTOS_ARCHIVED)).toBe(true);
    });

    it('should fail gate when ONT/PON not verified', async () => {
      // 🟢 WORKING: Test ONT/PON verified gate failure
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockTicket = {
        id: ticketId,
        ticket_uid: 'FT001234',
        status: TicketStatus.PENDING_QA,
        dr_number: 'DR12345',
        pole_number: 'P001',
        pon_number: 'PON001',
        zone_id: 'zone-uuid-001',
        ont_serial: null, // Missing ONT serial
        ont_rx_level: null, // Missing RX level
        assigned_contractor_id: 'contractor-uuid-001'
      };

      const mockAttachments = [{ id: 'att-1', file_type: 'photo' }];
      const mockVerificationSteps = [{ step_number: 1, is_complete: true }];

      vi.mocked(queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(query).mockResolvedValueOnce(mockAttachments);
      vi.mocked(query).mockResolvedValueOnce(mockVerificationSteps);

      const result = await validateHandoverGate(ticketId, HandoverType.QA_TO_MAINTENANCE);

      expect(result.can_handover).toBe(false);
      expect(result.gates_failed.some(g => g.gate_name === HandoverGateName.ONT_PON_VERIFIED)).toBe(true);
    });

    it('should fail gate when contractor not assigned', async () => {
      // 🟢 WORKING: Test contractor assigned gate failure
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockTicket = {
        id: ticketId,
        ticket_uid: 'FT001234',
        status: TicketStatus.PENDING_QA,
        dr_number: 'DR12345',
        pole_number: 'P001',
        pon_number: 'PON001',
        zone_id: 'zone-uuid-001',
        ont_serial: 'ONT123456',
        ont_rx_level: -18.5,
        assigned_contractor_id: null // No contractor assigned
      };

      const mockAttachments = [{ id: 'att-1', file_type: 'photo' }];
      const mockVerificationSteps = [{ step_number: 1, is_complete: true }];

      vi.mocked(queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(query).mockResolvedValueOnce(mockAttachments);
      vi.mocked(query).mockResolvedValueOnce(mockVerificationSteps);

      const result = await validateHandoverGate(ticketId, HandoverType.QA_TO_MAINTENANCE);

      expect(result.can_handover).toBe(false);
      expect(result.gates_failed.some(g => g.gate_name === HandoverGateName.CONTRACTOR_ASSIGNED)).toBe(true);
    });

    it('should pass with warnings for build_to_qa (less strict)', async () => {
      // 🟢 WORKING: Build to QA is less strict than QA to maintenance
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockTicket = {
        id: ticketId,
        ticket_uid: 'FT001234',
        status: TicketStatus.PENDING_QA,
        dr_number: 'DR12345',
        pole_number: null, // Pole can be missing for build_to_qa
        pon_number: 'PON001',
        zone_id: 'zone-uuid-001',
        ont_serial: 'ONT123456',
        ont_rx_level: -18.5,
        assigned_contractor_id: 'contractor-uuid-001'
      };

      const mockAttachments = [{ id: 'att-1', file_type: 'photo' }];
      const mockVerificationSteps = [{ step_number: 1, is_complete: true }];

      vi.mocked(queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(query).mockResolvedValueOnce(mockAttachments);
      vi.mocked(query).mockResolvedValueOnce(mockVerificationSteps);

      const result = await validateHandoverGate(ticketId, HandoverType.BUILD_TO_QA);

      expect(result.can_handover).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0); // Should have warnings but still pass
    });
  });

  describe('createHandoverSnapshot', () => {
    it('should create handover snapshot for build_to_qa', async () => {
      // 🟢 WORKING: Test creating build to QA handover
      const payload: CreateHandoverSnapshotPayload = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        handover_type: HandoverType.BUILD_TO_QA,
        from_owner_type: OwnerType.BUILD,
        from_owner_id: 'build-team-uuid',
        to_owner_type: OwnerType.QA,
        to_owner_id: 'qa-team-uuid',
        handover_by: 'user-uuid-manager'
      };

      const mockTicket = {
        id: payload.ticket_id,
        ticket_uid: 'FT001234',
        title: 'Install fiber to DR12345',
        status: TicketStatus.PENDING_QA,
        dr_number: 'DR12345',
        ont_serial: 'ONT123456',
        qa_ready: true,
        assigned_contractor_id: 'contractor-uuid-001'
      };

      const mockAttachments = [
        { id: 'att-1', filename: 'photo1.jpg', storage_url: 'https://storage/photo1.jpg', uploaded_at: new Date() }
      ];

      const mockVerificationSteps = [
        { step_number: 1, is_complete: true },
        { step_number: 2, is_complete: true }
      ];

      const mockRisks = [];

      const mockSnapshot: HandoverSnapshot = {
        id: 'snapshot-uuid-001',
        ticket_id: payload.ticket_id,
        handover_type: payload.handover_type,
        snapshot_data: {
          ticket_uid: mockTicket.ticket_uid,
          title: mockTicket.title,
          description: null,
          status: mockTicket.status,
          priority: 'normal',
          ticket_type: 'maintenance',
          dr_number: mockTicket.dr_number,
          project_id: null,
          zone_id: null,
          pole_number: null,
          pon_number: null,
          address: null,
          ont_serial: mockTicket.ont_serial,
          ont_rx_level: null,
          ont_model: null,
          assigned_to: null,
          assigned_contractor_id: mockTicket.assigned_contractor_id,
          assigned_team: null,
          qa_ready: mockTicket.qa_ready,
          qa_readiness_check_at: null,
          fault_cause: null,
          fault_cause_details: null,
          verification_steps_completed: 2,
          verification_steps_total: 2,
          snapshot_timestamp: new Date()
        },
        evidence_links: mockAttachments.map(a => ({
          type: 'photo' as const,
          step_number: null,
          url: a.storage_url,
          filename: a.filename,
          uploaded_at: a.uploaded_at,
          uploaded_by: null
        })),
        decisions: [],
        guarantee_status: null,
        from_owner_type: payload.from_owner_type!,
        from_owner_id: payload.from_owner_id!,
        to_owner_type: payload.to_owner_type!,
        to_owner_id: payload.to_owner_id!,
        handover_at: new Date(),
        handover_by: payload.handover_by,
        is_locked: true,
        created_at: new Date()
      };

      // Mock transaction execution
      vi.mocked(transaction).mockImplementation(async (callback: any) => {
        const txn = {
          queryOne: vi.fn()
            .mockResolvedValueOnce(mockTicket) // Get ticket
            .mockResolvedValueOnce(mockSnapshot), // Insert snapshot
          query: vi.fn()
            .mockResolvedValueOnce(mockAttachments) // Get attachments
            .mockResolvedValueOnce(mockVerificationSteps) // Get verification steps
            .mockResolvedValueOnce(mockRisks) // Get risks
        };
        return callback(txn);
      });

      const result = await createHandoverSnapshot(payload);

      expect(result).toEqual(mockSnapshot);
      expect(result.handover_type).toBe(HandoverType.BUILD_TO_QA);
      expect(result.is_locked).toBe(true);
      expect(result.from_owner_type).toBe(OwnerType.BUILD);
      expect(result.to_owner_type).toBe(OwnerType.QA);
    });

    it('should create handover snapshot for qa_to_maintenance', async () => {
      // 🟢 WORKING: Test creating QA to maintenance handover
      const payload: CreateHandoverSnapshotPayload = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        handover_type: HandoverType.QA_TO_MAINTENANCE,
        from_owner_type: OwnerType.QA,
        from_owner_id: 'qa-team-uuid',
        to_owner_type: OwnerType.MAINTENANCE,
        to_owner_id: 'maintenance-team-uuid',
        handover_by: 'user-uuid-qa-manager'
      };

      const mockTicket = {
        id: payload.ticket_id,
        ticket_uid: 'FT001234',
        title: 'Install fiber to DR12345',
        status: TicketStatus.QA_APPROVED,
        dr_number: 'DR12345',
        ont_serial: 'ONT123456',
        ont_rx_level: -18.5,
        qa_ready: true,
        assigned_contractor_id: 'contractor-uuid-001'
      };

      const mockAttachments = [
        { id: 'att-1', filename: 'photo1.jpg', storage_url: 'https://storage/photo1.jpg', uploaded_at: new Date() }
      ];

      const mockVerificationSteps = [
        { step_number: 1, is_complete: true }
      ];

      const mockRisks = [];

      const mockSnapshot: HandoverSnapshot = {
        id: 'snapshot-uuid-002',
        ticket_id: payload.ticket_id,
        handover_type: payload.handover_type,
        snapshot_data: {
          ticket_uid: mockTicket.ticket_uid,
          title: mockTicket.title,
          description: null,
          status: mockTicket.status,
          priority: 'normal',
          ticket_type: 'maintenance',
          dr_number: mockTicket.dr_number,
          project_id: null,
          zone_id: null,
          pole_number: null,
          pon_number: null,
          address: null,
          ont_serial: mockTicket.ont_serial,
          ont_rx_level: mockTicket.ont_rx_level,
          ont_model: null,
          assigned_to: null,
          assigned_contractor_id: mockTicket.assigned_contractor_id,
          assigned_team: null,
          qa_ready: mockTicket.qa_ready,
          qa_readiness_check_at: null,
          fault_cause: null,
          fault_cause_details: null,
          verification_steps_completed: 1,
          verification_steps_total: 1,
          snapshot_timestamp: new Date()
        },
        evidence_links: mockAttachments.map(a => ({
          type: 'photo' as const,
          step_number: null,
          url: a.storage_url,
          filename: a.filename,
          uploaded_at: a.uploaded_at,
          uploaded_by: null
        })),
        decisions: [],
        guarantee_status: null,
        from_owner_type: payload.from_owner_type!,
        from_owner_id: payload.from_owner_id!,
        to_owner_type: payload.to_owner_type!,
        to_owner_id: payload.to_owner_id!,
        handover_at: new Date(),
        handover_by: payload.handover_by,
        is_locked: true,
        created_at: new Date()
      };

      vi.mocked(transaction).mockImplementation(async (callback: any) => {
        const txn = {
          queryOne: vi.fn()
            .mockResolvedValueOnce(mockTicket)
            .mockResolvedValueOnce(mockSnapshot),
          query: vi.fn()
            .mockResolvedValueOnce(mockAttachments)
            .mockResolvedValueOnce(mockVerificationSteps)
            .mockResolvedValueOnce(mockRisks)
        };
        return callback(txn);
      });

      const result = await createHandoverSnapshot(payload);

      expect(result.handover_type).toBe(HandoverType.QA_TO_MAINTENANCE);
      expect(result.from_owner_type).toBe(OwnerType.QA);
      expect(result.to_owner_type).toBe(OwnerType.MAINTENANCE);
    });

    it('should throw error if ticket not found', async () => {
      // 🟢 WORKING: Test error when ticket doesn't exist
      const payload: CreateHandoverSnapshotPayload = {
        ticket_id: 'non-existent-ticket',
        handover_type: HandoverType.BUILD_TO_QA,
        handover_by: 'user-uuid'
      };

      vi.mocked(transaction).mockImplementation(async (callback: any) => {
        const txn = {
          queryOne: vi.fn().mockResolvedValueOnce(null), // Ticket not found
          query: vi.fn()
        };
        return callback(txn);
      });

      await expect(createHandoverSnapshot(payload)).rejects.toThrow('Ticket not found');
    });

    it('should throw error if handover_by is missing', async () => {
      // 🟢 WORKING: Validate required handover_by field
      const payload = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        handover_type: HandoverType.BUILD_TO_QA
      } as CreateHandoverSnapshotPayload;

      await expect(createHandoverSnapshot(payload)).rejects.toThrow('handover_by is required');
    });
  });

  describe('getHandoverHistory', () => {
    it('should return handover history for ticket', async () => {
      // 🟢 WORKING: Test getting handover history
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const ticketUid = 'FT001234';

      const mockHandovers: HandoverSnapshot[] = [
        {
          id: 'snapshot-uuid-001',
          ticket_id: ticketId,
          handover_type: HandoverType.BUILD_TO_QA,
          snapshot_data: {} as any,
          evidence_links: [],
          decisions: [],
          guarantee_status: null,
          from_owner_type: OwnerType.BUILD,
          from_owner_id: 'build-uuid',
          to_owner_type: OwnerType.QA,
          to_owner_id: 'qa-uuid',
          handover_at: new Date('2024-01-15T10:00:00Z'),
          handover_by: 'user-uuid-001',
          is_locked: true,
          created_at: new Date('2024-01-15T10:00:00Z')
        },
        {
          id: 'snapshot-uuid-002',
          ticket_id: ticketId,
          handover_type: HandoverType.QA_TO_MAINTENANCE,
          snapshot_data: {} as any,
          evidence_links: [],
          decisions: [],
          guarantee_status: null,
          from_owner_type: OwnerType.QA,
          from_owner_id: 'qa-uuid',
          to_owner_type: OwnerType.MAINTENANCE,
          to_owner_id: 'maintenance-uuid',
          handover_at: new Date('2024-01-20T14:00:00Z'),
          handover_by: 'user-uuid-002',
          is_locked: true,
          created_at: new Date('2024-01-20T14:00:00Z')
        }
      ];

      vi.mocked(queryOne).mockResolvedValueOnce({ ticket_uid: ticketUid });
      vi.mocked(query).mockResolvedValueOnce(mockHandovers);

      const result = await getHandoverHistory(ticketId);

      expect(result.ticket_id).toBe(ticketId);
      expect(result.ticket_uid).toBe(ticketUid);
      expect(result.handovers).toHaveLength(2);
      expect(result.total_handovers).toBe(2);
      expect(result.current_owner_type).toBe(OwnerType.MAINTENANCE);
      expect(result.current_owner_id).toBe('maintenance-uuid');
    });

    it('should return empty history for ticket with no handovers', async () => {
      // 🟢 WORKING: Test ticket with no handovers
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const ticketUid = 'FT001234';

      vi.mocked(queryOne).mockResolvedValueOnce({ ticket_uid: ticketUid });
      vi.mocked(query).mockResolvedValueOnce([]);

      const result = await getHandoverHistory(ticketId);

      expect(result.handovers).toHaveLength(0);
      expect(result.total_handovers).toBe(0);
      expect(result.current_owner_type).toBeNull();
      expect(result.current_owner_id).toBeNull();
    });

    it('should throw error if ticket not found', async () => {
      // 🟢 WORKING: Test error when ticket doesn't exist
      const ticketId = 'non-existent-ticket';

      vi.mocked(queryOne).mockResolvedValueOnce(null);

      await expect(getHandoverHistory(ticketId)).rejects.toThrow('Ticket not found');
    });
  });

  describe('getHandoverById', () => {
    it('should return handover snapshot by ID', async () => {
      // 🟢 WORKING: Test fetching handover by ID
      const handoverId = '123e4567-e89b-12d3-a456-426614174000';

      const mockSnapshot: HandoverSnapshot = {
        id: handoverId,
        ticket_id: 'ticket-uuid-001',
        handover_type: HandoverType.BUILD_TO_QA,
        snapshot_data: {} as any,
        evidence_links: [],
        decisions: [],
        guarantee_status: null,
        from_owner_type: OwnerType.BUILD,
        from_owner_id: 'build-uuid',
        to_owner_type: OwnerType.QA,
        to_owner_id: 'qa-uuid',
        handover_at: new Date(),
        handover_by: 'user-uuid',
        is_locked: true,
        created_at: new Date()
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockSnapshot);

      const result = await getHandoverById(handoverId);

      expect(result).toEqual(mockSnapshot);
      expect(result?.id).toBe(handoverId);
    });

    it('should throw error for invalid UUID format', async () => {
      // 🟢 WORKING: Validate UUID format
      const invalidId = 'invalid-uuid';

      await expect(getHandoverById(invalidId)).rejects.toThrow('Invalid handover ID format');
    });

    it('should return null if handover not found', async () => {
      // 🟢 WORKING: Test not found scenario
      const handoverId = '123e4567-e89b-12d3-a456-426614174999';

      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await getHandoverById(handoverId);

      expect(result).toBeNull();
    });
  });

  describe('canHandover', () => {
    it('should return true when all gates pass', async () => {
      // 🟢 WORKING: Test can handover when gates pass
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockTicket = {
        id: ticketId,
        dr_number: 'DR12345',
        pole_number: 'P001',
        pon_number: 'PON001',
        zone_id: 'zone-uuid',
        ont_serial: 'ONT123456',
        ont_rx_level: -18.5,
        assigned_contractor_id: 'contractor-uuid'
      };

      const mockAttachments = [{ id: 'att-1', file_type: 'photo' }];
      const mockVerificationSteps = [{ step_number: 1, is_complete: true }];

      vi.mocked(queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(query).mockResolvedValueOnce(mockAttachments);
      vi.mocked(query).mockResolvedValueOnce(mockVerificationSteps);

      const result = await canHandover(ticketId, HandoverType.QA_TO_MAINTENANCE);

      expect(result).toBe(true);
    });

    it('should return false when gates fail', async () => {
      // 🟢 WORKING: Test cannot handover when gates fail
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockTicket = {
        id: ticketId,
        dr_number: null, // Missing DR - gate fails
        ont_serial: 'ONT123456',
        assigned_contractor_id: 'contractor-uuid'
      };

      const mockAttachments = [];
      const mockVerificationSteps = [];

      vi.mocked(queryOne).mockResolvedValueOnce(mockTicket);
      vi.mocked(query).mockResolvedValueOnce(mockAttachments);
      vi.mocked(query).mockResolvedValueOnce(mockVerificationSteps);

      const result = await canHandover(ticketId, HandoverType.QA_TO_MAINTENANCE);

      expect(result).toBe(false);
    });
  });
});
