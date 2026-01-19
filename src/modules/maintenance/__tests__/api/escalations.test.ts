/**
 * Escalation API Endpoints - Integration Tests
 * 🟢 WORKING: TDD tests for escalation management API endpoints
 *
 * Tests for:
 * - GET /api/ticketing/escalations - List escalations with filters
 * - GET /api/ticketing/escalations/{id} - Get escalation detail
 * - POST /api/ticketing/escalations/{id}/resolve - Resolve escalation
 * - GET /api/ticketing/repeat-faults/check - Check for repeat fault patterns
 *
 * Following TDD methodology: Tests written FIRST, implementation SECOND
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as escalationService from '../../services/escalationService';
import * as faultPatternDetector from '../../utils/faultPatternDetector';
import type { RepeatFaultEscalation, EscalationStatus, EscalationScopeType } from '../../types/escalation';

// Mock the services
vi.mock('../../services/escalationService');
vi.mock('../../utils/faultPatternDetector');
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock escalation data
const mockEscalation: RepeatFaultEscalation = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  scope_type: 'pole' as EscalationScopeType,
  scope_value: 'POLE-123',
  project_id: '660e8400-e29b-41d4-a716-446655440001',
  fault_count: 5,
  fault_threshold: 3,
  contributing_tickets: ['ticket-1', 'ticket-2', 'ticket-3'],
  escalation_ticket_id: null,
  escalation_type: null,
  status: 'open' as EscalationStatus,
  resolution_notes: null,
  resolved_at: null,
  resolved_by: null,
  created_at: new Date('2024-01-15T10:00:00Z'),
};

const mockEscalationResolved: RepeatFaultEscalation = {
  ...mockEscalation,
  id: '770e8400-e29b-41d4-a716-446655440002',
  status: 'resolved' as EscalationStatus,
  resolution_notes: 'Pole replaced, all faults resolved',
  resolved_at: new Date('2024-01-20T15:00:00Z'),
  resolved_by: 'user-123',
};

describe('Escalation API Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/ticketing/escalations', () => {
    it('should list all escalations without filters', async () => {
      // Arrange
      const mockEscalations = [mockEscalation, mockEscalationResolved];
      vi.mocked(escalationService.listEscalations).mockResolvedValue(mockEscalations);

      // Act
      const result = await escalationService.listEscalations();

      // Assert
      expect(result).toEqual(mockEscalations);
      expect(escalationService.listEscalations).toHaveBeenCalledTimes(1);
    });

    it('should list escalations filtered by scope_type', async () => {
      // Arrange
      const filters = { scope_type: 'pole' as EscalationScopeType };
      const filteredEscalations = [mockEscalation];
      vi.mocked(escalationService.listEscalations).mockResolvedValue(filteredEscalations);

      // Act
      const result = await escalationService.listEscalations(filters);

      // Assert
      expect(result).toEqual(filteredEscalations);
      expect(escalationService.listEscalations).toHaveBeenCalledWith(filters);
    });

    it('should list escalations filtered by status', async () => {
      // Arrange
      const filters = { status: 'open' as EscalationStatus };
      const filteredEscalations = [mockEscalation];
      vi.mocked(escalationService.listEscalations).mockResolvedValue(filteredEscalations);

      // Act
      const result = await escalationService.listEscalations(filters);

      // Assert
      expect(result).toEqual(filteredEscalations);
      expect(escalationService.listEscalations).toHaveBeenCalledWith(filters);
    });

    it('should list escalations filtered by project_id', async () => {
      // Arrange
      const filters = { project_id: '660e8400-e29b-41d4-a716-446655440001' };
      const filteredEscalations = [mockEscalation];
      vi.mocked(escalationService.listEscalations).mockResolvedValue(filteredEscalations);

      // Act
      const result = await escalationService.listEscalations(filters);

      // Assert
      expect(result).toEqual(filteredEscalations);
      expect(escalationService.listEscalations).toHaveBeenCalledWith(filters);
    });

    it('should handle multiple filters simultaneously', async () => {
      // Arrange
      const filters = {
        scope_type: 'pole' as EscalationScopeType,
        status: 'open' as EscalationStatus,
        project_id: '660e8400-e29b-41d4-a716-446655440001',
      };
      const filteredEscalations = [mockEscalation];
      vi.mocked(escalationService.listEscalations).mockResolvedValue(filteredEscalations);

      // Act
      const result = await escalationService.listEscalations(filters);

      // Assert
      expect(result).toEqual(filteredEscalations);
      expect(escalationService.listEscalations).toHaveBeenCalledWith(filters);
    });

    it('should return empty array when no escalations match filters', async () => {
      // Arrange
      const filters = { status: 'resolved' as EscalationStatus };
      vi.mocked(escalationService.listEscalations).mockResolvedValue([]);

      // Act
      const result = await escalationService.listEscalations(filters);

      // Assert
      expect(result).toEqual([]);
      expect(escalationService.listEscalations).toHaveBeenCalledWith(filters);
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      vi.mocked(escalationService.listEscalations).mockRejectedValue(
        new Error('Database connection failed')
      );

      // Act & Assert
      await expect(escalationService.listEscalations()).rejects.toThrow('Database connection failed');
    });
  });

  describe('GET /api/ticketing/escalations/{id}', () => {
    it('should get escalation by valid ID', async () => {
      // Arrange
      const escalationId = mockEscalation.id;
      vi.mocked(escalationService.getEscalationById).mockResolvedValue(mockEscalation);

      // Act
      const result = await escalationService.getEscalationById(escalationId);

      // Assert
      expect(result).toEqual(mockEscalation);
      expect(escalationService.getEscalationById).toHaveBeenCalledWith(escalationId);
    });

    it('should reject invalid UUID format', async () => {
      // Arrange
      const invalidId = 'not-a-uuid';
      vi.mocked(escalationService.getEscalationById).mockRejectedValue(
        new Error('Invalid escalation ID format')
      );

      // Act & Assert
      await expect(escalationService.getEscalationById(invalidId)).rejects.toThrow(
        'Invalid escalation ID format'
      );
    });

    it('should handle not found error', async () => {
      // Arrange
      const nonExistentId = '999e8400-e29b-41d4-a716-446655440099';
      vi.mocked(escalationService.getEscalationById).mockRejectedValue(
        new Error('Escalation not found')
      );

      // Act & Assert
      await expect(escalationService.getEscalationById(nonExistentId)).rejects.toThrow(
        'Escalation not found'
      );
    });

    it('should return escalation with all fields populated', async () => {
      // Arrange
      const escalationId = mockEscalationResolved.id;
      vi.mocked(escalationService.getEscalationById).mockResolvedValue(mockEscalationResolved);

      // Act
      const result = await escalationService.getEscalationById(escalationId);

      // Assert
      expect(result).toEqual(mockEscalationResolved);
      expect(result.resolution_notes).toBe('Pole replaced, all faults resolved');
      expect(result.resolved_by).toBe('user-123');
      expect(result.resolved_at).toBeInstanceOf(Date);
    });
  });

  describe('POST /api/ticketing/escalations/{id}/resolve', () => {
    it('should resolve escalation with valid payload', async () => {
      // Arrange
      const escalationId = mockEscalation.id;
      const resolvePayload = {
        resolved_by: 'user-123',
        resolution_notes: 'Infrastructure issue fixed',
        status: 'resolved' as EscalationStatus.RESOLVED,
      };
      const resolvedEscalation = {
        ...mockEscalation,
        ...resolvePayload,
        resolved_at: new Date(),
      };
      vi.mocked(escalationService.resolveEscalation).mockResolvedValue(resolvedEscalation);

      // Act
      const result = await escalationService.resolveEscalation(escalationId, resolvePayload);

      // Assert
      expect(result).toEqual(resolvedEscalation);
      expect(result.status).toBe('resolved');
      expect(result.resolution_notes).toBe('Infrastructure issue fixed');
      expect(result.resolved_by).toBe('user-123');
      expect(escalationService.resolveEscalation).toHaveBeenCalledWith(escalationId, resolvePayload);
    });

    it('should resolve escalation with no_action status', async () => {
      // Arrange
      const escalationId = mockEscalation.id;
      const resolvePayload = {
        resolved_by: 'user-123',
        resolution_notes: 'False alarm - no action needed',
        status: 'no_action' as EscalationStatus.NO_ACTION,
      };
      const resolvedEscalation = {
        ...mockEscalation,
        ...resolvePayload,
        resolved_at: new Date(),
      };
      vi.mocked(escalationService.resolveEscalation).mockResolvedValue(resolvedEscalation);

      // Act
      const result = await escalationService.resolveEscalation(escalationId, resolvePayload);

      // Assert
      expect(result.status).toBe('no_action');
      expect(result.resolution_notes).toBe('False alarm - no action needed');
    });

    it('should reject resolve without resolution_notes', async () => {
      // Arrange
      const escalationId = mockEscalation.id;
      const invalidPayload: any = {
        resolved_by: 'user-123',
        status: 'resolved',
      };
      vi.mocked(escalationService.resolveEscalation).mockRejectedValue(
        new Error('resolution_notes is required')
      );

      // Act & Assert
      await expect(escalationService.resolveEscalation(escalationId, invalidPayload)).rejects.toThrow(
        'resolution_notes is required'
      );
    });

    it('should reject resolve with empty resolution_notes', async () => {
      // Arrange
      const escalationId = mockEscalation.id;
      const invalidPayload = {
        resolved_by: 'user-123',
        resolution_notes: '   ',
        status: 'resolved' as EscalationStatus.RESOLVED,
      };
      vi.mocked(escalationService.resolveEscalation).mockRejectedValue(
        new Error('resolution_notes is required')
      );

      // Act & Assert
      await expect(escalationService.resolveEscalation(escalationId, invalidPayload)).rejects.toThrow(
        'resolution_notes is required'
      );
    });

    it('should reject resolve with invalid escalation ID', async () => {
      // Arrange
      const invalidId = 'not-a-uuid';
      const payload = {
        resolved_by: 'user-123',
        resolution_notes: 'Fixed',
        status: 'resolved' as EscalationStatus.RESOLVED,
      };
      vi.mocked(escalationService.resolveEscalation).mockRejectedValue(
        new Error('Invalid escalation ID format')
      );

      // Act & Assert
      await expect(escalationService.resolveEscalation(invalidId, payload)).rejects.toThrow(
        'Invalid escalation ID format'
      );
    });

    it('should handle database errors during resolve', async () => {
      // Arrange
      const escalationId = mockEscalation.id;
      const payload = {
        resolved_by: 'user-123',
        resolution_notes: 'Fixed',
        status: 'resolved' as EscalationStatus.RESOLVED,
      };
      vi.mocked(escalationService.resolveEscalation).mockRejectedValue(
        new Error('Database error')
      );

      // Act & Assert
      await expect(escalationService.resolveEscalation(escalationId, payload)).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('GET /api/ticketing/repeat-faults/check', () => {
    it('should check pattern for pole with faults exceeding threshold', async () => {
      // Arrange
      const input = {
        scope_type: 'pole' as EscalationScopeType,
        scope_value: 'POLE-123',
        time_window_days: 30,
        threshold: 3,
      };
      const mockResult = {
        pattern_detected: true,
        scope_type: 'pole' as EscalationScopeType,
        scope_value: 'POLE-123',
        fault_count: 5,
        threshold: 3,
        contributing_tickets: [
          {
            ticket_id: 'ticket-1',
            ticket_uid: 'FT001',
            created_at: new Date(),
            fault_cause: 'workmanship',
            status: 'open',
          },
        ],
        should_escalate: true,
        existing_escalation_id: null,
        recommendation: 'ESCALATE: 5 faults detected on pole POLE-123',
      };
      vi.mocked(faultPatternDetector.detectFaultPattern).mockResolvedValue(mockResult);

      // Act
      const result = await faultPatternDetector.detectFaultPattern(input);

      // Assert
      expect(result.pattern_detected).toBe(true);
      expect(result.should_escalate).toBe(true);
      expect(result.fault_count).toBe(5);
      expect(result.threshold).toBe(3);
      expect(faultPatternDetector.detectFaultPattern).toHaveBeenCalledWith(input);
    });

    it('should check pattern for PON below threshold', async () => {
      // Arrange
      const input = {
        scope_type: 'pon' as EscalationScopeType,
        scope_value: 'PON-456',
        time_window_days: 30,
        threshold: 5,
      };
      const mockResult = {
        pattern_detected: false,
        scope_type: 'pon' as EscalationScopeType,
        scope_value: 'PON-456',
        fault_count: 2,
        threshold: 5,
        contributing_tickets: [],
        should_escalate: false,
        existing_escalation_id: null,
        recommendation: 'Monitor: 2 fault(s) on pon PON-456',
      };
      vi.mocked(faultPatternDetector.detectFaultPattern).mockResolvedValue(mockResult);

      // Act
      const result = await faultPatternDetector.detectFaultPattern(input);

      // Assert
      expect(result.pattern_detected).toBe(false);
      expect(result.should_escalate).toBe(false);
      expect(result.fault_count).toBe(2);
    });

    it('should check pattern and find existing escalation', async () => {
      // Arrange
      const input = {
        scope_type: 'zone' as EscalationScopeType,
        scope_value: 'ZONE-789',
        time_window_days: 30,
        threshold: 10,
      };
      const mockResult = {
        pattern_detected: true,
        scope_type: 'zone' as EscalationScopeType,
        scope_value: 'ZONE-789',
        fault_count: 12,
        threshold: 10,
        contributing_tickets: [],
        should_escalate: false,
        existing_escalation_id: 'existing-escalation-123',
        recommendation: 'Pattern detected but active escalation exists',
      };
      vi.mocked(faultPatternDetector.detectFaultPattern).mockResolvedValue(mockResult);

      // Act
      const result = await faultPatternDetector.detectFaultPattern(input);

      // Assert
      expect(result.pattern_detected).toBe(true);
      expect(result.should_escalate).toBe(false);
      expect(result.existing_escalation_id).toBe('existing-escalation-123');
    });

    it('should handle check with project filter', async () => {
      // Arrange
      const input = {
        scope_type: 'dr' as EscalationScopeType,
        scope_value: 'DR-001',
        time_window_days: 30,
        threshold: 2,
        project_id: 'project-123',
      };
      const mockResult = {
        pattern_detected: true,
        scope_type: 'dr' as EscalationScopeType,
        scope_value: 'DR-001',
        fault_count: 3,
        threshold: 2,
        contributing_tickets: [],
        should_escalate: true,
        existing_escalation_id: null,
        recommendation: 'ESCALATE: 3 faults on DR DR-001',
      };
      vi.mocked(faultPatternDetector.detectFaultPattern).mockResolvedValue(mockResult);

      // Act
      const result = await faultPatternDetector.detectFaultPattern(input);

      // Assert
      expect(result).toEqual(mockResult);
      expect(faultPatternDetector.detectFaultPattern).toHaveBeenCalledWith(input);
    });

    it('should reject check with empty scope_value', async () => {
      // Arrange
      const input = {
        scope_type: 'pole' as EscalationScopeType,
        scope_value: '',
        time_window_days: 30,
        threshold: 3,
      };
      const mockResult = {
        pattern_detected: false,
        scope_type: 'pole' as EscalationScopeType,
        scope_value: '',
        fault_count: 0,
        threshold: 3,
        contributing_tickets: [],
        should_escalate: false,
        existing_escalation_id: null,
        recommendation: 'No scope value provided',
      };
      vi.mocked(faultPatternDetector.detectFaultPattern).mockResolvedValue(mockResult);

      // Act
      const result = await faultPatternDetector.detectFaultPattern(input);

      // Assert
      expect(result.pattern_detected).toBe(false);
      expect(result.fault_count).toBe(0);
      expect(result.recommendation).toBe('No scope value provided');
    });

    it('should use default thresholds when not specified', async () => {
      // Arrange
      const defaultThresholds = {
        pole_threshold: 3,
        pon_threshold: 5,
        zone_threshold: 10,
        dr_threshold: 2,
        time_window_days: 30,
      };
      vi.mocked(faultPatternDetector.getDefaultThresholds).mockReturnValue(defaultThresholds);

      // Act
      const result = faultPatternDetector.getDefaultThresholds();

      // Assert
      expect(result).toEqual(defaultThresholds);
      expect(result.pole_threshold).toBe(3);
      expect(result.pon_threshold).toBe(5);
      expect(result.zone_threshold).toBe(10);
      expect(result.dr_threshold).toBe(2);
      expect(result.time_window_days).toBe(30);
    });
  });
});
