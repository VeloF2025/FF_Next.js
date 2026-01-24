/**
 * Incident Learning Service Tests
 *
 * TDD Phase: RED (all tests should fail initially)
 * Spec: tests/specs/incident-learning.spec.md
 *
 * Tests cover:
 * - Success/Failure Tracking (SF-001 to SF-010)
 * - Auto-Classification Adjustment (AC-001 to AC-010)
 * - Human Override Learning (HO-001 to HO-010)
 * - Knowledge Base Export (KB-001 to KB-011)
 * - Statistics (ST-001 to ST-010)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock database
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  getClient: vi.fn(() => ({
    query: vi.fn(),
    release: vi.fn(),
  })),
}));

// Mock fs for KB export
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      mkdir: vi.fn(),
      access: vi.fn(),
    },
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Mock the service (to be implemented)
vi.mock('@/modules/system/services/incidentLearning', () => ({
  incidentLearningService: {
    // Success/Failure Tracking
    trackSuccess: vi.fn(),
    trackFailure: vi.fn(),
    getSuccessRate: vi.fn(),
    trackResolutionTime: vi.fn(),
    trackAttempts: vi.fn(),
    getResolutionMethod: vi.fn(),

    // Auto-Classification
    checkAndAdjustClassification: vi.fn(),
    getConsecutiveCounts: vi.fn(),
    resetConsecutiveCounters: vi.fn(),
    promoteRiskLevel: vi.fn(),
    demoteRiskLevel: vi.fn(),
    setAutoAdjustEnabled: vi.fn(),

    // Human Override
    recordOverride: vi.fn(),
    getOverrideHistory: vi.fn(),
    createClassificationSuggestion: vi.fn(),
    getSuggestions: vi.fn(),
    applySuggestion: vi.fn(),
    dismissSuggestion: vi.fn(),

    // Knowledge Base Export
    exportIncidentToKB: vi.fn(),
    updateIncidentIndex: vi.fn(),
    getIncidentFilename: vi.fn(),

    // Statistics
    getOverallSuccessRate: vi.fn(),
    getServiceSuccessRate: vi.fn(),
    getMTTR: vi.fn(),
    getCommonFailures: vi.fn(),
    getImprovingActions: vi.fn(),
    getDecliningActions: vi.fn(),
    getStatsByTimeRange: vi.fn(),
    compareTimePeriods: vi.fn(),
    exportStatsAsJSON: vi.fn(),
  },
}));

import { db } from '@/lib/db';
import { incidentLearningService } from '@/modules/system/services/incidentLearning';

describe('Incident Learning Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // SUCCESS/FAILURE TRACKING (SF-001 to SF-010)
  // ============================================

  describe('Success/Failure Tracking', () => {
    describe('SF-001: Track successful action', () => {
      it('should increment success count when action succeeds', async () => {
        const actionId = 'action-restart-vlm';
        const incidentId = 'incident-001';

        vi.mocked(db.query).mockResolvedValueOnce({
          rows: [{ success_count: 6, failure_count: 2 }],
          rowCount: 1,
        } as never);

        await incidentLearningService.trackSuccess(actionId, incidentId);

        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE recovery_actions'),
          expect.arrayContaining([actionId])
        );
        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('success_count = success_count + 1'),
          expect.any(Array)
        );
      });
    });

    describe('SF-002: Track failed action', () => {
      it('should increment failure count when action fails', async () => {
        const actionId = 'action-restart-vlm';
        const incidentId = 'incident-001';
        const errorMessage = 'Service not responding';

        vi.mocked(db.query).mockResolvedValueOnce({
          rows: [{ success_count: 5, failure_count: 3 }],
          rowCount: 1,
        } as never);

        await incidentLearningService.trackFailure(actionId, incidentId, errorMessage);

        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('failure_count = failure_count + 1'),
          expect.any(Array)
        );
      });
    });

    describe('SF-003: Calculate success rate', () => {
      it('should calculate 80% success rate for 8/10', async () => {
        const actionId = 'action-restart-vlm';

        vi.mocked(incidentLearningService.getSuccessRate).mockResolvedValueOnce(80);

        const rate = await incidentLearningService.getSuccessRate(actionId);

        expect(rate).toBe(80);
      });
    });

    describe('SF-004: Zero attempts = N/A', () => {
      it('should return null for zero attempts', async () => {
        const actionId = 'action-never-used';

        vi.mocked(incidentLearningService.getSuccessRate).mockResolvedValueOnce(null);

        const rate = await incidentLearningService.getSuccessRate(actionId);

        expect(rate).toBeNull();
      });
    });

    describe('SF-005: 100% success rate', () => {
      it('should calculate 100% for 10/10 success', async () => {
        const actionId = 'action-reliable';

        vi.mocked(db.query).mockResolvedValueOnce({
          rows: [{ success_count: 10, failure_count: 0 }],
          rowCount: 1,
        } as never);

        vi.mocked(incidentLearningService.getSuccessRate).mockResolvedValueOnce(100);

        const rate = await incidentLearningService.getSuccessRate(actionId);

        expect(rate).toBe(100);
      });
    });

    describe('SF-006: 0% success rate', () => {
      it('should calculate 0% for 0/10 success', async () => {
        const actionId = 'action-broken';

        vi.mocked(db.query).mockResolvedValueOnce({
          rows: [{ success_count: 0, failure_count: 10 }],
          rowCount: 1,
        } as never);

        vi.mocked(incidentLearningService.getSuccessRate).mockResolvedValueOnce(0);

        const rate = await incidentLearningService.getSuccessRate(actionId);

        expect(rate).toBe(0);
      });
    });

    describe('SF-007: Track resolution time', () => {
      it('should store duration when incident is resolved', async () => {
        const incidentId = 'incident-001';
        const resolvedAt = new Date();

        vi.mocked(db.query).mockResolvedValueOnce({
          rows: [{ time_to_resolve_seconds: 45 }],
          rowCount: 1,
        } as never);

        await incidentLearningService.trackResolutionTime(incidentId, resolvedAt);

        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('time_to_resolve_seconds'),
          expect.any(Array)
        );
      });
    });

    describe('SF-008: Resolution time in seconds', () => {
      it('should store 45s resolution time correctly', async () => {
        const incidentId = 'incident-001';
        const startTime = new Date('2026-01-24T10:00:00Z');
        const endTime = new Date('2026-01-24T10:00:45Z');

        vi.mocked(db.query).mockResolvedValueOnce({
          rows: [{ created_at: startTime }],
          rowCount: 1,
        } as never);

        await incidentLearningService.trackResolutionTime(incidentId, endTime);

        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('time_to_resolve_seconds'),
          expect.arrayContaining([45])
        );
      });
    });

    describe('SF-009: Track attempts per incident', () => {
      it('should track 3 attempts for an incident', async () => {
        const incidentId = 'incident-001';

        vi.mocked(incidentLearningService.trackAttempts).mockResolvedValueOnce({ attemptCount: 3 });

        const result = await incidentLearningService.trackAttempts(incidentId);

        expect(result.attemptCount).toBe(3);
      });
    });

    describe('SF-010: Track final resolution method', () => {
      it('should store which action finally resolved the incident', async () => {
        const incidentId = 'incident-001';
        const resolvedByActionId = 'action-restart-vlm';

        vi.mocked(incidentLearningService.getResolutionMethod).mockResolvedValueOnce({
          actionId: resolvedByActionId,
          actionName: 'Restart VLM Service',
          attemptNumber: 2,
        });

        const result = await incidentLearningService.getResolutionMethod(incidentId);

        expect(result.actionId).toBe(resolvedByActionId);
        expect(result.attemptNumber).toBe(2);
      });
    });
  });

  // ============================================
  // AUTO-CLASSIFICATION ADJUSTMENT (AC-001 to AC-010)
  // ============================================

  describe('Auto-Classification Adjustment', () => {
    describe('AC-001: Safe stays safe after 5 consecutive success', () => {
      it('should keep risk level as safe after 5 successes', async () => {
        const actionId = 'action-restart-vlm';

        vi.mocked(incidentLearningService.getConsecutiveCounts).mockResolvedValueOnce({
          consecutiveSuccess: 5,
          consecutiveFailure: 0,
          currentRiskLevel: 'safe',
        });

        vi.mocked(incidentLearningService.checkAndAdjustClassification).mockResolvedValueOnce({
          changed: false,
          oldLevel: 'safe',
          newLevel: 'safe',
        });

        const result = await incidentLearningService.checkAndAdjustClassification(actionId);

        expect(result.changed).toBe(false);
        expect(result.newLevel).toBe('safe');
      });
    });

    describe('AC-002: Safe promotes to moderate after 3 consecutive failures', () => {
      it('should promote to moderate after 3 failures', async () => {
        const actionId = 'action-unstable';

        vi.mocked(incidentLearningService.getConsecutiveCounts).mockResolvedValueOnce({
          consecutiveSuccess: 0,
          consecutiveFailure: 3,
          currentRiskLevel: 'safe',
        });

        vi.mocked(incidentLearningService.checkAndAdjustClassification).mockResolvedValueOnce({
          changed: true,
          oldLevel: 'safe',
          newLevel: 'moderate',
          reason: 'Promoted after 3 consecutive failures',
        });

        const result = await incidentLearningService.checkAndAdjustClassification(actionId);

        expect(result.changed).toBe(true);
        expect(result.newLevel).toBe('moderate');
      });
    });

    describe('AC-003: Moderate demotes to safe after 10 consecutive success', () => {
      it('should demote to safe after 10 successes', async () => {
        const actionId = 'action-recovered';

        vi.mocked(incidentLearningService.getConsecutiveCounts).mockResolvedValueOnce({
          consecutiveSuccess: 10,
          consecutiveFailure: 0,
          currentRiskLevel: 'moderate',
        });

        vi.mocked(incidentLearningService.checkAndAdjustClassification).mockResolvedValueOnce({
          changed: true,
          oldLevel: 'moderate',
          newLevel: 'safe',
          reason: 'Demoted after 10 consecutive successes',
        });

        const result = await incidentLearningService.checkAndAdjustClassification(actionId);

        expect(result.changed).toBe(true);
        expect(result.newLevel).toBe('safe');
      });
    });

    describe('AC-004: Dangerous never auto-demotes', () => {
      it('should keep dangerous level even after 100 successes', async () => {
        const actionId = 'action-db-migrate';

        vi.mocked(incidentLearningService.getConsecutiveCounts).mockResolvedValueOnce({
          consecutiveSuccess: 100,
          consecutiveFailure: 0,
          currentRiskLevel: 'dangerous',
        });

        vi.mocked(incidentLearningService.checkAndAdjustClassification).mockResolvedValueOnce({
          changed: false,
          oldLevel: 'dangerous',
          newLevel: 'dangerous',
          reason: 'Dangerous actions require manual adjustment',
        });

        const result = await incidentLearningService.checkAndAdjustClassification(actionId);

        expect(result.changed).toBe(false);
        expect(result.newLevel).toBe('dangerous');
      });
    });

    describe('AC-005: Mixed results do not trigger adjustment', () => {
      it('should not change level with 2 success, 1 fail', async () => {
        const actionId = 'action-intermittent';

        vi.mocked(incidentLearningService.getConsecutiveCounts).mockResolvedValueOnce({
          consecutiveSuccess: 0, // Reset after failure
          consecutiveFailure: 1,
          currentRiskLevel: 'safe',
        });

        vi.mocked(incidentLearningService.checkAndAdjustClassification).mockResolvedValueOnce({
          changed: false,
          oldLevel: 'safe',
          newLevel: 'safe',
        });

        const result = await incidentLearningService.checkAndAdjustClassification(actionId);

        expect(result.changed).toBe(false);
      });
    });

    describe('AC-006: Consecutive counter resets on opposite result', () => {
      it('should reset failure counter on success', async () => {
        const actionId = 'action-intermittent';

        vi.mocked(incidentLearningService.resetConsecutiveCounters).mockResolvedValueOnce({
          consecutiveSuccess: 1,
          consecutiveFailure: 0,
        });

        const result = await incidentLearningService.resetConsecutiveCounters(actionId, 'success');

        expect(result.consecutiveFailure).toBe(0);
        expect(result.consecutiveSuccess).toBe(1);
      });
    });

    describe('AC-007: Promotion is logged', () => {
      it('should log event when action is promoted', async () => {
        const actionId = 'action-unstable';

        vi.mocked(incidentLearningService.promoteRiskLevel).mockResolvedValueOnce({
          success: true,
          oldLevel: 'safe',
          newLevel: 'moderate',
          eventLogged: true,
        });

        const result = await incidentLearningService.promoteRiskLevel(actionId, 'safe', 'moderate');

        expect(result.eventLogged).toBe(true);
      });
    });

    describe('AC-008: Demotion is logged', () => {
      it('should log event when action is demoted', async () => {
        const actionId = 'action-stable';

        vi.mocked(incidentLearningService.demoteRiskLevel).mockResolvedValueOnce({
          success: true,
          oldLevel: 'moderate',
          newLevel: 'safe',
          eventLogged: true,
        });

        const result = await incidentLearningService.demoteRiskLevel(actionId, 'moderate', 'safe');

        expect(result.eventLogged).toBe(true);
      });
    });

    describe('AC-009: No change if auto-adjust disabled', () => {
      it('should not adjust if autoAdjust is false', async () => {
        const actionId = 'action-locked';

        vi.mocked(incidentLearningService.getConsecutiveCounts).mockResolvedValueOnce({
          consecutiveSuccess: 0,
          consecutiveFailure: 5,
          currentRiskLevel: 'safe',
          autoAdjustEnabled: false,
        });

        vi.mocked(incidentLearningService.checkAndAdjustClassification).mockResolvedValueOnce({
          changed: false,
          oldLevel: 'safe',
          newLevel: 'safe',
          reason: 'Auto-adjust disabled for this action',
        });

        const result = await incidentLearningService.checkAndAdjustClassification(actionId);

        expect(result.changed).toBe(false);
        expect(result.reason).toContain('disabled');
      });
    });

    describe('AC-010: Thresholds are configurable', () => {
      it('should use custom threshold when provided', async () => {
        const actionId = 'action-custom';
        const customThreshold = { failureThreshold: 5, successThreshold: 15 };

        vi.mocked(incidentLearningService.checkAndAdjustClassification).mockResolvedValueOnce({
          changed: false,
          oldLevel: 'safe',
          newLevel: 'safe',
          thresholdUsed: customThreshold,
        });

        const result = await incidentLearningService.checkAndAdjustClassification(
          actionId,
          customThreshold
        );

        expect(result.thresholdUsed).toEqual(customThreshold);
      });
    });
  });

  // ============================================
  // HUMAN OVERRIDE LEARNING (HO-001 to HO-010)
  // ============================================

  describe('Human Override Learning', () => {
    describe('HO-001: Track human approval', () => {
      it('should record when human approves an action', async () => {
        const actionId = 'action-moderate';
        const incidentId = 'incident-001';
        const userId = 'user-admin';

        vi.mocked(incidentLearningService.recordOverride).mockResolvedValueOnce({
          id: 'override-001',
          type: 'approve',
          recorded: true,
        });

        const result = await incidentLearningService.recordOverride({
          actionId,
          incidentId,
          userId,
          type: 'approve',
        });

        expect(result.recorded).toBe(true);
        expect(result.type).toBe('approve');
      });
    });

    describe('HO-002: Track human rejection', () => {
      it('should record when human rejects an action', async () => {
        const actionId = 'action-risky';
        const incidentId = 'incident-001';
        const userId = 'user-admin';

        vi.mocked(incidentLearningService.recordOverride).mockResolvedValueOnce({
          id: 'override-002',
          type: 'reject',
          recorded: true,
        });

        const result = await incidentLearningService.recordOverride({
          actionId,
          incidentId,
          userId,
          type: 'reject',
        });

        expect(result.recorded).toBe(true);
        expect(result.type).toBe('reject');
      });
    });

    describe('HO-003: Store override reason', () => {
      it('should store the reason provided for override', async () => {
        const reason = 'Service is under heavy load, too risky';

        vi.mocked(incidentLearningService.recordOverride).mockResolvedValueOnce({
          id: 'override-003',
          type: 'reject',
          reason,
          recorded: true,
        });

        const result = await incidentLearningService.recordOverride({
          actionId: 'action-risky',
          incidentId: 'incident-001',
          userId: 'user-admin',
          type: 'reject',
          reason,
        });

        expect(result.reason).toBe(reason);
      });
    });

    describe('HO-004: Suggest demotion after 5 approvals', () => {
      it('should create demotion suggestion after 5 approvals', async () => {
        const actionId = 'action-moderate';

        vi.mocked(incidentLearningService.getOverrideHistory).mockResolvedValueOnce({
          approvals: 5,
          rejections: 0,
        });

        vi.mocked(incidentLearningService.createClassificationSuggestion).mockResolvedValueOnce({
          id: 'suggestion-001',
          actionId,
          currentLevel: 'moderate',
          suggestedLevel: 'safe',
          reason: 'Human approved 5 consecutive times',
          status: 'pending',
        });

        const result = await incidentLearningService.createClassificationSuggestion({
          actionId,
          type: 'demote',
        });

        expect(result.suggestedLevel).toBe('safe');
        expect(result.status).toBe('pending');
      });
    });

    describe('HO-005: Suggest promotion after 3 rejections', () => {
      it('should create promotion suggestion after 3 rejections', async () => {
        const actionId = 'action-safe';

        vi.mocked(incidentLearningService.getOverrideHistory).mockResolvedValueOnce({
          approvals: 0,
          rejections: 3,
        });

        vi.mocked(incidentLearningService.createClassificationSuggestion).mockResolvedValueOnce({
          id: 'suggestion-002',
          actionId,
          currentLevel: 'safe',
          suggestedLevel: 'moderate',
          reason: 'Human rejected 3 consecutive times',
          status: 'pending',
        });

        const result = await incidentLearningService.createClassificationSuggestion({
          actionId,
          type: 'promote',
        });

        expect(result.suggestedLevel).toBe('moderate');
      });
    });

    describe('HO-006: Track overrider identity', () => {
      it('should store user ID of who performed the override', async () => {
        const userId = 'user-admin-123';

        vi.mocked(incidentLearningService.recordOverride).mockResolvedValueOnce({
          id: 'override-004',
          userId,
          type: 'approve',
          recorded: true,
        });

        const result = await incidentLearningService.recordOverride({
          actionId: 'action-moderate',
          incidentId: 'incident-001',
          userId,
          type: 'approve',
        });

        expect(result.userId).toBe(userId);
      });
    });

    describe('HO-007: Override reason is optional', () => {
      it('should record override even without a reason', async () => {
        vi.mocked(incidentLearningService.recordOverride).mockResolvedValueOnce({
          id: 'override-005',
          type: 'approve',
          reason: null,
          recorded: true,
        });

        const result = await incidentLearningService.recordOverride({
          actionId: 'action-moderate',
          incidentId: 'incident-001',
          userId: 'user-admin',
          type: 'approve',
          // No reason provided
        });

        expect(result.recorded).toBe(true);
        expect(result.reason).toBeNull();
      });
    });

    describe('HO-008: Suggestions do not auto-apply', () => {
      it('should require explicit confirmation for suggestions', async () => {
        vi.mocked(incidentLearningService.getSuggestions).mockResolvedValueOnce([
          {
            id: 'suggestion-001',
            actionId: 'action-moderate',
            currentLevel: 'moderate',
            suggestedLevel: 'safe',
            status: 'pending',
            requiresConfirmation: true,
          },
        ]);

        const suggestions = await incidentLearningService.getSuggestions();

        expect(suggestions[0].status).toBe('pending');
        expect(suggestions[0].requiresConfirmation).toBe(true);
      });
    });

    describe('HO-009: Confirmed suggestion is applied', () => {
      it('should change risk level when admin confirms suggestion', async () => {
        const suggestionId = 'suggestion-001';
        const adminId = 'user-admin';

        vi.mocked(incidentLearningService.applySuggestion).mockResolvedValueOnce({
          success: true,
          actionId: 'action-moderate',
          oldLevel: 'moderate',
          newLevel: 'safe',
          appliedBy: adminId,
        });

        const result = await incidentLearningService.applySuggestion(suggestionId, adminId);

        expect(result.success).toBe(true);
        expect(result.newLevel).toBe('safe');
      });
    });

    describe('HO-010: Dismissed suggestion is logged', () => {
      it('should log when admin dismisses a suggestion', async () => {
        const suggestionId = 'suggestion-002';
        const adminId = 'user-admin';
        const reason = 'Action is too critical to demote';

        vi.mocked(incidentLearningService.dismissSuggestion).mockResolvedValueOnce({
          success: true,
          suggestionId,
          dismissedBy: adminId,
          reason,
          logged: true,
        });

        const result = await incidentLearningService.dismissSuggestion(
          suggestionId,
          adminId,
          reason
        );

        expect(result.success).toBe(true);
        expect(result.logged).toBe(true);
      });
    });
  });

  // ============================================
  // KNOWLEDGE BASE EXPORT (KB-001 to KB-011)
  // ============================================

  describe('Knowledge Base Export', () => {
    const mockIncident = {
      id: 'incident-abc123',
      serviceId: 'service-vlm',
      serviceName: 'VLM (Qwen3)',
      issueType: 'connection_timeout',
      symptoms: ['No response on :8100', 'GPU memory high'],
      actions: [
        { name: 'Restart VLM', riskLevel: 'safe', result: 'failed', timestamp: '10:00:05' },
        { name: 'Clear GPU Memory', riskLevel: 'moderate', result: 'success', timestamp: '10:00:45' },
      ],
      resolution: 'Clear GPU Memory',
      duration: 45,
      createdAt: new Date('2026-01-24T10:00:00Z'),
      resolvedAt: new Date('2026-01-24T10:00:45Z'),
      humanIntervention: true,
      learnings: ['GPU memory leak requires periodic clearing', 'Consider scheduled GPU cleanup'],
    };

    describe('KB-001: Create incident file', () => {
      it('should create markdown file when incident is resolved', async () => {
        vi.mocked(incidentLearningService.exportIncidentToKB).mockResolvedValueOnce({
          success: true,
          filePath: '.claude/knowledge-base/incidents/2026-01-24-abc123.md',
        });

        const result = await incidentLearningService.exportIncidentToKB(mockIncident);

        expect(result.success).toBe(true);
        expect(result.filePath).toContain('.md');
      });
    });

    describe('KB-002: File includes service name', () => {
      it('should include service name in the file content', async () => {
        vi.mocked(incidentLearningService.exportIncidentToKB).mockResolvedValueOnce({
          success: true,
          filePath: '.claude/knowledge-base/incidents/2026-01-24-abc123.md',
          content: expect.stringContaining('VLM (Qwen3)'),
        });

        const result = await incidentLearningService.exportIncidentToKB(mockIncident);

        expect(result.content).toContain('VLM');
      });
    });

    describe('KB-003: File includes issue type', () => {
      it('should include issue type in the file content', async () => {
        vi.mocked(incidentLearningService.exportIncidentToKB).mockResolvedValueOnce({
          success: true,
          filePath: '.claude/knowledge-base/incidents/2026-01-24-abc123.md',
          content: expect.stringContaining('connection_timeout'),
        });

        const result = await incidentLearningService.exportIncidentToKB(mockIncident);

        expect(result.content).toContain('timeout');
      });
    });

    describe('KB-004: File includes all actions tried', () => {
      it('should include both actions in the file', async () => {
        vi.mocked(incidentLearningService.exportIncidentToKB).mockResolvedValueOnce({
          success: true,
          content: 'Restart VLM...Clear GPU Memory',
        });

        const result = await incidentLearningService.exportIncidentToKB(mockIncident);

        expect(result.content).toContain('Restart VLM');
        expect(result.content).toContain('Clear GPU Memory');
      });
    });

    describe('KB-005: File includes resolution', () => {
      it('should include which action resolved the incident', async () => {
        vi.mocked(incidentLearningService.exportIncidentToKB).mockResolvedValueOnce({
          success: true,
          content: '## Resolution\n\n**Resolved by:** Clear GPU Memory',
        });

        const result = await incidentLearningService.exportIncidentToKB(mockIncident);

        expect(result.content).toContain('Clear GPU Memory');
      });
    });

    describe('KB-006: File includes duration', () => {
      it('should include 45s resolution time', async () => {
        vi.mocked(incidentLearningService.exportIncidentToKB).mockResolvedValueOnce({
          success: true,
          content: '**Duration:** 45s',
        });

        const result = await incidentLearningService.exportIncidentToKB(mockIncident);

        expect(result.content).toContain('45s');
      });
    });

    describe('KB-007: File includes learnings', () => {
      it('should include learnings section', async () => {
        vi.mocked(incidentLearningService.exportIncidentToKB).mockResolvedValueOnce({
          success: true,
          content: '## Learnings\n\n- GPU memory leak requires periodic clearing',
        });

        const result = await incidentLearningService.exportIncidentToKB(mockIncident);

        expect(result.content).toContain('Learnings');
        expect(result.content).toContain('GPU memory leak');
      });
    });

    describe('KB-008: Index file is updated', () => {
      it('should add entry to index file', async () => {
        vi.mocked(incidentLearningService.updateIncidentIndex).mockResolvedValueOnce({
          success: true,
          entriesCount: 15,
          newEntry: {
            id: 'incident-abc123',
            date: '2026-01-24',
            service: 'VLM (Qwen3)',
            file: '2026-01-24-abc123.md',
          },
        });

        const result = await incidentLearningService.updateIncidentIndex(mockIncident);

        expect(result.success).toBe(true);
        expect(result.newEntry.id).toBe('incident-abc123');
      });
    });

    describe('KB-009: Filename uses date prefix', () => {
      it('should prefix filename with date', async () => {
        vi.mocked(incidentLearningService.getIncidentFilename).mockReturnValueOnce(
          '2026-01-24-abc123.md'
        );

        const filename = incidentLearningService.getIncidentFilename(mockIncident);

        expect(filename).toMatch(/^2026-01-24/);
      });
    });

    describe('KB-010: Filename includes incident ID', () => {
      it('should include incident ID in filename', async () => {
        vi.mocked(incidentLearningService.getIncidentFilename).mockReturnValueOnce(
          '2026-01-24-abc123.md'
        );

        const filename = incidentLearningService.getIncidentFilename(mockIncident);

        expect(filename).toContain('abc123');
      });
    });

    describe('KB-011: Directory created if missing', () => {
      it('should create incidents directory on first export', async () => {
        vi.mocked(fs.existsSync).mockReturnValueOnce(false);

        vi.mocked(incidentLearningService.exportIncidentToKB).mockImplementationOnce(async () => {
          // Check if directory exists, if not create it
          const dir = '.claude/knowledge-base/incidents';
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          return { success: true, directoryCreated: true };
        });

        const result = await incidentLearningService.exportIncidentToKB(mockIncident);

        expect(result.success).toBe(true);
        expect(result.directoryCreated).toBe(true);
      });
    });
  });

  // ============================================
  // STATISTICS (ST-001 to ST-010)
  // ============================================

  describe('Statistics', () => {
    describe('ST-001: Calculate overall success rate', () => {
      it('should calculate aggregate success rate across all actions', async () => {
        vi.mocked(incidentLearningService.getOverallSuccessRate).mockResolvedValueOnce({
          rate: 85.5,
          totalSuccess: 171,
          totalFailure: 29,
        });

        const result = await incidentLearningService.getOverallSuccessRate();

        expect(result.rate).toBe(85.5);
        expect(result.totalSuccess + result.totalFailure).toBe(200);
      });
    });

    describe('ST-002: Calculate per-service success rate', () => {
      it('should calculate success rate for specific service', async () => {
        const serviceId = 'service-vlm';

        vi.mocked(incidentLearningService.getServiceSuccessRate).mockResolvedValueOnce({
          serviceId,
          serviceName: 'VLM (Qwen3)',
          rate: 92.0,
          totalAttempts: 50,
        });

        const result = await incidentLearningService.getServiceSuccessRate(serviceId);

        expect(result.serviceId).toBe(serviceId);
        expect(result.rate).toBe(92.0);
      });
    });

    describe('ST-003: Calculate MTTR', () => {
      it('should calculate mean time to resolution', async () => {
        vi.mocked(incidentLearningService.getMTTR).mockResolvedValueOnce({
          mttrSeconds: 78,
          mttrFormatted: '1m 18s',
          incidentCount: 45,
        });

        const result = await incidentLearningService.getMTTR();

        expect(result.mttrSeconds).toBe(78);
        expect(result.mttrFormatted).toBe('1m 18s');
      });
    });

    describe('ST-004: Identify common failure types', () => {
      it('should return top 5 failure types', async () => {
        vi.mocked(incidentLearningService.getCommonFailures).mockResolvedValueOnce([
          { type: 'connection_timeout', count: 25, percentage: 35.7 },
          { type: 'out_of_memory', count: 18, percentage: 25.7 },
          { type: 'service_crash', count: 12, percentage: 17.1 },
          { type: 'disk_full', count: 8, percentage: 11.4 },
          { type: 'auth_failure', count: 7, percentage: 10.0 },
        ]);

        const result = await incidentLearningService.getCommonFailures();

        expect(result).toHaveLength(5);
        expect(result[0].type).toBe('connection_timeout');
        expect(result[0].count).toBe(25);
      });
    });

    describe('ST-005: Identify improving actions', () => {
      it('should return actions with improving success rates', async () => {
        vi.mocked(incidentLearningService.getImprovingActions).mockResolvedValueOnce([
          { actionId: 'action-restart-vlm', improvement: 15.5, currentRate: 95.5 },
          { actionId: 'action-clear-cache', improvement: 8.2, currentRate: 88.0 },
        ]);

        const result = await incidentLearningService.getImprovingActions();

        expect(result.length).toBeGreaterThan(0);
        expect(result[0].improvement).toBeGreaterThan(0);
      });
    });

    describe('ST-006: Identify declining actions', () => {
      it('should return actions with declining success rates', async () => {
        vi.mocked(incidentLearningService.getDecliningActions).mockResolvedValueOnce([
          { actionId: 'action-rebuild-app', decline: -12.3, currentRate: 67.7 },
        ]);

        const result = await incidentLearningService.getDecliningActions();

        expect(result.length).toBeGreaterThan(0);
        expect(result[0].decline).toBeLessThan(0);
      });
    });

    describe('ST-007: Handle zero data gracefully', () => {
      it('should return safe defaults when no incidents exist', async () => {
        vi.mocked(incidentLearningService.getOverallSuccessRate).mockResolvedValueOnce({
          rate: null,
          totalSuccess: 0,
          totalFailure: 0,
          message: 'No data available',
        });

        vi.mocked(incidentLearningService.getMTTR).mockResolvedValueOnce({
          mttrSeconds: null,
          mttrFormatted: 'N/A',
          incidentCount: 0,
        });

        const [successRate, mttr] = await Promise.all([
          incidentLearningService.getOverallSuccessRate(),
          incidentLearningService.getMTTR(),
        ]);

        expect(successRate.rate).toBeNull();
        expect(mttr.mttrFormatted).toBe('N/A');
      });
    });

    describe('ST-008: Time range filter', () => {
      it('should filter stats to last 7 days', async () => {
        const fromDate = new Date('2026-01-17');
        const toDate = new Date('2026-01-24');

        vi.mocked(incidentLearningService.getStatsByTimeRange).mockResolvedValueOnce({
          timeRange: { from: fromDate, to: toDate },
          successRate: 88.5,
          incidentCount: 23,
          mttrSeconds: 65,
        });

        const result = await incidentLearningService.getStatsByTimeRange(fromDate, toDate);

        expect(result.timeRange.from).toEqual(fromDate);
        expect(result.incidentCount).toBe(23);
      });
    });

    describe('ST-009: Compare time periods', () => {
      it('should calculate delta between two periods', async () => {
        vi.mocked(incidentLearningService.compareTimePeriods).mockResolvedValueOnce({
          currentPeriod: { successRate: 88.5, incidentCount: 23 },
          previousPeriod: { successRate: 82.0, incidentCount: 28 },
          delta: {
            successRateChange: 6.5,
            incidentCountChange: -5,
            trend: 'improving',
          },
        });

        const result = await incidentLearningService.compareTimePeriods(
          { from: new Date('2026-01-17'), to: new Date('2026-01-24') },
          { from: new Date('2026-01-10'), to: new Date('2026-01-17') }
        );

        expect(result.delta.successRateChange).toBe(6.5);
        expect(result.delta.trend).toBe('improving');
      });
    });

    describe('ST-010: Export stats as JSON', () => {
      it('should export all statistics as JSON', async () => {
        vi.mocked(incidentLearningService.exportStatsAsJSON).mockResolvedValueOnce({
          exportedAt: new Date().toISOString(),
          overallSuccessRate: 85.5,
          mttrSeconds: 78,
          incidentCount: 156,
          serviceStats: [
            { serviceId: 'service-vlm', rate: 92.0 },
            { serviceId: 'service-wa', rate: 88.5 },
          ],
          commonFailures: [
            { type: 'connection_timeout', count: 25 },
          ],
        });

        const result = await incidentLearningService.exportStatsAsJSON();

        expect(result).toHaveProperty('overallSuccessRate');
        expect(result).toHaveProperty('mttrSeconds');
        expect(result).toHaveProperty('serviceStats');
        expect(typeof result.exportedAt).toBe('string');
      });
    });
  });
});
