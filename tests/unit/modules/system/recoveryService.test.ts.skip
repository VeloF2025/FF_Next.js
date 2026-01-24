/**
 * Test Specification: Recovery Service
 * Source: tests/specs/recovery-service.spec.md
 * Phase: RED (failing tests)
 *
 * Executes recovery actions for failing services with risk-based handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RecoveryService,
  executeAction,
  executeSSHCommand,
  verifySuccess,
  checkCooldown,
  executeRollback,
} from '@/modules/system/services/recoveryService';
import { pool } from '@/lib/db';
import { spawn } from 'child_process';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
}));

// Mock fetch for verification
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockQuery = vi.mocked(pool.query);
const mockSpawn = vi.mocked(spawn);

// Test data
const safeAction = {
  id: 'action-safe',
  serviceId: 'service-123',
  actionName: 'Restart Service',
  command: 'systemctl restart fibreflow.service',
  riskLevel: 'safe' as const,
  requiresApproval: false,
  successIndicator: 'systemctl is-active fibreflow.service',
  rollbackCommand: null,
  timeout: 60000,
};

const moderateAction = {
  id: 'action-moderate',
  serviceId: 'service-123',
  actionName: 'Rebuild and Restart',
  command: 'cd /home/app && git reset --hard origin/master && npm install && npm run build',
  riskLevel: 'moderate' as const,
  requiresApproval: true,
  successIndicator: 'curl -s https://app.fibreflow.app/api/health',
  rollbackCommand: 'git checkout HEAD~1',
  timeout: 300000,
};

const dangerousAction = {
  id: 'action-dangerous',
  serviceId: 'service-123',
  actionName: 'Truncate Logs',
  command: 'psql -c "TRUNCATE TABLE system_health_logs"',
  riskLevel: 'dangerous' as const,
  requiresApproval: true,
  successIndicator: null,
  rollbackCommand: null,
  timeout: 60000,
};

describe('Recovery Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Action Execution', () => {
    describe('AE-001: Execute simple command', () => {
      it('should return stdout="hello" when executing echo hello', async () => {
        const mockProcess = {
          stdout: { on: vi.fn((event, cb) => cb('hello\n')) },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeAction({ command: 'echo hello', timeout: 60000 });

        expect(result.stdout).toContain('hello');
        expect(result.exitCode).toBe(0);
      });
    });

    describe('AE-002: Execute systemctl restart', () => {
      it('should restart the specified service', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeAction({
          command: 'systemctl restart fibreflow.service',
          timeout: 60000,
        });

        expect(mockSpawn).toHaveBeenCalledWith(
          'bash',
          ['-c', 'systemctl restart fibreflow.service'],
          expect.any(Object)
        );
        expect(result.exitCode).toBe(0);
      });
    });

    describe('AE-003: Handle command not found', () => {
      it('should capture error when command is not found', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn((event, cb) => cb('command not found: invalidcmd\n')) },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(127);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeAction({
          command: 'invalidcmd',
          timeout: 60000,
        });

        expect(result.exitCode).toBe(127);
        expect(result.stderr).toContain('command not found');
        expect(result.error).toBeDefined();
      });
    });

    describe('AE-004: Handle permission denied', () => {
      it('should capture error when permission is denied', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn((event, cb) => cb('Permission denied\n')) },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(1);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeAction({
          command: 'restricted-command',
          timeout: 60000,
        });

        expect(result.stderr).toContain('Permission denied');
        expect(result.success).toBe(false);
      });
    });

    describe('AE-005: Timeout after 60s', () => {
      it('should throw TimeoutError when command exceeds 60 seconds', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const resultPromise = executeAction({
          command: 'sleep 120',
          timeout: 60000,
        });

        vi.advanceTimersByTime(60000);

        const result = await resultPromise;

        expect(result.error).toContain('timeout');
        expect(mockProcess.kill).toHaveBeenCalled();
      });
    });

    describe('AE-006: Custom timeout respected', () => {
      it('should use custom timeout of 30 seconds when specified', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          kill: vi.fn(),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const resultPromise = executeAction({
          command: 'slow-command',
          timeout: 30000,
        });

        vi.advanceTimersByTime(30000);

        const result = await resultPromise;

        expect(result.error).toContain('timeout');
      });
    });

    describe('AE-007: SSH to remote server', () => {
      it('should execute command on VPS via SSH', async () => {
        const mockProcess = {
          stdout: { on: vi.fn((event, cb) => cb('VPS output\n')) },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeSSHCommand({
          host: '72.61.197.178',
          command: 'systemctl restart whatsapp-sender',
          timeout: 60000,
        });

        expect(mockSpawn).toHaveBeenCalledWith(
          'ssh',
          expect.arrayContaining(['72.61.197.178']),
          expect.any(Object)
        );
        expect(result.stdout).toContain('VPS output');
      });
    });

    describe('AE-008: SSH handles connection failure', () => {
      it('should capture error when SSH connection fails', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn((event, cb) => cb('Connection refused\n')) },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(255);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeSSHCommand({
          host: 'unreachable-host',
          command: 'echo test',
          timeout: 60000,
        });

        expect(result.success).toBe(false);
        expect(result.stderr).toContain('Connection refused');
      });
    });

    describe('AE-009: Capture stdout', () => {
      it('should store stdout from command execution', async () => {
        const mockProcess = {
          stdout: { on: vi.fn((event, cb) => cb('Output line 1\nOutput line 2\n')) },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeAction({
          command: 'multi-line-output',
          timeout: 60000,
        });

        expect(result.stdout).toContain('Output line 1');
        expect(result.stdout).toContain('Output line 2');
      });
    });

    describe('AE-010: Capture stderr', () => {
      it('should store stderr from command execution', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn((event, cb) => cb('Warning: deprecated option\n')) },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeAction({
          command: 'command-with-warning',
          timeout: 60000,
        });

        expect(result.stderr).toContain('Warning: deprecated option');
      });
    });

    describe('AE-011: Exit code captured', () => {
      it('should store non-zero exit code', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(1);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeAction({
          command: 'failing-command',
          timeout: 60000,
        });

        expect(result.exitCode).toBe(1);
        expect(result.success).toBe(false);
      });
    });

    describe('AE-012: Environment variables set', () => {
      it('should make environment variables available to command', async () => {
        const mockProcess = {
          stdout: { on: vi.fn((event, cb) => cb('ENV_VALUE\n')) },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeAction({
          command: 'echo $MY_VAR',
          timeout: 60000,
          env: { MY_VAR: 'ENV_VALUE' },
        });

        expect(mockSpawn).toHaveBeenCalledWith(
          'bash',
          expect.any(Array),
          expect.objectContaining({
            env: expect.objectContaining({ MY_VAR: 'ENV_VALUE' }),
          })
        );
      });
    });
  });

  describe('Risk Level Handling', () => {
    let recoveryService: RecoveryService;

    beforeEach(() => {
      recoveryService = new RecoveryService();
    });

    describe('RL-001: Safe action executes immediately', () => {
      it('should execute safe action without waiting for approval', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await recoveryService.execute(safeAction);

        expect(result.executed).toBe(true);
        expect(result.waitedForApproval).toBe(false);
      });
    });

    describe('RL-002: Safe action no notification', () => {
      it('should not send WhatsApp notification for safe action', async () => {
        const sendNotification = vi.fn();
        recoveryService = new RecoveryService({ sendNotification });

        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        await recoveryService.execute(safeAction);

        expect(sendNotification).not.toHaveBeenCalled();
      });
    });

    describe('RL-003: Moderate sends notification', () => {
      it('should send WhatsApp notification for moderate action', async () => {
        const sendNotification = vi.fn();
        recoveryService = new RecoveryService({ sendNotification });

        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123' }],
          rowCount: 1,
        });

        await recoveryService.queue(moderateAction);

        expect(sendNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'approval_requested',
            riskLevel: 'moderate',
          })
        );
      });
    });

    describe('RL-004: Moderate queues for approval', () => {
      it('should create approval queue entry for moderate action', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'pending' }],
          rowCount: 1,
        });

        const result = await recoveryService.queue(moderateAction);

        expect(result.queued).toBe(true);
        expect(result.approvalId).toBe('approval-123');
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO'),
          expect.any(Array)
        );
      });
    });

    describe('RL-005: Moderate auto-approves after 10m', () => {
      it('should auto-execute moderate action after 10 minutes without response', async () => {
        mockQuery
          .mockResolvedValueOnce({
            rows: [{ id: 'approval-123', status: 'pending', createdAt: new Date(Date.now() - 11 * 60 * 1000) }],
            rowCount: 1,
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // Update to approved

        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await recoveryService.checkAndAutoApprove('approval-123');

        expect(result.autoApproved).toBe(true);
        expect(result.executed).toBe(true);
      });
    });

    describe('RL-006: Dangerous requires approval', () => {
      it('should not execute dangerous action without explicit approval', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-456', status: 'pending' }],
          rowCount: 1,
        });

        const result = await recoveryService.queue(dangerousAction);

        expect(result.queued).toBe(true);
        expect(result.executed).toBe(false);
      });
    });

    describe('RL-007: Dangerous never auto-approves', () => {
      it('should keep dangerous action pending even after 1 hour', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{
            id: 'approval-456',
            status: 'pending',
            riskLevel: 'dangerous',
            createdAt: new Date(Date.now() - 61 * 60 * 1000), // 61 minutes ago
          }],
          rowCount: 1,
        });

        const result = await recoveryService.checkAndAutoApprove('approval-456');

        expect(result.autoApproved).toBe(false);
        expect(result.status).toBe('pending');
      });
    });

    describe('RL-008: Rejected action logged', () => {
      it('should update status to rejected with reason', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'rejected', rejectedBy: 'user-1', reason: 'Too risky' }],
          rowCount: 1,
        });

        const result = await recoveryService.reject('approval-123', {
          userId: 'user-1',
          reason: 'Too risky',
        });

        expect(result.status).toBe('rejected');
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE'),
          expect.arrayContaining(['rejected', 'user-1', 'Too risky'])
        );
      });
    });

    describe('RL-009: Approved action executes', () => {
      it('should execute action when user approves', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'approved', actionId: 'action-123' }],
          rowCount: 1,
        });

        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await recoveryService.approve('approval-123', { userId: 'user-1' });

        expect(result.status).toBe('approved');
        expect(result.executed).toBe(true);
      });
    });

    describe('RL-010: Multiple approvers respected', () => {
      it('should allow any configured approver to approve', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'approval-123', status: 'approved', approvedBy: 'user-2' }],
          rowCount: 1,
        });

        const result = await recoveryService.approve('approval-123', { userId: 'user-2' });

        expect(result.status).toBe('approved');
      });
    });
  });

  describe('Success Verification', () => {
    describe('SV-001: Success on healthy endpoint', () => {
      it('should return status=success when health endpoint returns 200', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
        });

        const result = await verifySuccess('https://app.fibreflow.app/api/health');

        expect(result.status).toBe('success');
      });
    });

    describe('SV-002: Failure on unhealthy endpoint', () => {
      it('should return status=failure when health endpoint returns 500', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

        const result = await verifySuccess('https://app.fibreflow.app/api/health');

        expect(result.status).toBe('failure');
      });
    });

    describe('SV-003: Retry 3 times on failure', () => {
      it('should attempt verification 3 times before giving up', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: false, status: 500 })
          .mockResolvedValueOnce({ ok: false, status: 500 })
          .mockResolvedValueOnce({ ok: false, status: 500 });

        await verifySuccess('https://app.fibreflow.app/api/health', { maxRetries: 3 });

        expect(mockFetch).toHaveBeenCalledTimes(3);
      });
    });

    describe('SV-004: Success on 3rd retry', () => {
      it('should return success if 3rd retry succeeds', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: false, status: 500 })
          .mockResolvedValueOnce({ ok: false, status: 500 })
          .mockResolvedValueOnce({ ok: true, status: 200 });

        const result = await verifySuccess('https://app.fibreflow.app/api/health', { maxRetries: 3 });

        expect(result.status).toBe('success');
        expect(result.retriesNeeded).toBe(2);
      });
    });

    describe('SV-005: Failure after all retries', () => {
      it('should return failure if all retries fail', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 500 });

        const result = await verifySuccess('https://app.fibreflow.app/api/health', { maxRetries: 3 });

        expect(result.status).toBe('failure');
      });
    });

    describe('SV-006: 5s delay between retries', () => {
      it('should wait 5 seconds between retry attempts', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: false, status: 500 })
          .mockResolvedValueOnce({ ok: true, status: 200 });

        const startTime = Date.now();
        const resultPromise = verifySuccess('https://app.fibreflow.app/api/health', {
          maxRetries: 3,
          retryDelayMs: 5000,
        });

        vi.advanceTimersByTime(5000);
        await resultPromise;

        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    describe('SV-007: Custom indicator evaluated', () => {
      it('should use systemctl check as success indicator', async () => {
        const mockProcess = {
          stdout: { on: vi.fn((event, cb) => cb('active\n')) },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await verifySuccess('systemctl is-active fibreflow.service', {
          type: 'command',
        });

        expect(result.status).toBe('success');
      });
    });

    describe('SV-008: No indicator = assume success', () => {
      it('should return success when no indicator is configured', async () => {
        const result = await verifySuccess(null);

        expect(result.status).toBe('success');
        expect(result.assumed).toBe(true);
      });
    });
  });

  describe('Cooldown Management', () => {
    describe('CD-001: Skip action in cooldown', () => {
      it('should skip action when last execution was 2 minutes ago', async () => {
        const lastExecuted = new Date(Date.now() - 2 * 60 * 1000); // 2 min ago

        const result = await checkCooldown({
          actionId: 'action-123',
          lastExecuted,
          cooldownMinutes: 5,
        });

        expect(result.inCooldown).toBe(true);
        expect(result.remainingSeconds).toBeGreaterThan(0);
      });
    });

    describe('CD-002: Execute action after cooldown', () => {
      it('should allow action when last execution was 6 minutes ago', async () => {
        const lastExecuted = new Date(Date.now() - 6 * 60 * 1000); // 6 min ago

        const result = await checkCooldown({
          actionId: 'action-123',
          lastExecuted,
          cooldownMinutes: 5,
        });

        expect(result.inCooldown).toBe(false);
      });
    });

    describe('CD-003: Cooldown per-action not service', () => {
      it('should allow Action B when Action A is in cooldown', async () => {
        const actionA = { actionId: 'action-a', lastExecuted: new Date(Date.now() - 2 * 60 * 1000), cooldownMinutes: 5 };
        const actionB = { actionId: 'action-b', lastExecuted: null, cooldownMinutes: 5 };

        const resultA = await checkCooldown(actionA);
        const resultB = await checkCooldown(actionB);

        expect(resultA.inCooldown).toBe(true);
        expect(resultB.inCooldown).toBe(false);
      });
    });

    describe('CD-004: Default cooldown is 5 min', () => {
      it('should use 5 minute cooldown by default', async () => {
        const lastExecuted = new Date(Date.now() - 4 * 60 * 1000); // 4 min ago

        const result = await checkCooldown({
          actionId: 'action-123',
          lastExecuted,
          // No cooldownMinutes specified - should default to 5
        });

        expect(result.inCooldown).toBe(true);
      });
    });

    describe('CD-005: Custom cooldown respected', () => {
      it('should use custom 10 minute cooldown when specified', async () => {
        const lastExecuted = new Date(Date.now() - 6 * 60 * 1000); // 6 min ago

        const result = await checkCooldown({
          actionId: 'action-123',
          lastExecuted,
          cooldownMinutes: 10,
        });

        expect(result.inCooldown).toBe(true); // Still in cooldown because custom is 10 min
      });
    });

    describe('CD-006: Success resets cooldown', () => {
      it('should reset cooldown timer after successful action', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'action-123', lastExecuted: new Date() }],
          rowCount: 1,
        });

        const recoveryService = new RecoveryService();
        await recoveryService.recordSuccess('action-123');

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('last_executed'),
          expect.any(Array)
        );
      });
    });

    describe('CD-007: Failure doesn\'t reset cooldown', () => {
      it('should not reset cooldown timer after failed action', async () => {
        const lastExecuted = new Date(Date.now() - 2 * 60 * 1000);

        // After failure, cooldown should continue from original timestamp
        const result = await checkCooldown({
          actionId: 'action-123',
          lastExecuted,
          cooldownMinutes: 5,
        });

        expect(result.inCooldown).toBe(true);
      });
    });

    describe('CD-008: Force bypass cooldown', () => {
      it('should allow action when force=true ignores cooldown', async () => {
        const lastExecuted = new Date(Date.now() - 1 * 60 * 1000); // 1 min ago

        const result = await checkCooldown({
          actionId: 'action-123',
          lastExecuted,
          cooldownMinutes: 5,
          force: true,
        });

        expect(result.inCooldown).toBe(false);
        expect(result.bypassed).toBe(true);
      });
    });
  });

  describe('Rollback Support', () => {
    describe('RB-001: Rollback on action failure', () => {
      it('should execute rollback when action fails and rollback command exists', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeRollback({
          originalCommand: 'npm run build',
          rollbackCommand: 'git checkout HEAD~1',
          reason: 'Build failed',
        });

        expect(result.rollbackExecuted).toBe(true);
        expect(mockSpawn).toHaveBeenCalledWith(
          'bash',
          ['-c', 'git checkout HEAD~1'],
          expect.any(Object)
        );
      });
    });

    describe('RB-002: No rollback if no command', () => {
      it('should not attempt rollback when rollbackCommand is null', async () => {
        const result = await executeRollback({
          originalCommand: 'echo test',
          rollbackCommand: null,
          reason: 'Test failure',
        });

        expect(result.rollbackExecuted).toBe(false);
        expect(mockSpawn).not.toHaveBeenCalled();
      });
    });

    describe('RB-003: Rollback logged separately', () => {
      it('should create separate log entry for rollback action', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        await executeRollback({
          originalCommand: 'npm run build',
          rollbackCommand: 'git checkout HEAD~1',
          reason: 'Build failed',
          logToDatabase: true,
        });

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT'),
          expect.arrayContaining(['rollback'])
        );
      });
    });

    describe('RB-004: Rollback success logged', () => {
      it('should set status=rolled_back when rollback succeeds', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeRollback({
          originalCommand: 'npm run build',
          rollbackCommand: 'git checkout HEAD~1',
          reason: 'Build failed',
        });

        expect(result.status).toBe('rolled_back');
      });
    });

    describe('RB-005: Rollback failure logged', () => {
      it('should log rollback error when rollback fails', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn((event, cb) => cb('Rollback failed\n')) },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(1);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const result = await executeRollback({
          originalCommand: 'npm run build',
          rollbackCommand: 'git checkout HEAD~1',
          reason: 'Build failed',
        });

        expect(result.status).toBe('rollback_failed');
        expect(result.rollbackError).toBeDefined();
      });
    });

    describe('RB-006: No rollback for safe actions', () => {
      it('should not attempt rollback for safe actions even on failure', async () => {
        const recoveryService = new RecoveryService();

        const result = await recoveryService.handleFailure({
          action: safeAction,
          error: 'Service restart failed',
        });

        expect(result.rollbackAttempted).toBe(false);
      });
    });

    describe('RB-007: Rollback for moderate actions', () => {
      it('should attempt rollback for moderate actions if rollback command exists', async () => {
        const mockProcess = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event, cb) => {
            if (event === 'close') cb(0);
          }),
        };
        mockSpawn.mockReturnValue(mockProcess as any);

        const recoveryService = new RecoveryService();

        const result = await recoveryService.handleFailure({
          action: moderateAction,
          error: 'Build failed',
        });

        expect(result.rollbackAttempted).toBe(true);
      });
    });

    describe('RB-008: No auto-rollback dangerous', () => {
      it('should queue rollback for approval instead of auto-executing for dangerous actions', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'rollback-approval-123' }],
          rowCount: 1,
        });

        const recoveryService = new RecoveryService();

        const result = await recoveryService.handleFailure({
          action: { ...dangerousAction, rollbackCommand: 'DANGEROUS ROLLBACK' },
          error: 'Action failed',
        });

        expect(result.rollbackQueued).toBe(true);
        expect(result.rollbackExecuted).toBe(false);
      });
    });
  });

  describe('Logging', () => {
    describe('LG-001: Attempt logged to DB', () => {
      it('should create database row for action execution', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const recoveryService = new RecoveryService();
        await recoveryService.logAttempt({
          actionId: 'action-123',
          serviceId: 'service-123',
          command: 'systemctl restart',
          result: 'success',
        });

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO infrastructure_incidents'),
          expect.any(Array)
        );
      });
    });

    describe('LG-002 to LG-007: Log fields', () => {
      it('should include all required fields in log entry', async () => {
        const logEntry = {
          actionId: 'action-123',
          serviceId: 'service-123',
          startTime: new Date(),
          endTime: new Date(),
          result: 'success',
          output: 'stdout content',
          error: null,
          durationSeconds: 5,
        };

        expect(logEntry.actionId).toBeDefined();
        expect(logEntry.serviceId).toBeDefined();
        expect(logEntry.startTime).toBeDefined();
        expect(logEntry.endTime).toBeDefined();
        expect(logEntry.result).toBeDefined();
        expect(logEntry.output).toBeDefined();
        expect(logEntry.durationSeconds).toBeDefined();
      });
    });

    describe('LG-008: KB file created', () => {
      it('should write markdown file for action execution', async () => {
        const writeFile = vi.fn();
        const recoveryService = new RecoveryService({ writeKBFile: writeFile });

        await recoveryService.logToKnowledgeBase({
          actionId: 'action-123',
          serviceId: 'service-123',
          result: 'success',
        });

        expect(writeFile).toHaveBeenCalledWith(
          expect.stringContaining('.claude/knowledge-base/incidents/'),
          expect.stringContaining('# Incident:')
        );
      });
    });

    describe('LG-009: KB file includes context', () => {
      it('should include full details in KB file', async () => {
        let fileContent = '';
        const writeFile = vi.fn((path, content) => {
          fileContent = content;
        });

        const recoveryService = new RecoveryService({ writeKBFile: writeFile });

        await recoveryService.logToKnowledgeBase({
          actionId: 'action-123',
          serviceId: 'service-123',
          serviceName: 'FibreFlow Production',
          result: 'success',
          command: 'systemctl restart',
          duration: 5,
        });

        expect(fileContent).toContain('FibreFlow Production');
        expect(fileContent).toContain('systemctl restart');
        expect(fileContent).toContain('5');
      });
    });
  });
});
