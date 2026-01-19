/**
 * Risk Acceptance Service Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing QA risk acceptance operations:
 * - Create risk acceptance record
 * - Create risk - requires expiry date
 * - List active risks for ticket
 * - Resolve risk acceptance
 * - Get expiring risks (within 7 days)
 * - Escalate expired risks
 * - Prevent QA close with active unresolved risks
 *
 * 🟢 WORKING: Comprehensive test suite for risk acceptance service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createRiskAcceptance,
  getRiskAcceptanceById,
  listRisksForTicket,
  resolveRiskAcceptance,
  getExpiringRisks,
  escalateExpiredRisks,
  canCloseTicket,
  getTicketRiskSummary
} from '../../services/riskAcceptanceService';
import {
  RiskType,
  RiskAcceptanceStatus,
  CreateRiskAcceptancePayload,
  ResolveRiskAcceptancePayload,
  QARiskAcceptance
} from '../../types/riskAcceptance';

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

describe('Risk Acceptance Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRiskAcceptance', () => {
    it('should create a risk acceptance record with all required fields', async () => {
      // 🟢 WORKING: Test creating risk acceptance with complete data
      const payload: CreateRiskAcceptancePayload = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        risk_type: RiskType.MINOR_DEFECT,
        risk_description: 'Minor cosmetic issue on cable tray - does not affect functionality',
        conditions: 'Contractor to rectify during next scheduled visit to site',
        risk_expiry_date: new Date('2024-02-15'),
        requires_followup: true,
        followup_date: new Date('2024-02-10'),
        accepted_by: 'user-uuid-qa-manager'
      };

      const mockCreatedRisk: QARiskAcceptance = {
        id: 'risk-uuid-001',
        ticket_id: payload.ticket_id,
        risk_type: payload.risk_type,
        risk_description: payload.risk_description,
        conditions: payload.conditions!,
        risk_expiry_date: payload.risk_expiry_date!,
        requires_followup: payload.requires_followup!,
        followup_date: payload.followup_date!,
        status: RiskAcceptanceStatus.ACTIVE,
        resolved_at: null,
        resolved_by: null,
        resolution_notes: null,
        accepted_by: payload.accepted_by,
        accepted_at: new Date('2024-01-15T10:00:00Z'),
        created_at: new Date('2024-01-15T10:00:00Z')
      };

      vi.mocked(queryOne).mockResolvedValue(mockCreatedRisk);

      const result = await createRiskAcceptance(payload);

      expect(result).toEqual(mockCreatedRisk);
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO qa_risk_acceptances'),
        expect.arrayContaining([
          payload.ticket_id,
          payload.risk_type,
          payload.risk_description,
          payload.conditions,
          payload.risk_expiry_date,
          payload.requires_followup,
          payload.followup_date,
          payload.accepted_by
        ])
      );
    });

    it('should create risk acceptance with minimal fields (no expiry date)', async () => {
      // 🟢 WORKING: Test creating risk without expiry date
      const payload: CreateRiskAcceptancePayload = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        risk_type: RiskType.CLIENT_REQUESTED,
        risk_description: 'Client requested to proceed without final signage installation',
        accepted_by: 'user-uuid-qa-manager'
      };

      const mockCreatedRisk: QARiskAcceptance = {
        id: 'risk-uuid-002',
        ticket_id: payload.ticket_id,
        risk_type: payload.risk_type,
        risk_description: payload.risk_description,
        conditions: null,
        risk_expiry_date: null,
        requires_followup: true,
        followup_date: null,
        status: RiskAcceptanceStatus.ACTIVE,
        resolved_at: null,
        resolved_by: null,
        resolution_notes: null,
        accepted_by: payload.accepted_by,
        accepted_at: new Date('2024-01-15T10:00:00Z'),
        created_at: new Date('2024-01-15T10:00:00Z')
      };

      vi.mocked(queryOne).mockResolvedValue(mockCreatedRisk);

      const result = await createRiskAcceptance(payload);

      expect(result).toEqual(mockCreatedRisk);
      expect(result.risk_expiry_date).toBeNull();
      expect(result.conditions).toBeNull();
    });

    it('should throw error if ticket_id is missing', async () => {
      // 🟢 WORKING: Validate required ticket_id
      const payload = {
        risk_type: RiskType.MINOR_DEFECT,
        risk_description: 'Test description',
        accepted_by: 'user-uuid-qa'
      } as CreateRiskAcceptancePayload;

      await expect(createRiskAcceptance(payload)).rejects.toThrow('ticket_id is required');
    });

    it('should throw error if risk_description is empty', async () => {
      // 🟢 WORKING: Validate non-empty risk_description
      const payload: CreateRiskAcceptancePayload = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        risk_type: RiskType.MINOR_DEFECT,
        risk_description: '',
        accepted_by: 'user-uuid-qa'
      };

      await expect(createRiskAcceptance(payload)).rejects.toThrow('risk_description cannot be empty');
    });

    it('should throw error if accepted_by is missing', async () => {
      // 🟢 WORKING: Validate required accepted_by
      const payload = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        risk_type: RiskType.MINOR_DEFECT,
        risk_description: 'Test description'
      } as CreateRiskAcceptancePayload;

      await expect(createRiskAcceptance(payload)).rejects.toThrow('accepted_by is required');
    });

    it('should throw error if risk_type is invalid', async () => {
      // 🟢 WORKING: Validate risk_type enum
      const payload = {
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        risk_type: 'invalid_risk_type',
        risk_description: 'Test description',
        accepted_by: 'user-uuid-qa'
      } as CreateRiskAcceptancePayload;

      await expect(createRiskAcceptance(payload)).rejects.toThrow('Invalid risk_type value');
    });
  });

  describe('getRiskAcceptanceById', () => {
    it('should retrieve risk acceptance by ID', async () => {
      // 🟢 WORKING: Test fetching risk by ID
      const riskId = '123e4567-e89b-12d3-a456-426614174001';
      const mockRisk: QARiskAcceptance = {
        id: riskId,
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        risk_type: RiskType.MINOR_DEFECT,
        risk_description: 'Minor defect',
        conditions: 'Fix within 7 days',
        risk_expiry_date: new Date('2024-02-15'),
        requires_followup: true,
        followup_date: new Date('2024-02-10'),
        status: RiskAcceptanceStatus.ACTIVE,
        resolved_at: null,
        resolved_by: null,
        resolution_notes: null,
        accepted_by: 'user-uuid-qa',
        accepted_at: new Date('2024-01-15T10:00:00Z'),
        created_at: new Date('2024-01-15T10:00:00Z')
      };

      vi.mocked(queryOne).mockResolvedValue(mockRisk);

      const result = await getRiskAcceptanceById(riskId);

      expect(result).toEqual(mockRisk);
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM qa_risk_acceptances WHERE id = $1'),
        [riskId]
      );
    });

    it('should throw error if risk not found', async () => {
      // 🟢 WORKING: Test not found error
      const riskId = '123e4567-e89b-12d3-a456-426614174999';

      vi.mocked(queryOne).mockResolvedValue(null);

      await expect(getRiskAcceptanceById(riskId)).rejects.toThrow('Risk acceptance not found');
    });

    it('should throw error if ID is invalid UUID format', async () => {
      // 🟢 WORKING: Validate UUID format
      const invalidId = 'invalid-uuid';

      await expect(getRiskAcceptanceById(invalidId)).rejects.toThrow('Invalid risk acceptance ID format');
    });
  });

  describe('listRisksForTicket', () => {
    it('should list all active risks for a ticket', async () => {
      // 🟢 WORKING: Test listing active risks
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';
      const mockRisks: QARiskAcceptance[] = [
        {
          id: 'risk-uuid-001',
          ticket_id: ticketId,
          risk_type: RiskType.MINOR_DEFECT,
          risk_description: 'Minor defect 1',
          conditions: null,
          risk_expiry_date: new Date('2024-02-15'),
          requires_followup: true,
          followup_date: null,
          status: RiskAcceptanceStatus.ACTIVE,
          resolved_at: null,
          resolved_by: null,
          resolution_notes: null,
          accepted_by: 'user-uuid-qa',
          accepted_at: new Date('2024-01-15T10:00:00Z'),
          created_at: new Date('2024-01-15T10:00:00Z')
        },
        {
          id: 'risk-uuid-002',
          ticket_id: ticketId,
          risk_type: RiskType.DOCUMENTATION_GAP,
          risk_description: 'Missing one photo',
          conditions: 'Upload photo within 3 days',
          risk_expiry_date: new Date('2024-02-18'),
          requires_followup: true,
          followup_date: new Date('2024-02-17'),
          status: RiskAcceptanceStatus.ACTIVE,
          resolved_at: null,
          resolved_by: null,
          resolution_notes: null,
          accepted_by: 'user-uuid-qa',
          accepted_at: new Date('2024-01-16T10:00:00Z'),
          created_at: new Date('2024-01-16T10:00:00Z')
        }
      ];

      vi.mocked(query).mockResolvedValue(mockRisks);

      const result = await listRisksForTicket(ticketId);

      expect(result).toEqual(mockRisks);
      expect(result).toHaveLength(2);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ticket_id = $1 AND status = $2'),
        [ticketId, RiskAcceptanceStatus.ACTIVE]
      );
    });

    it('should return empty array if no active risks exist', async () => {
      // 🟢 WORKING: Test empty results
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(query).mockResolvedValue([]);

      const result = await listRisksForTicket(ticketId);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should filter by status if provided', async () => {
      // 🟢 WORKING: Test filtering by status
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(query).mockResolvedValue([]);

      await listRisksForTicket(ticketId, RiskAcceptanceStatus.RESOLVED);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ticket_id = $1 AND status = $2'),
        [ticketId, RiskAcceptanceStatus.RESOLVED]
      );
    });
  });

  describe('resolveRiskAcceptance', () => {
    it('should resolve a risk acceptance with resolution notes', async () => {
      // 🟢 WORKING: Test resolving a risk
      const riskId = 'risk-uuid-001';
      const payload: ResolveRiskAcceptancePayload = {
        resolved_by: 'user-uuid-technician',
        resolution_notes: 'Defect has been fixed and verified by QA team'
      };

      const mockResolvedRisk: QARiskAcceptance = {
        id: riskId,
        ticket_id: '123e4567-e89b-12d3-a456-426614174000',
        risk_type: RiskType.MINOR_DEFECT,
        risk_description: 'Minor defect',
        conditions: 'Fix within 7 days',
        risk_expiry_date: new Date('2024-02-15'),
        requires_followup: true,
        followup_date: new Date('2024-02-10'),
        status: RiskAcceptanceStatus.RESOLVED,
        resolved_at: new Date('2024-01-20T14:30:00Z'),
        resolved_by: payload.resolved_by,
        resolution_notes: payload.resolution_notes,
        accepted_by: 'user-uuid-qa',
        accepted_at: new Date('2024-01-15T10:00:00Z'),
        created_at: new Date('2024-01-15T10:00:00Z')
      };

      vi.mocked(queryOne).mockResolvedValue(mockResolvedRisk);

      const result = await resolveRiskAcceptance(riskId, payload);

      expect(result).toEqual(mockResolvedRisk);
      expect(result.status).toBe(RiskAcceptanceStatus.RESOLVED);
      expect(result.resolved_at).not.toBeNull();
      expect(result.resolved_by).toBe(payload.resolved_by);
      expect(result.resolution_notes).toBe(payload.resolution_notes);
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE qa_risk_acceptances'),
        expect.arrayContaining([
          RiskAcceptanceStatus.RESOLVED,
          payload.resolved_by,
          payload.resolution_notes,
          riskId
        ])
      );
    });

    it('should throw error if resolution_notes is empty', async () => {
      // 🟢 WORKING: Validate resolution_notes
      const riskId = 'risk-uuid-001';
      const payload: ResolveRiskAcceptancePayload = {
        resolved_by: 'user-uuid-technician',
        resolution_notes: ''
      };

      await expect(resolveRiskAcceptance(riskId, payload)).rejects.toThrow('resolution_notes cannot be empty');
    });

    it('should throw error if resolved_by is missing', async () => {
      // 🟢 WORKING: Validate resolved_by
      const riskId = 'risk-uuid-001';
      const payload = {
        resolution_notes: 'Fixed'
      } as ResolveRiskAcceptancePayload;

      await expect(resolveRiskAcceptance(riskId, payload)).rejects.toThrow('resolved_by is required');
    });

    it('should throw error if risk not found', async () => {
      // 🟢 WORKING: Test not found error on resolve
      const riskId = 'non-existent-risk';
      const payload: ResolveRiskAcceptancePayload = {
        resolved_by: 'user-uuid-technician',
        resolution_notes: 'Fixed'
      };

      vi.mocked(queryOne).mockResolvedValue(null);

      await expect(resolveRiskAcceptance(riskId, payload)).rejects.toThrow('Risk acceptance not found');
    });
  });

  describe('getExpiringRisks', () => {
    it('should get risks expiring within 7 days', async () => {
      // 🟢 WORKING: Test getting risks expiring soon
      const today = new Date('2024-01-15');
      const mockExpiringRisks: QARiskAcceptance[] = [
        {
          id: 'risk-uuid-001',
          ticket_id: '123e4567-e89b-12d3-a456-426614174000',
          risk_type: RiskType.PENDING_MATERIAL,
          risk_description: 'Waiting for replacement ONT',
          conditions: 'Install replacement ONT',
          risk_expiry_date: new Date('2024-01-20'), // 5 days from today
          requires_followup: true,
          followup_date: new Date('2024-01-19'),
          status: RiskAcceptanceStatus.ACTIVE,
          resolved_at: null,
          resolved_by: null,
          resolution_notes: null,
          accepted_by: 'user-uuid-qa',
          accepted_at: new Date('2024-01-10T10:00:00Z'),
          created_at: new Date('2024-01-10T10:00:00Z')
        },
        {
          id: 'risk-uuid-002',
          ticket_id: '456e7890-e89b-12d3-a456-426614174001',
          risk_type: RiskType.TEMPORARY_FIX,
          risk_description: 'Temporary fiber splice needs permanent fix',
          conditions: 'Replace with permanent splice',
          risk_expiry_date: new Date('2024-01-22'), // 7 days from today
          requires_followup: true,
          followup_date: null,
          status: RiskAcceptanceStatus.ACTIVE,
          resolved_at: null,
          resolved_by: null,
          resolution_notes: null,
          accepted_by: 'user-uuid-qa',
          accepted_at: new Date('2024-01-12T10:00:00Z'),
          created_at: new Date('2024-01-12T10:00:00Z')
        }
      ];

      vi.mocked(query).mockResolvedValue(mockExpiringRisks);

      const result = await getExpiringRisks(7, today);

      expect(result).toHaveLength(2);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $1'),
        expect.arrayContaining([RiskAcceptanceStatus.ACTIVE])
      );
    });

    it('should get risks expiring within custom days', async () => {
      // 🟢 WORKING: Test custom expiry window
      const today = new Date('2024-01-15');

      vi.mocked(query).mockResolvedValue([]);

      await getExpiringRisks(14, today);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('risk_expiry_date <= $2'),
        expect.arrayContaining([
          RiskAcceptanceStatus.ACTIVE,
          expect.any(Date)
        ])
      );
    });

    it('should return empty array if no expiring risks', async () => {
      // 🟢 WORKING: Test empty expiring risks
      vi.mocked(query).mockResolvedValue([]);

      const result = await getExpiringRisks(7);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('escalateExpiredRisks', () => {
    it('should escalate expired risks to escalated status', async () => {
      // 🟢 WORKING: Test escalating expired risks
      const mockExpiredRisks: QARiskAcceptance[] = [
        {
          id: 'risk-uuid-expired-001',
          ticket_id: '123e4567-e89b-12d3-a456-426614174000',
          risk_type: RiskType.PENDING_MATERIAL,
          risk_description: 'Expired risk - material not delivered',
          conditions: 'Deliver material within 7 days',
          risk_expiry_date: new Date('2024-01-10'), // Expired
          requires_followup: true,
          followup_date: null,
          status: RiskAcceptanceStatus.EXPIRED,
          resolved_at: null,
          resolved_by: null,
          resolution_notes: null,
          accepted_by: 'user-uuid-qa',
          accepted_at: new Date('2024-01-01T10:00:00Z'),
          created_at: new Date('2024-01-01T10:00:00Z')
        }
      ];

      vi.mocked(query).mockResolvedValueOnce([]); // First call: mark active as expired (none to mark)
      vi.mocked(query).mockResolvedValueOnce(mockExpiredRisks); // Second call: find expired
      vi.mocked(query).mockResolvedValueOnce([]); // Third call: escalate

      const result = await escalateExpiredRisks();

      expect(result.escalatedCount).toBe(1);
      expect(result.escalatedRisks).toHaveLength(1);
      // Should update expired risks to escalated
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE qa_risk_acceptances'),
        expect.anything()
      );
    });

    it('should return zero count if no expired risks', async () => {
      // 🟢 WORKING: Test no expired risks to escalate
      vi.mocked(query).mockResolvedValue([]);

      const result = await escalateExpiredRisks();

      expect(result.escalatedCount).toBe(0);
      expect(result.escalatedRisks).toEqual([]);
    });

    it('should mark risks as expired before escalating', async () => {
      // 🟢 WORKING: Test marking risks as expired first
      const today = new Date('2024-01-15');

      vi.mocked(query).mockResolvedValueOnce([]); // First: mark active as expired
      vi.mocked(query).mockResolvedValueOnce([]); // Second: find expired (none)
      vi.mocked(query).mockResolvedValueOnce([]); // Third: escalate (none)

      await escalateExpiredRisks(today);

      // Should call to mark active risks as expired if expiry_date < today
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE qa_risk_acceptances'),
        expect.arrayContaining([RiskAcceptanceStatus.EXPIRED])
      );
    });
  });

  describe('canCloseTicket', () => {
    it('should return true if no active unresolved risks exist', async () => {
      // 🟢 WORKING: Test ticket can be closed
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(query).mockResolvedValue([]); // No active risks

      const result = await canCloseTicket(ticketId);

      expect(result).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ticket_id = $1 AND status = $2'),
        [ticketId, RiskAcceptanceStatus.ACTIVE]
      );
    });

    it('should return false if active risks exist', async () => {
      // 🟢 WORKING: Test ticket cannot be closed with active risks
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockActiveRisks: QARiskAcceptance[] = [
        {
          id: 'risk-uuid-active',
          ticket_id: ticketId,
          risk_type: RiskType.MINOR_DEFECT,
          risk_description: 'Active risk',
          conditions: null,
          risk_expiry_date: new Date('2024-02-15'),
          requires_followup: true,
          followup_date: null,
          status: RiskAcceptanceStatus.ACTIVE,
          resolved_at: null,
          resolved_by: null,
          resolution_notes: null,
          accepted_by: 'user-uuid-qa',
          accepted_at: new Date('2024-01-15T10:00:00Z'),
          created_at: new Date('2024-01-15T10:00:00Z')
        }
      ];

      vi.mocked(query).mockResolvedValue(mockActiveRisks);

      const result = await canCloseTicket(ticketId);

      expect(result).toBe(false);
    });

    it('should return true if only resolved risks exist', async () => {
      // 🟢 WORKING: Test ticket can be closed with only resolved risks
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(query).mockResolvedValue([]); // No active risks (only resolved exist)

      const result = await canCloseTicket(ticketId);

      expect(result).toBe(true);
    });
  });

  describe('getTicketRiskSummary', () => {
    it('should return comprehensive risk summary for ticket', async () => {
      // 🟢 WORKING: Test getting full risk summary
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockAllRisks: QARiskAcceptance[] = [
        {
          id: 'risk-uuid-001',
          ticket_id: ticketId,
          risk_type: RiskType.MINOR_DEFECT,
          risk_description: 'Active risk 1',
          conditions: null,
          risk_expiry_date: new Date('2024-02-15'),
          requires_followup: true,
          followup_date: null,
          status: RiskAcceptanceStatus.ACTIVE,
          resolved_at: null,
          resolved_by: null,
          resolution_notes: null,
          accepted_by: 'user-uuid-qa',
          accepted_at: new Date('2024-01-15T10:00:00Z'),
          created_at: new Date('2024-01-15T10:00:00Z')
        },
        {
          id: 'risk-uuid-002',
          ticket_id: ticketId,
          risk_type: RiskType.DOCUMENTATION_GAP,
          risk_description: 'Resolved risk',
          conditions: 'Upload photo',
          risk_expiry_date: new Date('2024-02-10'),
          requires_followup: true,
          followup_date: null,
          status: RiskAcceptanceStatus.RESOLVED,
          resolved_at: new Date('2024-01-18T10:00:00Z'),
          resolved_by: 'user-uuid-tech',
          resolution_notes: 'Photo uploaded',
          accepted_by: 'user-uuid-qa',
          accepted_at: new Date('2024-01-14T10:00:00Z'),
          created_at: new Date('2024-01-14T10:00:00Z')
        },
        {
          id: 'risk-uuid-003',
          ticket_id: ticketId,
          risk_type: RiskType.PENDING_MATERIAL,
          risk_description: 'Expired risk',
          conditions: 'Deliver material',
          risk_expiry_date: new Date('2024-01-10'),
          requires_followup: true,
          followup_date: null,
          status: RiskAcceptanceStatus.EXPIRED,
          resolved_at: null,
          resolved_by: null,
          resolution_notes: null,
          accepted_by: 'user-uuid-qa',
          accepted_at: new Date('2024-01-05T10:00:00Z'),
          created_at: new Date('2024-01-05T10:00:00Z')
        }
      ];

      vi.mocked(query).mockResolvedValue(mockAllRisks);

      const result = await getTicketRiskSummary(ticketId);

      expect(result.ticket_id).toBe(ticketId);
      expect(result.total_risks).toBe(3);
      expect(result.active_risks).toBe(1);
      expect(result.resolved_risks).toBe(1);
      expect(result.expired_risks).toBe(1);
      expect(result.escalated_risks).toBe(0);
      expect(result.has_blocking_risks).toBe(true); // Has active risks
      expect(result.can_close_ticket).toBe(false); // Cannot close with active risks
      expect(result.risks).toEqual(mockAllRisks);
    });

    it('should indicate ticket can close when no active risks', async () => {
      // 🟢 WORKING: Test summary with no active risks
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      const mockResolvedRisks: QARiskAcceptance[] = [
        {
          id: 'risk-uuid-002',
          ticket_id: ticketId,
          risk_type: RiskType.DOCUMENTATION_GAP,
          risk_description: 'Resolved risk',
          conditions: 'Upload photo',
          risk_expiry_date: new Date('2024-02-10'),
          requires_followup: true,
          followup_date: null,
          status: RiskAcceptanceStatus.RESOLVED,
          resolved_at: new Date('2024-01-18T10:00:00Z'),
          resolved_by: 'user-uuid-tech',
          resolution_notes: 'Photo uploaded',
          accepted_by: 'user-uuid-qa',
          accepted_at: new Date('2024-01-14T10:00:00Z'),
          created_at: new Date('2024-01-14T10:00:00Z')
        }
      ];

      vi.mocked(query).mockResolvedValue(mockResolvedRisks);

      const result = await getTicketRiskSummary(ticketId);

      expect(result.active_risks).toBe(0);
      expect(result.has_blocking_risks).toBe(false);
      expect(result.can_close_ticket).toBe(true);
    });

    it('should return empty summary if no risks exist', async () => {
      // 🟢 WORKING: Test summary with no risks
      const ticketId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(query).mockResolvedValue([]);

      const result = await getTicketRiskSummary(ticketId);

      expect(result.total_risks).toBe(0);
      expect(result.active_risks).toBe(0);
      expect(result.resolved_risks).toBe(0);
      expect(result.expired_risks).toBe(0);
      expect(result.escalated_risks).toBe(0);
      expect(result.has_blocking_risks).toBe(false);
      expect(result.can_close_ticket).toBe(true);
      expect(result.risks).toEqual([]);
    });
  });
});
