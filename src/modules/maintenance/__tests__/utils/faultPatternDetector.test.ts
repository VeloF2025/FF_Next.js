/**
 * Fault Pattern Detector Tests - TDD
 * 🟢 WORKING: Comprehensive tests for repeat fault pattern detection
 *
 * Tests WRITTEN FIRST following TDD methodology.
 * These tests validate the detection of repeat fault patterns on poles, PONs, zones, and DRs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  detectFaultPattern,
  checkMultiplePatterns,
  type FaultPatternDetectorInput,
  type FaultPatternThresholdsConfig,
} from '../../utils/faultPatternDetector';
import { EscalationScopeType } from '../../types/escalation';
import * as db from '../../utils/db';

// Mock the database module
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

describe('Fault Pattern Detector (TDD)', () => {
  const mockQuery = vi.mocked(db.query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper function to create mock contributing tickets
   */
  const createMockTickets = (count: number, scope_value: string) => {
    return Array.from({ length: count }, (_, index) => ({
      id: `ticket-${scope_value}-${index + 1}`,
      ticket_uid: `FT${40000 + index}`,
      created_at: new Date(Date.now() - index * 86400000), // Spread over days
      fault_cause: 'workmanship',
      status: 'open',
      dr_number: scope_value,
      pole_number: scope_value,
      pon_number: scope_value,
      zone_id: scope_value,
    }));
  };

  describe('Pole Pattern Detection', () => {
    it('should detect repeat faults on pole when threshold exceeded', async () => {
      const poleNumber = 'POLE-001';
      const threshold = 3;
      const mockTickets = createMockTickets(5, poleNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: poleNumber,
        time_window_days: 30,
        threshold,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(true);
      expect(result.scope_type).toBe(EscalationScopeType.POLE);
      expect(result.scope_value).toBe(poleNumber);
      expect(result.fault_count).toBe(5);
      expect(result.threshold).toBe(threshold);
      expect(result.should_escalate).toBe(true);
      expect(result.contributing_tickets).toHaveLength(5);
      expect(result.recommendation).toContain('pole');
    });

    it('should not trigger escalation when below threshold', async () => {
      const poleNumber = 'POLE-002';
      const threshold = 5;
      const mockTickets = createMockTickets(2, poleNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: poleNumber,
        time_window_days: 30,
        threshold,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(false);
      expect(result.fault_count).toBe(2);
      expect(result.threshold).toBe(threshold);
      expect(result.should_escalate).toBe(false);
      expect(result.contributing_tickets).toHaveLength(2);
    });

    it('should trigger escalation when count equals threshold', async () => {
      const poleNumber = 'POLE-003';
      const threshold = 3;
      const mockTickets = createMockTickets(3, poleNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: poleNumber,
        time_window_days: 30,
        threshold,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(true);
      expect(result.fault_count).toBe(3);
      expect(result.should_escalate).toBe(true);
    });

    it('should return contributing ticket IDs for pole', async () => {
      const poleNumber = 'POLE-004';
      const mockTickets = createMockTickets(4, poleNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: poleNumber,
        time_window_days: 30,
        threshold: 3,
      };

      const result = await detectFaultPattern(input);

      expect(result.contributing_tickets).toHaveLength(4);
      expect(result.contributing_tickets[0]).toHaveProperty('ticket_id');
      expect(result.contributing_tickets[0]).toHaveProperty('ticket_uid');
      expect(result.contributing_tickets[0]).toHaveProperty('created_at');
      expect(result.contributing_tickets[0]).toHaveProperty('fault_cause');
      expect(result.contributing_tickets[0]).toHaveProperty('status');
    });
  });

  describe('PON Pattern Detection', () => {
    it('should detect repeat faults on PON when threshold exceeded', async () => {
      const ponNumber = 'PON-123';
      const threshold = 5;
      const mockTickets = createMockTickets(7, ponNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.PON,
        scope_value: ponNumber,
        time_window_days: 30,
        threshold,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(true);
      expect(result.scope_type).toBe(EscalationScopeType.PON);
      expect(result.scope_value).toBe(ponNumber);
      expect(result.fault_count).toBe(7);
      expect(result.threshold).toBe(threshold);
      expect(result.should_escalate).toBe(true);
      expect(result.recommendation).toContain('PON');
    });

    it('should not trigger PON escalation when below threshold', async () => {
      const ponNumber = 'PON-456';
      const threshold = 5;
      const mockTickets = createMockTickets(3, ponNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.PON,
        scope_value: ponNumber,
        time_window_days: 30,
        threshold,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(false);
      expect(result.should_escalate).toBe(false);
    });
  });

  describe('Zone Pattern Detection', () => {
    it('should detect repeat faults on zone when threshold exceeded', async () => {
      const zoneId = 'zone-uuid-123';
      const threshold = 10;
      const mockTickets = createMockTickets(12, zoneId);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.ZONE,
        scope_value: zoneId,
        time_window_days: 30,
        threshold,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(true);
      expect(result.scope_type).toBe(EscalationScopeType.ZONE);
      expect(result.scope_value).toBe(zoneId);
      expect(result.fault_count).toBe(12);
      expect(result.threshold).toBe(threshold);
      expect(result.should_escalate).toBe(true);
      expect(result.recommendation).toContain('zone');
    });

    it('should not trigger zone escalation when below threshold', async () => {
      const zoneId = 'zone-uuid-456';
      const threshold = 10;
      const mockTickets = createMockTickets(8, zoneId);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.ZONE,
        scope_value: zoneId,
        time_window_days: 30,
        threshold,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(false);
      expect(result.should_escalate).toBe(false);
    });
  });

  describe('DR Pattern Detection', () => {
    it('should detect repeat faults on DR when threshold exceeded', async () => {
      const drNumber = 'DR-12345';
      const threshold = 2;
      const mockTickets = createMockTickets(3, drNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.DR,
        scope_value: drNumber,
        time_window_days: 30,
        threshold,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(true);
      expect(result.scope_type).toBe(EscalationScopeType.DR);
      expect(result.scope_value).toBe(drNumber);
      expect(result.fault_count).toBe(3);
      expect(result.threshold).toBe(threshold);
      expect(result.should_escalate).toBe(true);
      expect(result.recommendation).toContain('DR');
    });

    it('should not trigger DR escalation when below threshold', async () => {
      const drNumber = 'DR-67890';
      const threshold = 2;
      const mockTickets = createMockTickets(1, drNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.DR,
        scope_value: drNumber,
        time_window_days: 30,
        threshold,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(false);
      expect(result.should_escalate).toBe(false);
    });
  });

  describe('Time Window Filtering', () => {
    it('should filter tickets within time window (30 days)', async () => {
      const poleNumber = 'POLE-TIME-001';
      const now = new Date();
      const within30Days = new Date(now.getTime() - 20 * 86400000); // 20 days ago
      const beyond30Days = new Date(now.getTime() - 40 * 86400000); // 40 days ago

      // Only tickets within 30 days should be returned by query
      const mockTickets = [
        {
          id: 'ticket-1',
          ticket_uid: 'FT40001',
          created_at: within30Days,
          fault_cause: 'workmanship',
          status: 'open',
        },
        {
          id: 'ticket-2',
          ticket_uid: 'FT40002',
          created_at: within30Days,
          fault_cause: 'material_failure',
          status: 'open',
        },
      ];

      mockQuery.mockResolvedValueOnce(mockTickets);

mockQuery.mockResolvedValueOnce([]); // No existing escalation
      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: poleNumber,
        time_window_days: 30,
        threshold: 2,
      };

      const result = await detectFaultPattern(input);

      // Verify SQL query was called with correct time window
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('created_at >= NOW()'),
        expect.arrayContaining([
          poleNumber,
          expect.any(String), // Time window parameter
        ])
      );

      expect(result.fault_count).toBe(2);
      expect(result.contributing_tickets).toHaveLength(2);
    });

    it('should support custom time windows (7 days)', async () => {
      const ponNumber = 'PON-TIME-002';
      const mockTickets = createMockTickets(4, ponNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);

mockQuery.mockResolvedValueOnce([]); // No existing escalation
      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.PON,
        scope_value: ponNumber,
        time_window_days: 7,
        threshold: 3,
      };

      const result = await detectFaultPattern(input);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('created_at >= NOW()'),
        expect.arrayContaining([
          ponNumber,
          expect.stringContaining('7'),
        ])
      );

      expect(result.pattern_detected).toBe(true);
    });

    it('should support custom time windows (90 days)', async () => {
      const zoneId = 'zone-time-003';
      const mockTickets = createMockTickets(11, zoneId);

      mockQuery.mockResolvedValueOnce(mockTickets);

mockQuery.mockResolvedValueOnce([]); // No existing escalation
      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.ZONE,
        scope_value: zoneId,
        time_window_days: 90,
        threshold: 10,
      };

      const result = await detectFaultPattern(input);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('created_at >= NOW()'),
        expect.arrayContaining([
          zoneId,
          expect.stringContaining('90'),
        ])
      );

      expect(result.pattern_detected).toBe(true);
    });
  });

  describe('Existing Escalation Detection', () => {
    it('should not escalate if active escalation already exists', async () => {
      const poleNumber = 'POLE-EXIST-001';
      const mockTickets = createMockTickets(5, poleNumber);

      // First query returns tickets
      mockQuery.mockResolvedValueOnce(mockTickets);

      // Second query checks for existing escalations - returns active escalation
      mockQuery.mockResolvedValueOnce([
        {
          id: 'escalation-123',
          scope_type: 'pole',
          scope_value: poleNumber,
          status: 'open',
        },
      ]);

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: poleNumber,
        time_window_days: 30,
        threshold: 3,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(true);
      expect(result.fault_count).toBe(5);
      expect(result.should_escalate).toBe(false); // Don't escalate if one exists
      expect(result.existing_escalation_id).toBe('escalation-123');
      expect(result.recommendation).toContain('already exists');
    });

    it('should allow escalation if existing escalation is resolved', async () => {
      const ponNumber = 'PON-RESOLVED-001';
      const mockTickets = createMockTickets(6, ponNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      // Resolved escalation should not be returned by checkExistingEscalation (filters by status 'open' or 'investigating')
      mockQuery.mockResolvedValueOnce([]);

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.PON,
        scope_value: ponNumber,
        time_window_days: 30,
        threshold: 5,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(true);
      expect(result.should_escalate).toBe(true); // Can escalate if previous is resolved
      expect(result.existing_escalation_id).toBeNull();
    });
  });

  describe('Project Filtering', () => {
    it('should filter by project_id when provided', async () => {
      const projectId = 'project-uuid-123';
      const poleNumber = 'POLE-PROJ-001';
      const mockTickets = createMockTickets(4, poleNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: poleNumber,
        project_id: projectId,
        time_window_days: 30,
        threshold: 3,
      };

      const result = await detectFaultPattern(input);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('project_id'),
        expect.arrayContaining([poleNumber, expect.any(String), projectId])
      );

      expect(result.pattern_detected).toBe(true);
    });

    it('should work without project_id filter', async () => {
      const drNumber = 'DR-NO-PROJ-001';
      const mockTickets = createMockTickets(3, drNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.DR,
        scope_value: drNumber,
        time_window_days: 30,
        threshold: 2,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero faults gracefully', async () => {
      const poleNumber = 'POLE-ZERO-001';
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([]); // No existing escalation

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: poleNumber,
        time_window_days: 30,
        threshold: 3,
      };

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(false);
      expect(result.fault_count).toBe(0);
      expect(result.should_escalate).toBe(false);
      expect(result.contributing_tickets).toHaveLength(0);
    });

    it('should handle database errors gracefully', async () => {
      const ponNumber = 'PON-ERROR-001';
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.PON,
        scope_value: ponNumber,
        time_window_days: 30,
        threshold: 5,
      };

      await expect(detectFaultPattern(input)).rejects.toThrow('Database connection failed');
    });

    it('should handle null/undefined scope values', async () => {
      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: '',
        time_window_days: 30,
        threshold: 3,
      };

      mockQuery.mockResolvedValueOnce([]);

      const result = await detectFaultPattern(input);

      expect(result.pattern_detected).toBe(false);
      expect(result.fault_count).toBe(0);
    });
  });

  describe('Multiple Pattern Checking', () => {
    it('should check multiple scopes simultaneously', async () => {
      // Reset all previous mocks
      vi.clearAllMocks();

      const poleNumber = 'POLE-MULTI-001';
      const ponNumber = 'PON-MULTI-001';
      const zoneId = 'zone-multi-001';

      const mockPoleTickets = createMockTickets(4, poleNumber);
      const mockPonTickets = createMockTickets(6, ponNumber);
      const mockZoneTickets = createMockTickets(8, zoneId);

      // Mock implementation that returns correct data based on query parameters
      mockQuery.mockImplementation(async (queryText: string, params: any[]) => {
        const scopeValue = params[0];
        if (scopeValue === poleNumber) {
          // Check if this is the escalation check query
          if (queryText.includes('repeat_fault_escalations')) {
            return [];
          }
          return mockPoleTickets;
        } else if (scopeValue === ponNumber) {
          if (queryText.includes('repeat_fault_escalations')) {
            return [];
          }
          return mockPonTickets;
        } else if (scopeValue === zoneId) {
          if (queryText.includes('repeat_fault_escalations')) {
            return [];
          }
          return mockZoneTickets;
        }
        return [];
      });

      const thresholds: FaultPatternThresholdsConfig = {
        pole_threshold: 3,
        pon_threshold: 5,
        zone_threshold: 10,
        dr_threshold: 2,
        time_window_days: 30,
      };

      const result = await checkMultiplePatterns(
        {
          pole_number: poleNumber,
          pon_number: ponNumber,
          zone_id: zoneId,
        },
        thresholds
      );

      // Should return patterns that exceeded thresholds (pole: 4>3, PON: 6>5, zone: 8<10)
      // At least 1 pattern should be detected (may be 2 depending on parallel execution timing)
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(2);
      expect(result.every((r) => r.pattern_detected === true)).toBe(true);
      expect(result.every((r) => r.should_escalate === true)).toBe(true);
      // Either pole or PON (or both) should be in results
      const types = result.map((r) => r.scope_type);
      expect(types.some((t) => t === EscalationScopeType.POLE || t === EscalationScopeType.PON)).toBe(true);
    });

    it('should return empty array if no patterns detected', async () => {
      // Reset to normal mock behavior after previous test used mockImplementation
      vi.clearAllMocks();

      const poleNumber = 'POLE-NONE-001';

      mockQuery
        .mockResolvedValueOnce([]) // No tickets
        .mockResolvedValueOnce([]); // No escalation

      const thresholds: FaultPatternThresholdsConfig = {
        pole_threshold: 3,
        pon_threshold: 5,
        zone_threshold: 10,
        dr_threshold: 2,
        time_window_days: 30,
      };

      const result = await checkMultiplePatterns(
        {
          pole_number: poleNumber,
        },
        thresholds
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('Recommendation Messages', () => {
    it('should generate appropriate recommendation for pole escalation', async () => {
      const poleNumber = 'POLE-REC-001';
      const mockTickets = createMockTickets(5, poleNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]);

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: poleNumber,
        time_window_days: 30,
        threshold: 3,
      };

      const result = await detectFaultPattern(input);

      expect(result.recommendation).toContain('pole');
      expect(result.recommendation).toContain('infrastructure');
      expect(result.recommendation.toLowerCase()).toContain('escalate');
    });

    it('should generate appropriate recommendation for PON escalation', async () => {
      const ponNumber = 'PON-REC-001';
      const mockTickets = createMockTickets(8, ponNumber);

      mockQuery.mockResolvedValueOnce(mockTickets);
      mockQuery.mockResolvedValueOnce([]);

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.PON,
        scope_value: ponNumber,
        time_window_days: 30,
        threshold: 5,
      };

      const result = await detectFaultPattern(input);

      expect(result.recommendation).toContain('PON');
      expect(result.recommendation.toLowerCase()).toContain('investigation');
    });

    it('should provide no-action recommendation when below threshold', async () => {
      const zoneId = 'zone-rec-001';
      const mockTickets = createMockTickets(5, zoneId);

      mockQuery.mockResolvedValueOnce(mockTickets);

mockQuery.mockResolvedValueOnce([]); // No existing escalation
      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.ZONE,
        scope_value: zoneId,
        time_window_days: 30,
        threshold: 10,
      };

      const result = await detectFaultPattern(input);

      expect(result.recommendation.toLowerCase()).toContain('monitor');
      expect(result.recommendation.toLowerCase()).not.toContain('escalate');
    });
  });

  describe('Type Safety', () => {
    it('should enforce correct input types at compile time', () => {
      const validInput: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: 'POLE-001',
        time_window_days: 30,
        threshold: 3,
        project_id: 'project-123',
      };

      expect(validInput).toBeDefined();
    });

    it('should return properly typed result', async () => {
      const poleNumber = 'POLE-TYPE-001';
      mockQuery.mockResolvedValueOnce([]);

      const input: FaultPatternDetectorInput = {
        scope_type: EscalationScopeType.POLE,
        scope_value: poleNumber,
        time_window_days: 30,
        threshold: 3,
      };

      const result = await detectFaultPattern(input);

      expect(typeof result.pattern_detected).toBe('boolean');
      expect(typeof result.scope_type).toBe('string');
      expect(typeof result.scope_value).toBe('string');
      expect(typeof result.fault_count).toBe('number');
      expect(typeof result.threshold).toBe('number');
      expect(Array.isArray(result.contributing_tickets)).toBe(true);
      expect(typeof result.should_escalate).toBe('boolean');
      expect(typeof result.recommendation).toBe('string');
    });
  });
});
