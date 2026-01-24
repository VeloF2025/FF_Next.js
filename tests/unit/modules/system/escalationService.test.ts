/**
 * Test Specification: Escalation Service
 * Source: tests/specs/escalation-service.spec.md
 * Phase: RED (failing tests)
 *
 * Handles alerting and human-in-the-loop approval workflows
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EscalationService,
  sendWhatsAppAlert,
  createApproval,
  approveAction,
  rejectAction,
  getEscalationLevel,
  shouldSuppressAlert,
} from '@/modules/system/services/escalationService';
import { pool } from '@/lib/db';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  pool: {
    query: vi.fn(),
  },
}));

// Mock fetch for WhatsApp API
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockQuery = vi.mocked(pool.query);

// Test data
const criticalIncident = {
  serviceId: 'service-vlm',
  serviceName: 'VLM (Qwen3)',
  status: 'down',
  issueType: 'connection_timeout',
  failureCount: 5,
  duration: '10 minutes',
  suggestedAction: 'Restart VLM service',
  riskLevel: 'moderate',
  approvalId: 'approval-123',
};

describe('Escalation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('WhatsApp Alerts', () => {
    describe('WA-001: Send alert message', () => {
      it('should send alert message for critical incident', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

        const result = await sendWhatsAppAlert(criticalIncident);

        expect(result.sent).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('wa-feedback'),
          expect.objectContaining({
            method: 'POST',
            body: expect.any(String),
          })
        );
      });
    });

    describe('WA-002: Message includes service name', () => {
      it('should include "VLM" in the message for VLM incident', async () => {
        let sentBody = '';
        mockFetch.mockImplementation(async (url, options) => {
          sentBody = options.body;
          return { ok: true, json: () => Promise.resolve({ success: true }) };
        });

        await sendWhatsAppAlert(criticalIncident);

        expect(sentBody).toContain('VLM');
      });
    });

    describe('WA-003: Message includes status', () => {
      it('should include "DOWN" in the message', async () => {
        let sentBody = '';
        mockFetch.mockImplementation(async (url, options) => {
          sentBody = options.body;
          return { ok: true, json: () => Promise.resolve({ success: true }) };
        });

        await sendWhatsAppAlert({ ...criticalIncident, status: 'down' });

        expect(sentBody.toUpperCase()).toContain('DOWN');
      });
    });

    describe('WA-004: Message includes issue type', () => {
      it('should include "timeout" in the message', async () => {
        let sentBody = '';
        mockFetch.mockImplementation(async (url, options) => {
          sentBody = options.body;
          return { ok: true, json: () => Promise.resolve({ success: true }) };
        });

        await sendWhatsAppAlert({ ...criticalIncident, issueType: 'connection_timeout' });

        expect(sentBody.toLowerCase()).toContain('timeout');
      });
    });

    describe('WA-005: Message includes suggested action', () => {
      it('should include "Restart" as suggested action', async () => {
        let sentBody = '';
        mockFetch.mockImplementation(async (url, options) => {
          sentBody = options.body;
          return { ok: true, json: () => Promise.resolve({ success: true }) };
        });

        await sendWhatsAppAlert(criticalIncident);

        expect(sentBody).toContain('Restart');
      });
    });

    describe('WA-006: Message includes approve instruction', () => {
      it('should include "Reply \'approve\'" instruction for HITL action', async () => {
        let sentBody = '';
        mockFetch.mockImplementation(async (url, options) => {
          sentBody = options.body;
          return { ok: true, json: () => Promise.resolve({ success: true }) };
        });

        await sendWhatsAppAlert({ ...criticalIncident, requiresApproval: true });

        expect(sentBody).toContain("approve");
        expect(sentBody).toContain(criticalIncident.approvalId);
      });
    });

    describe('WA-007: Delivery status tracked', () => {
      it('should track message delivery confirmation', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, messageId: 'msg-123' }),
        });

        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const result = await sendWhatsAppAlert(criticalIncident);

        expect(result.messageId).toBe('msg-123');
        expect(result.delivered).toBe(true);
      });
    });

    describe('WA-008: Failed delivery logged', () => {
      it('should log error when message delivery fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await sendWhatsAppAlert(criticalIncident);

        expect(result.sent).toBe(false);
        expect(result.error).toContain('Network error');
      });
    });

    describe('WA-009: Retry on failure', () => {
      it('should retry 3 times when first send fails', async () => {
        mockFetch
          .mockRejectedValueOnce(new Error('Network error'))
          .mockRejectedValueOnce(new Error('Network error'))
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          });

        const result = await sendWhatsAppAlert(criticalIncident, { maxRetries: 3 });

        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(result.sent).toBe(true);
      });
    });

    describe('WA-010: Uses correct group JID', () => {
      it('should use correct group JID for Lawley project', async () => {
        let sentBody = '';
        mockFetch.mockImplementation(async (url, options) => {
          sentBody = options.body;
          return { ok: true, json: () => Promise.resolve({ success: true }) };
        });

        await sendWhatsAppAlert({
          ...criticalIncident,
          project: 'Lawley',
        });

        const parsedBody = JSON.parse(sentBody);
        expect(parsedBody.group_jid).toBe('120363418298130331@g.us');
      });
    });
  });

  describe('Approval Queue', () => {
    describe('AQ-001: Create approval in queue', () => {
      it('should create approval entry for new action', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'pending' }],
          rowCount: 1,
        });

        const result = await createApproval({
          actionId: 'action-123',
          serviceId: 'service-123',
          riskLevel: 'moderate',
        });

        expect(result.id).toBe('approval-123');
        expect(result.status).toBe('pending');
      });
    });

    describe('AQ-002: Approval includes action details', () => {
      it('should store action details with approval', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{
            id: 'approval-123',
            actionId: 'action-123',
            actionName: 'Restart Service',
            command: 'systemctl restart fibreflow',
          }],
          rowCount: 1,
        });

        const result = await createApproval({
          actionId: 'action-123',
          actionName: 'Restart Service',
          command: 'systemctl restart fibreflow',
        });

        expect(result.actionName).toBe('Restart Service');
        expect(result.command).toBe('systemctl restart fibreflow');
      });
    });

    describe('AQ-003: Approval includes requester', () => {
      it('should store requester information', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{
            id: 'approval-123',
            requestedBy: 'system',
            requestedAt: new Date().toISOString(),
          }],
          rowCount: 1,
        });

        const result = await createApproval({
          actionId: 'action-123',
          requestedBy: 'system',
        });

        expect(result.requestedBy).toBe('system');
      });
    });

    describe('AQ-004: Approve updates status', () => {
      it('should update status to approved when approve is called', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'approved' }],
          rowCount: 1,
        });

        const result = await approveAction('approval-123', { userId: 'user-1' });

        expect(result.status).toBe('approved');
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining("status = 'approved'"),
          expect.any(Array)
        );
      });
    });

    describe('AQ-005: Reject updates status', () => {
      it('should update status to rejected when reject is called', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'rejected' }],
          rowCount: 1,
        });

        const result = await rejectAction('approval-123', { userId: 'user-1' });

        expect(result.status).toBe('rejected');
      });
    });

    describe('AQ-006: Approval triggers action', () => {
      it('should execute action after approval', async () => {
        const executeAction = vi.fn().mockResolvedValue({ success: true });
        const escalationService = new EscalationService({ executeAction });

        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'approved', actionId: 'action-123' }],
          rowCount: 1,
        });

        await escalationService.approveAndExecute('approval-123', { userId: 'user-1' });

        expect(executeAction).toHaveBeenCalledWith('action-123');
      });
    });

    describe('AQ-007: Rejection logs reason', () => {
      it('should store rejection reason when provided', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'rejected', reason: 'Too risky right now' }],
          rowCount: 1,
        });

        const result = await rejectAction('approval-123', {
          userId: 'user-1',
          reason: 'Too risky right now',
        });

        expect(result.reason).toBe('Too risky right now');
      });
    });

    describe('AQ-008: Get pending approvals', () => {
      it('should return list of pending approvals', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [
            { id: 'approval-1', status: 'pending' },
            { id: 'approval-2', status: 'pending' },
          ],
          rowCount: 2,
        });

        const escalationService = new EscalationService({});
        const result = await escalationService.getPendingApprovals();

        expect(result).toHaveLength(2);
        result.forEach((approval) => {
          expect(approval.status).toBe('pending');
        });
      });
    });

    describe('AQ-009: Approver identity stored', () => {
      it('should store user ID who approved the action', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'approved', approvedBy: 'user-123' }],
          rowCount: 1,
        });

        const result = await approveAction('approval-123', { userId: 'user-123' });

        expect(result.approvedBy).toBe('user-123');
      });
    });

    describe('AQ-010: Approval timestamp stored', () => {
      it('should store timestamp when action is approved', async () => {
        const now = new Date();
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'approved', approvedAt: now.toISOString() }],
          rowCount: 1,
        });

        const result = await approveAction('approval-123', { userId: 'user-123' });

        expect(result.approvedAt).toBeDefined();
      });
    });

    describe('AQ-011: Auto-expire after 1h', () => {
      it('should set status to expired after 1 hour', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'expired' }],
          rowCount: 1,
        });

        const escalationService = new EscalationService({});
        await escalationService.expireOldApprovals();

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining("INTERVAL '1 hour'"),
          expect.any(Array)
        );
      });
    });

    describe('AQ-012: Expired not executable', () => {
      it('should throw error when trying to approve expired request', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'expired' }],
          rowCount: 1,
        });

        await expect(
          approveAction('approval-123', { userId: 'user-1' })
        ).rejects.toThrow(/expired/i);
      });
    });
  });

  describe('Escalation Levels', () => {
    describe('EL-001: Level 1 no notification', () => {
      it('should not send notification for Level 1 (info) escalation', async () => {
        const escalationService = new EscalationService({});

        const result = await escalationService.escalate({
          level: 1,
          serviceId: 'service-123',
          message: 'Minor issue detected',
        });

        expect(result.notificationSent).toBe(false);
        expect(result.dashboardOnly).toBe(true);
      });
    });

    describe('EL-002: Level 2 sends WhatsApp', () => {
      it('should send WhatsApp notification for Level 2 (warning) escalation', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

        const escalationService = new EscalationService({});

        const result = await escalationService.escalate({
          level: 2,
          serviceId: 'service-123',
          message: 'Service degraded',
        });

        expect(result.notificationSent).toBe(true);
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    describe('EL-003: Level 3 urgent WhatsApp', () => {
      it('should send urgent WhatsApp notification for Level 3 (critical) escalation', async () => {
        let sentBody = '';
        mockFetch.mockImplementation(async (url, options) => {
          sentBody = options.body;
          return { ok: true, json: () => Promise.resolve({ success: true }) };
        });

        const escalationService = new EscalationService({});

        await escalationService.escalate({
          level: 3,
          serviceId: 'service-123',
          message: 'Critical failure',
        });

        expect(sentBody).toContain('🚨');
        expect(sentBody.toUpperCase()).toContain('CRITICAL');
      });
    });

    describe('EL-004: Level 3 includes urgency', () => {
      it('should prefix message with "CRITICAL" for Level 3', async () => {
        let sentBody = '';
        mockFetch.mockImplementation(async (url, options) => {
          sentBody = options.body;
          return { ok: true, json: () => Promise.resolve({ success: true }) };
        });

        const escalationService = new EscalationService({});

        await escalationService.escalate({
          level: 3,
          serviceId: 'service-123',
          message: 'System down',
        });

        expect(sentBody.toUpperCase()).toContain('CRITICAL');
      });
    });

    describe('EL-005: First failure is Level 1', () => {
      it('should return Level 1 for first failure', () => {
        const level = getEscalationLevel({
          failureCount: 1,
          isCritical: false,
          downtimeMinutes: 0,
        });

        expect(level).toBe(1);
      });
    });

    describe('EL-006: 3 failures is Level 2', () => {
      it('should return Level 2 for 3rd consecutive failure', () => {
        const level = getEscalationLevel({
          failureCount: 3,
          isCritical: false,
          downtimeMinutes: 2,
        });

        expect(level).toBe(2);
      });
    });

    describe('EL-007: Critical service is Level 3', () => {
      it('should return Level 3 when critical service is down', () => {
        const level = getEscalationLevel({
          failureCount: 1,
          isCritical: true,
          status: 'down',
          downtimeMinutes: 0,
        });

        expect(level).toBe(3);
      });
    });

    describe('EL-008: 5 failures is Level 3', () => {
      it('should return Level 3 for 5th consecutive failure', () => {
        const level = getEscalationLevel({
          failureCount: 5,
          isCritical: false,
          downtimeMinutes: 3,
        });

        expect(level).toBe(3);
      });
    });

    describe('EL-009: 10 min down is Level 3', () => {
      it('should return Level 3 when downtime exceeds 10 minutes', () => {
        const level = getEscalationLevel({
          failureCount: 2,
          isCritical: false,
          downtimeMinutes: 11,
        });

        expect(level).toBe(3);
      });
    });

    describe('EL-010: Level calculated correctly', () => {
      it('should calculate correct level for complex scenario', () => {
        // Non-critical service, 4 failures, 8 minutes down -> Level 2
        const level = getEscalationLevel({
          failureCount: 4,
          isCritical: false,
          downtimeMinutes: 8,
        });

        expect(level).toBe(2);
      });
    });
  });

  describe('Alert Suppression', () => {
    describe('AS-001: Suppress duplicate in 5 min', () => {
      it('should suppress duplicate alert within 5 minutes', async () => {
        // First alert
        mockQuery.mockResolvedValueOnce({
          rows: [{ sentAt: new Date(Date.now() - 2 * 60 * 1000) }], // 2 min ago
          rowCount: 1,
        });

        const result = await shouldSuppressAlert({
          serviceId: 'service-123',
          issueType: 'connection_timeout',
        });

        expect(result.suppress).toBe(true);
        expect(result.reason).toBe('duplicate');
      });
    });

    describe('AS-002: Allow after 5 min', () => {
      it('should allow same alert after 5 minutes', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ sentAt: new Date(Date.now() - 6 * 60 * 1000) }], // 6 min ago
          rowCount: 1,
        });

        const result = await shouldSuppressAlert({
          serviceId: 'service-123',
          issueType: 'connection_timeout',
        });

        expect(result.suppress).toBe(false);
      });
    });

    describe('AS-003: Maintenance window suppresses', () => {
      it('should suppress alerts during maintenance window', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{
            id: 'window-123',
            startTime: new Date(Date.now() - 30 * 60 * 1000), // Started 30 min ago
            endTime: new Date(Date.now() + 30 * 60 * 1000), // Ends in 30 min
          }],
          rowCount: 1,
        });

        const result = await shouldSuppressAlert({
          serviceId: 'service-123',
          issueType: 'connection_timeout',
        });

        expect(result.suppress).toBe(true);
        expect(result.reason).toBe('maintenance_window');
      });
    });

    describe('AS-004: After maintenance window sends', () => {
      it('should allow alerts after maintenance window ends', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // No active window

        const result = await shouldSuppressAlert({
          serviceId: 'service-123',
          issueType: 'connection_timeout',
        });

        expect(result.suppress).toBe(false);
      });
    });

    describe('AS-005: Acknowledge suppresses 1h', () => {
      it('should suppress alerts for 1 hour after acknowledgment', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{
            acknowledgedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
          }],
          rowCount: 1,
        });

        const result = await shouldSuppressAlert({
          serviceId: 'service-123',
          issueType: 'connection_timeout',
        });

        expect(result.suppress).toBe(true);
        expect(result.reason).toBe('acknowledged');
      });
    });

    describe('AS-006: After acknowledge sends', () => {
      it('should allow alerts 1+ hour after acknowledgment', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{
            acknowledgedAt: new Date(Date.now() - 61 * 60 * 1000), // 61 min ago
          }],
          rowCount: 1,
        });

        const result = await shouldSuppressAlert({
          serviceId: 'service-123',
          issueType: 'connection_timeout',
        });

        expect(result.suppress).toBe(false);
      });
    });

    describe('AS-007: Rate limit 10/hour', () => {
      it('should block 11th alert within 1 hour', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ count: 10 }], // 10 alerts this hour
          rowCount: 1,
        });

        const result = await shouldSuppressAlert({
          serviceId: 'service-123',
          issueType: 'connection_timeout',
        });

        expect(result.suppress).toBe(true);
        expect(result.reason).toBe('rate_limited');
      });
    });

    describe('AS-008: Rate limit resets hourly', () => {
      it('should allow alerts after hour resets', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ count: 0 }], // 0 alerts this hour (new hour)
          rowCount: 1,
        });

        const result = await shouldSuppressAlert({
          serviceId: 'service-123',
          issueType: 'connection_timeout',
        });

        expect(result.suppress).toBe(false);
      });
    });

    describe('AS-009: Different services not deduped', () => {
      it('should allow alerts for different services', async () => {
        // No duplicate for VLM
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        // No duplicate for WA
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const result1 = await shouldSuppressAlert({
          serviceId: 'service-vlm',
          issueType: 'timeout',
        });

        const result2 = await shouldSuppressAlert({
          serviceId: 'service-wa',
          issueType: 'timeout',
        });

        expect(result1.suppress).toBe(false);
        expect(result2.suppress).toBe(false);
      });
    });

    describe('AS-010: Critical bypasses rate limit', () => {
      it('should send critical alert even when rate limited', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ count: 10 }], // Rate limited
          rowCount: 1,
        });

        const result = await shouldSuppressAlert({
          serviceId: 'service-123',
          issueType: 'timeout',
          level: 3, // Critical
        });

        expect(result.suppress).toBe(false);
        expect(result.bypassedRateLimit).toBe(true);
      });
    });
  });

  describe('Message Templates', () => {
    it('should format warning template correctly', () => {
      const escalationService = new EscalationService({});

      const message = escalationService.formatMessage({
        level: 2,
        serviceName: 'VLM (Qwen3)',
        status: 'DOWN',
        issueType: 'Connection timeout',
        duration: '5 minutes',
        suggestedAction: 'Restart service',
        riskLevel: 'safe',
        approvalId: 'approval-123',
      });

      expect(message).toContain('⚠️');
      expect(message).toContain('VLM (Qwen3)');
      expect(message).toContain('DOWN');
      expect(message).toContain('timeout');
      expect(message).toContain('Restart');
      expect(message).toContain('approve approval-123');
    });

    it('should format critical template correctly', () => {
      const escalationService = new EscalationService({});

      const message = escalationService.formatMessage({
        level: 3,
        serviceName: 'FibreFlow Production',
        status: 'DOWN',
        failureCount: 5,
        issueType: '5xx Error',
        firstDetected: '10:45 AM',
        attempts: [
          { actionName: 'Restart', result: 'Failed' },
          { actionName: 'Rebuild', result: 'Pending' },
        ],
        suggestedAction: 'Rebuild and restart',
        riskLevel: 'moderate',
        approvalId: 'approval-456',
      });

      expect(message).toContain('🚨');
      expect(message).toContain('CRITICAL');
      expect(message).toContain('FibreFlow Production');
      expect(message).toContain('5 consecutive failures');
      expect(message).toContain('Restart');
      expect(message).toContain('Rebuild');
    });
  });
});
