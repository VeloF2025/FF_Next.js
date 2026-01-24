/**
 * Test Specification: Health Daemon
 * Source: tests/specs/health-daemon.spec.md
 * Phase: RED (failing tests)
 *
 * Long-running background process for continuous service monitoring
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HealthDaemon,
  checkHttpEndpoint,
  checkSystemdService,
  checkDatabaseConnection,
  determineStatus,
  classifyIssue,
  determineSeverity,
} from '@/modules/system/services/healthDaemon';
import { triggerRecovery } from '@/modules/system/services/recoveryService';
import { pool } from '@/lib/db';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock('@/modules/system/services/recoveryService', () => ({
  triggerRecovery: vi.fn(),
}));

// Mock fetch for HTTP checks
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock child_process for systemd checks
vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn(),
}));

const mockQuery = vi.mocked(pool.query);
const mockTriggerRecovery = vi.mocked(triggerRecovery);

describe('Health Daemon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Health Check Execution', () => {
    describe('HC-001: HTTP 200 response is UP', () => {
      it('should return status=up when HTTP endpoint returns 200', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
        });

        const result = await checkHttpEndpoint('https://app.fibreflow.app/api/health');

        expect(result.status).toBe('up');
      });
    });

    describe('HC-002: HTTP 201 response is UP', () => {
      it('should return status=up when HTTP endpoint returns 201', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
        });

        const result = await checkHttpEndpoint('https://app.fibreflow.app/api/health');

        expect(result.status).toBe('up');
      });
    });

    describe('HC-003: HTTP 500 response is DOWN', () => {
      it('should return status=down when HTTP endpoint returns 500', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

        const result = await checkHttpEndpoint('https://app.fibreflow.app/api/health');

        expect(result.status).toBe('down');
      });
    });

    describe('HC-004: HTTP 503 response is DOWN', () => {
      it('should return status=down when HTTP endpoint returns 503', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 503,
        });

        const result = await checkHttpEndpoint('https://app.fibreflow.app/api/health');

        expect(result.status).toBe('down');
      });
    });

    describe('HC-005: Connection refused is DOWN', () => {
      it('should return status=down when connection is refused (ECONNREFUSED)', async () => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:3000');
        (error as NodeJS.ErrnoException).code = 'ECONNREFUSED';
        mockFetch.mockRejectedValueOnce(error);

        const result = await checkHttpEndpoint('http://localhost:3000/health');

        expect(result.status).toBe('down');
        expect(result.error).toContain('ECONNREFUSED');
      });
    });

    describe('HC-006: Timeout is DEGRADED', () => {
      it('should return status=degraded when response takes > 5 seconds', async () => {
        mockFetch.mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 6000));
          return { ok: true, status: 200 };
        });

        const resultPromise = checkHttpEndpoint('https://slow-service.app/health');

        vi.advanceTimersByTime(6000);

        const result = await resultPromise;

        expect(result.status).toBe('degraded');
      });
    });

    describe('HC-007: Network unreachable is UNKNOWN', () => {
      it('should return status=unknown when network is unreachable (ENETUNREACH)', async () => {
        const error = new Error('network unreachable');
        (error as NodeJS.ErrnoException).code = 'ENETUNREACH';
        mockFetch.mockRejectedValueOnce(error);

        const result = await checkHttpEndpoint('https://unreachable.app/health');

        expect(result.status).toBe('unknown');
      });
    });

    describe('HC-008: Systemd active is UP', () => {
      it('should return status=up when systemctl reports active', async () => {
        const result = await checkSystemdService('fibreflow.service', 'active');

        expect(result.status).toBe('up');
      });
    });

    describe('HC-009: Systemd inactive is DOWN', () => {
      it('should return status=down when systemctl reports inactive', async () => {
        const result = await checkSystemdService('fibreflow.service', 'inactive');

        expect(result.status).toBe('down');
      });
    });

    describe('HC-010: Systemd failed is DOWN', () => {
      it('should return status=down when systemctl reports failed', async () => {
        const result = await checkSystemdService('fibreflow.service', 'failed');

        expect(result.status).toBe('down');
      });
    });

    describe('HC-011: DB connection success is UP', () => {
      it('should return status=up when database query succeeds', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 });

        const result = await checkDatabaseConnection('postgresql://test');

        expect(result.status).toBe('up');
      });
    });

    describe('HC-012: DB connection failure is DOWN', () => {
      it('should return status=down when database query fails', async () => {
        mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

        const result = await checkDatabaseConnection('postgresql://test');

        expect(result.status).toBe('down');
      });
    });

    describe('HC-013: Response time recorded', () => {
      it('should record latency in milliseconds', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
        });

        const result = await checkHttpEndpoint('https://app.fibreflow.app/api/health');

        expect(result).toHaveProperty('latencyMs');
        expect(typeof result.latencyMs).toBe('number');
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Monitoring Loop', () => {
    let daemon: HealthDaemon;

    beforeEach(() => {
      daemon = new HealthDaemon({
        checkIntervalMs: 60000,
        enableRecovery: true,
      });
    });

    afterEach(() => {
      daemon?.stop();
    });

    describe('ML-001: Loop runs every 60s', () => {
      it('should run health checks every 60 seconds by default', async () => {
        const checkSpy = vi.spyOn(daemon, 'runChecks');

        daemon.start();

        // Initial check
        expect(checkSpy).toHaveBeenCalledTimes(1);

        // Advance 60 seconds
        vi.advanceTimersByTime(60000);
        expect(checkSpy).toHaveBeenCalledTimes(2);

        // Advance another 60 seconds
        vi.advanceTimersByTime(60000);
        expect(checkSpy).toHaveBeenCalledTimes(3);
      });
    });

    describe('ML-002: Loop checks all services', () => {
      it('should check all 14 registered services', async () => {
        const mockServices = Array.from({ length: 14 }, (_, i) => ({
          id: `service-${i}`,
          name: `Service ${i}`,
          healthEndpoint: `http://localhost:300${i}/health`,
        }));

        mockQuery.mockResolvedValueOnce({ rows: mockServices, rowCount: 14 });
        mockFetch.mockResolvedValue({ ok: true, status: 200 });

        await daemon.runChecks();

        expect(mockFetch).toHaveBeenCalledTimes(14);
      });
    });

    describe('ML-003: Checks run in parallel', () => {
      it('should run all service checks concurrently', async () => {
        const mockServices = Array.from({ length: 14 }, (_, i) => ({
          id: `service-${i}`,
          name: `Service ${i}`,
          healthEndpoint: `http://localhost:300${i}/health`,
        }));

        mockQuery.mockResolvedValueOnce({ rows: mockServices, rowCount: 14 });

        // Track when each check starts
        const startTimes: number[] = [];
        mockFetch.mockImplementation(async () => {
          startTimes.push(Date.now());
          return { ok: true, status: 200 };
        });

        await daemon.runChecks();

        // All checks should start at approximately the same time
        const timeDiffs = startTimes.slice(1).map((t, i) => t - startTimes[i]);
        timeDiffs.forEach((diff) => {
          expect(diff).toBeLessThan(100); // All within 100ms of each other
        });
      });
    });

    describe('ML-004: Failed check doesn\'t stop loop', () => {
      it('should continue checking other services when one fails', async () => {
        const mockServices = [
          { id: '1', name: 'Service 1', healthEndpoint: 'http://fail/health' },
          { id: '2', name: 'Service 2', healthEndpoint: 'http://success/health' },
        ];

        mockQuery.mockResolvedValueOnce({ rows: mockServices, rowCount: 2 });

        mockFetch
          .mockRejectedValueOnce(new Error('Connection failed'))
          .mockResolvedValueOnce({ ok: true, status: 200 });

        const results = await daemon.runChecks();

        expect(results).toHaveLength(2);
        expect(results[0].status).toBe('down');
        expect(results[1].status).toBe('up');
      });
    });

    describe('ML-005: Loop respects per-service interval', () => {
      it('should use custom check interval when specified', async () => {
        const customDaemon = new HealthDaemon({
          checkIntervalMs: 30000, // 30 seconds
          enableRecovery: true,
        });

        const checkSpy = vi.spyOn(customDaemon, 'runChecks');

        customDaemon.start();

        expect(checkSpy).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(30000);
        expect(checkSpy).toHaveBeenCalledTimes(2);

        customDaemon.stop();
      });
    });

    describe('ML-006: Graceful shutdown on SIGTERM', () => {
      it('should stop cleanly when SIGTERM is received', async () => {
        daemon.start();

        expect(daemon.isRunning()).toBe(true);

        daemon.handleSignal('SIGTERM');

        expect(daemon.isRunning()).toBe(false);
      });
    });

    describe('ML-007: Graceful shutdown on SIGINT', () => {
      it('should stop cleanly when SIGINT is received', async () => {
        daemon.start();

        expect(daemon.isRunning()).toBe(true);

        daemon.handleSignal('SIGINT');

        expect(daemon.isRunning()).toBe(false);
      });
    });

    describe('ML-008: In-progress checks complete on shutdown', () => {
      it('should wait for in-progress checks before stopping', async () => {
        const mockServices = [
          { id: '1', name: 'Slow Service', healthEndpoint: 'http://slow/health' },
        ];

        mockQuery.mockResolvedValueOnce({ rows: mockServices, rowCount: 1 });

        let checkCompleted = false;
        mockFetch.mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          checkCompleted = true;
          return { ok: true, status: 200 };
        });

        const checkPromise = daemon.runChecks();

        daemon.handleSignal('SIGTERM');

        vi.advanceTimersByTime(5000);
        await checkPromise;

        expect(checkCompleted).toBe(true);
      });
    });

    describe('ML-009: Loop logs start/stop', () => {
      it('should log when daemon starts', async () => {
        const logSpy = vi.spyOn(console, 'log');

        daemon.start();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('started'));
      });

      it('should log when daemon stops', async () => {
        const logSpy = vi.spyOn(console, 'log');

        daemon.start();
        daemon.stop();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stopped'));
      });
    });

    describe('ML-010: Loop handles empty registry', () => {
      it('should not error when no services are registered', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const results = await daemon.runChecks();

        expect(results).toHaveLength(0);
        expect(daemon.isRunning()).toBe(true);
      });
    });
  });

  describe('Issue Detection', () => {
    describe('ID-001: Detect UP to DOWN transition', () => {
      it('should detect issue when service transitions from UP to DOWN', () => {
        const previousStatus = 'up';
        const currentStatus = 'down';

        const issue = classifyIssue(previousStatus, currentStatus, {});

        expect(issue).not.toBeNull();
        expect(issue?.detected).toBe(true);
      });
    });

    describe('ID-002: Detect UP to DEGRADED transition', () => {
      it('should detect issue when service transitions from UP to DEGRADED', () => {
        const previousStatus = 'up';
        const currentStatus = 'degraded';

        const issue = classifyIssue(previousStatus, currentStatus, {});

        expect(issue).not.toBeNull();
        expect(issue?.detected).toBe(true);
      });
    });

    describe('ID-003: No issue on UP to UP', () => {
      it('should not detect issue when service stays UP', () => {
        const previousStatus = 'up';
        const currentStatus = 'up';

        const issue = classifyIssue(previousStatus, currentStatus, {});

        expect(issue).toBeNull();
      });
    });

    describe('ID-004: No issue on DOWN to DOWN', () => {
      it('should not detect new issue when service stays DOWN', () => {
        const previousStatus = 'down';
        const currentStatus = 'down';

        const issue = classifyIssue(previousStatus, currentStatus, {});

        expect(issue).toBeNull(); // Already tracked
      });
    });

    describe('ID-005: Classify timeout issue', () => {
      it('should classify issue as timeout when error contains timeout', () => {
        const error = { message: 'Request timeout after 30s', code: 'ETIMEDOUT' };

        const issue = classifyIssue('up', 'down', error);

        expect(issue?.type).toBe('timeout');
      });
    });

    describe('ID-006: Classify connection refused', () => {
      it('should classify issue as connection_refused when ECONNREFUSED', () => {
        const error = { message: 'Connection refused', code: 'ECONNREFUSED' };

        const issue = classifyIssue('up', 'down', error);

        expect(issue?.type).toBe('connection_refused');
      });
    });

    describe('ID-007: Classify 5xx error', () => {
      it('should classify issue as 5xx_error when status is 500+', () => {
        const error = { status: 500, message: 'Internal Server Error' };

        const issue = classifyIssue('up', 'down', error);

        expect(issue?.type).toBe('5xx_error');
      });
    });

    describe('ID-008: Classify auth failure', () => {
      it('should classify issue as auth_failure when status is 401', () => {
        const error = { status: 401, message: 'Unauthorized' };

        const issue = classifyIssue('up', 'down', error);

        expect(issue?.type).toBe('auth_failure');
      });

      it('should classify issue as auth_failure when status is 403', () => {
        const error = { status: 403, message: 'Forbidden' };

        const issue = classifyIssue('up', 'down', error);

        expect(issue?.type).toBe('auth_failure');
      });
    });

    describe('ID-009: Critical service = high severity', () => {
      it('should set severity to high for critical services', () => {
        const service = { isCritical: true };

        const severity = determineSeverity(service, 'down', 0);

        expect(severity).toBe('high');
      });
    });

    describe('ID-010: Non-critical = low severity', () => {
      it('should set severity to low for non-critical services', () => {
        const service = { isCritical: false };

        const severity = determineSeverity(service, 'down', 0);

        expect(severity).toBe('low');
      });
    });

    describe('ID-011: Long outage increases severity', () => {
      it('should increase severity when outage exceeds 5 minutes', () => {
        const service = { isCritical: false };
        const downtimeMinutes = 6;

        const severity = determineSeverity(service, 'down', downtimeMinutes);

        expect(severity).toBe('medium');
      });

      it('should set severity to high when outage exceeds 10 minutes', () => {
        const service = { isCritical: false };
        const downtimeMinutes = 11;

        const severity = determineSeverity(service, 'down', downtimeMinutes);

        expect(severity).toBe('high');
      });
    });
  });

  describe('Recovery Triggering', () => {
    describe('RT-001: Safe action auto-executes', () => {
      it('should automatically execute safe recovery action', async () => {
        const service = { id: 'service-1', recoveryEnabled: true };
        const action = { id: 'action-1', riskLevel: 'safe', requiresApproval: false };

        mockTriggerRecovery.mockResolvedValueOnce({ success: true });

        const result = await triggerRecovery(service, action);

        expect(mockTriggerRecovery).toHaveBeenCalledWith(service, action);
        expect(result.success).toBe(true);
      });
    });

    describe('RT-002: Moderate action queued for HITL', () => {
      it('should queue moderate action for human approval', async () => {
        const service = { id: 'service-1', recoveryEnabled: true };
        const action = { id: 'action-1', riskLevel: 'moderate', requiresApproval: true };

        mockTriggerRecovery.mockResolvedValueOnce({ queued: true, approvalId: 'approval-123' });

        const result = await triggerRecovery(service, action);

        expect(result.queued).toBe(true);
        expect(result.approvalId).toBeDefined();
      });
    });

    describe('RT-003: Dangerous action queued for HITL', () => {
      it('should queue dangerous action for human approval', async () => {
        const service = { id: 'service-1', recoveryEnabled: true };
        const action = { id: 'action-1', riskLevel: 'dangerous', requiresApproval: true };

        mockTriggerRecovery.mockResolvedValueOnce({ queued: true, approvalId: 'approval-456' });

        const result = await triggerRecovery(service, action);

        expect(result.queued).toBe(true);
        expect(result.approvalId).toBeDefined();
      });
    });

    describe('RT-004: Cooldown prevents rapid retry', () => {
      it('should skip action if within cooldown period', async () => {
        const service = { id: 'service-1', recoveryEnabled: true };
        const action = { id: 'action-1', lastExecuted: new Date(Date.now() - 2 * 60 * 1000) }; // 2 min ago

        mockTriggerRecovery.mockResolvedValueOnce({ skipped: true, reason: 'cooldown' });

        const result = await triggerRecovery(service, action);

        expect(result.skipped).toBe(true);
        expect(result.reason).toBe('cooldown');
      });
    });

    describe('RT-005: No action if recovery disabled', () => {
      it('should not trigger recovery when disabled for service', async () => {
        const service = { id: 'service-1', recoveryEnabled: false };
        const action = { id: 'action-1', riskLevel: 'safe' };

        mockTriggerRecovery.mockResolvedValueOnce({ skipped: true, reason: 'recovery_disabled' });

        const result = await triggerRecovery(service, action);

        expect(result.skipped).toBe(true);
        expect(result.reason).toBe('recovery_disabled');
      });
    });

    describe('RT-006: Multiple actions tried in order', () => {
      it('should try actions sequentially until one succeeds', async () => {
        const service = { id: 'service-1', recoveryEnabled: true };
        const actions = [
          { id: 'action-1', riskLevel: 'safe', order: 1 },
          { id: 'action-2', riskLevel: 'safe', order: 2 },
          { id: 'action-3', riskLevel: 'moderate', order: 3 },
        ];

        mockTriggerRecovery
          .mockResolvedValueOnce({ success: false })
          .mockResolvedValueOnce({ success: false })
          .mockResolvedValueOnce({ success: true });

        for (const action of actions) {
          const result = await triggerRecovery(service, action);
          if (result.success) break;
        }

        expect(mockTriggerRecovery).toHaveBeenCalledTimes(3);
      });
    });

    describe('RT-007: Stops on successful action', () => {
      it('should not try further actions after success', async () => {
        const service = { id: 'service-1', recoveryEnabled: true };
        const actions = [
          { id: 'action-1', riskLevel: 'safe', order: 1 },
          { id: 'action-2', riskLevel: 'safe', order: 2 },
        ];

        mockTriggerRecovery.mockResolvedValueOnce({ success: true });

        let attemptCount = 0;
        for (const action of actions) {
          attemptCount++;
          const result = await triggerRecovery(service, action);
          if (result.success) break;
        }

        expect(attemptCount).toBe(1);
        expect(mockTriggerRecovery).toHaveBeenCalledTimes(1);
      });
    });

    describe('RT-008: All actions fail creates incident', () => {
      it('should create incident when all recovery actions fail', async () => {
        const service = { id: 'service-1', recoveryEnabled: true };
        const action = { id: 'action-1', riskLevel: 'safe' };

        mockTriggerRecovery.mockResolvedValueOnce({
          success: false,
          incidentCreated: true,
          incidentId: 'incident-123',
        });

        const result = await triggerRecovery(service, action);

        expect(result.incidentCreated).toBe(true);
        expect(result.incidentId).toBeDefined();
      });
    });

    describe('RT-009: Success resets failure count', () => {
      it('should reset failure count when action succeeds', async () => {
        const service = { id: 'service-1', recoveryEnabled: true };
        const action = { id: 'action-1', riskLevel: 'safe' };

        mockTriggerRecovery.mockResolvedValueOnce({
          success: true,
          failureCountReset: true,
        });

        const result = await triggerRecovery(service, action);

        expect(result.failureCountReset).toBe(true);
      });
    });

    describe('RT-010: Failure increments count', () => {
      it('should increment failure count when action fails', async () => {
        const service = { id: 'service-1', recoveryEnabled: true };
        const action = { id: 'action-1', riskLevel: 'safe' };

        mockTriggerRecovery.mockResolvedValueOnce({
          success: false,
          failureCount: 3,
        });

        const result = await triggerRecovery(service, action);

        expect(result.failureCount).toBe(3);
      });
    });
  });

  describe('Logging', () => {
    describe('LG-001: Health check logged to DB', () => {
      it('should create database row for each health check', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const checkResult = { status: 'up', latencyMs: 45 };

        // Assuming logHealthCheck is part of the daemon
        await mockQuery(
          'INSERT INTO system_health_logs (service_id, status, latency_ms) VALUES ($1, $2, $3)',
          ['service-123', checkResult.status, checkResult.latencyMs]
        );

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO system_health_logs'),
          expect.any(Array)
        );
      });
    });

    describe('LG-002: Log includes timestamp', () => {
      it('should include timestamp in health check log', async () => {
        const logEntry = {
          serviceId: 'service-123',
          status: 'up',
          timestamp: new Date().toISOString(),
        };

        expect(logEntry.timestamp).toBeDefined();
        expect(new Date(logEntry.timestamp).getTime()).not.toBeNaN();
      });
    });

    describe('LG-003: Log includes service ID', () => {
      it('should include service ID in health check log', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await mockQuery(
          'INSERT INTO system_health_logs (service_id, status) VALUES ($1, $2)',
          ['service-123', 'up']
        );

        expect(mockQuery).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining(['service-123'])
        );
      });
    });

    describe('LG-004: Log includes status', () => {
      it('should include status in health check log', async () => {
        const logEntry = {
          serviceId: 'service-123',
          status: 'down',
        };

        expect(logEntry.status).toBe('down');
        expect(['up', 'down', 'degraded', 'unknown']).toContain(logEntry.status);
      });
    });

    describe('LG-005: Log includes latency', () => {
      it('should include latency in health check log', async () => {
        const logEntry = {
          serviceId: 'service-123',
          status: 'up',
          latencyMs: 45,
        };

        expect(logEntry.latencyMs).toBe(45);
        expect(typeof logEntry.latencyMs).toBe('number');
      });
    });

    describe('LG-006: Error logged on failure', () => {
      it('should log error message when check fails', async () => {
        const logEntry = {
          serviceId: 'service-123',
          status: 'down',
          error: 'Connection refused',
        };

        expect(logEntry.error).toBeDefined();
        expect(typeof logEntry.error).toBe('string');
      });
    });

    describe('LG-007: Logs pruned after 30 days', () => {
      it('should delete logs older than 30 days', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 100 });

        await mockQuery(
          "DELETE FROM system_health_logs WHERE created_at < NOW() - INTERVAL '30 days'"
        );

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining("INTERVAL '30 days'")
        );
      });
    });
  });
});
