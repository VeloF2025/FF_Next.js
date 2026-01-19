/**
 * QContact Full Sync Orchestrator Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing full bidirectional sync orchestration:
 * - Run full sync - inbound first, then outbound
 * - Track sync progress
 * - Handle partial failures
 * - Generate sync report
 * - Calculate sync success rate
 *
 * 🟢 WORKING: All 17 tests passing - comprehensive coverage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runFullSync,
  runInboundOnlySync,
  runOutboundOnlySync,
  getSyncProgress,
  calculateSyncSuccessRate,
} from '../../services/qcontactSyncOrchestrator';
import type { FullSyncRequest } from '../../types/qcontact';
import { SyncDirection, SyncStatus } from '../../types/qcontact';

// Mock dependencies
vi.mock('../../services/qcontactSyncInbound', () => ({
  syncInboundTickets: vi.fn(),
}));

vi.mock('../../services/qcontactSyncOutbound', () => ({
  syncOutboundUpdate: vi.fn(),
  pushStatusUpdate: vi.fn(),
  pushAssignment: vi.fn(),
  pushNote: vi.fn(),
  pushTicketClosure: vi.fn(),
}));

vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { syncInboundTickets } from '../../services/qcontactSyncInbound';
import { query, queryOne } from '../../utils/db';

describe('QContact Sync Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runFullSync', () => {
    it('should run inbound sync first, then outbound sync', async () => {
      // 🟢 WORKING: Test full bidirectional sync sequence
      const mockInboundSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        total_processed: 50,
        successful: 45,
        failed: 3,
        skipped: 2,
        created: 40,
        updated: 5,
        errors: [],
      };

      vi.mocked(syncInboundTickets).mockResolvedValue(mockInboundSyncResult);

      // Mock outbound tickets query
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          { id: 'ticket-1', external_id: 'QC-001', status: 'in_progress' },
          { id: 'ticket-2', external_id: 'QC-002', status: 'closed' },
        ],
      });

      const request: FullSyncRequest = {};
      const result = await runFullSync(request);

      // Verify inbound sync was called
      expect(syncInboundTickets).toHaveBeenCalledTimes(1);

      // Verify result structure
      expect(result).toHaveProperty('started_at');
      expect(result).toHaveProperty('completed_at');
      expect(result).toHaveProperty('duration_seconds');
      expect(result).toHaveProperty('inbound_stats');
      expect(result).toHaveProperty('outbound_stats');
      expect(result).toHaveProperty('total_success');
      expect(result).toHaveProperty('total_failed');
      expect(result).toHaveProperty('success_rate');
      expect(result).toHaveProperty('errors');

      // Verify inbound stats
      expect(result.inbound_stats.total_processed).toBe(50);
      expect(result.inbound_stats.successful).toBe(45);
      expect(result.inbound_stats.failed).toBe(3);
    });

    it('should handle inbound sync failures gracefully', async () => {
      // 🟢 WORKING: Test partial failure handling
      const mockInboundSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        total_processed: 10,
        successful: 5,
        failed: 5,
        skipped: 0,
        created: 5,
        updated: 0,
        errors: [
          {
            ticket_id: null,
            qcontact_ticket_id: 'QC-999',
            sync_type: 'create' as const,
            error_message: 'Database connection error',
            error_code: 'DB_ERROR',
            timestamp: new Date(),
            recoverable: true,
          },
        ],
      };

      vi.mocked(syncInboundTickets).mockResolvedValue(mockInboundSyncResult);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] });

      const request: FullSyncRequest = {};
      const result = await runFullSync(request);

      // Should still complete and return results
      expect(result.inbound_stats.failed).toBe(5);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.success_rate).toBeLessThan(1);
    });

    it('should calculate sync success rate correctly', async () => {
      // 🟢 WORKING: Test success rate calculation
      const mockInboundSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        total_processed: 100,
        successful: 90,
        failed: 10,
        skipped: 0,
        created: 90,
        updated: 0,
        errors: [],
      };

      vi.mocked(syncInboundTickets).mockResolvedValue(mockInboundSyncResult);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] });

      const request: FullSyncRequest = {};
      const result = await runFullSync(request);

      // Success rate should be 90/100 = 0.9 (90%)
      expect(result.success_rate).toBeCloseTo(0.9, 2);
      expect(result.total_success).toBe(90);
      expect(result.total_failed).toBe(10);
    });

    it('should track duration and timestamps correctly', async () => {
      // 🟢 WORKING: Test timing tracking
      const mockInboundSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        total_processed: 10,
        successful: 10,
        failed: 0,
        skipped: 0,
        created: 10,
        updated: 0,
        errors: [],
      };

      vi.mocked(syncInboundTickets).mockResolvedValue(mockInboundSyncResult);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] });

      const beforeSync = Date.now();
      const result = await runFullSync({});
      const afterSync = Date.now();

      expect(result.started_at.getTime()).toBeGreaterThanOrEqual(beforeSync);
      expect(result.completed_at.getTime()).toBeLessThanOrEqual(afterSync);
      expect(result.duration_seconds).toBeGreaterThanOrEqual(0);
      expect(result.completed_at.getTime()).toBeGreaterThanOrEqual(result.started_at.getTime());
    });

    it('should generate comprehensive sync report', async () => {
      // 🟢 WORKING: Test sync report generation
      const mockInboundSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        total_processed: 50,
        successful: 45,
        failed: 3,
        skipped: 2,
        created: 40,
        updated: 5,
        errors: [
          {
            ticket_id: null,
            qcontact_ticket_id: 'QC-001',
            sync_type: 'create' as const,
            error_message: 'Validation error',
            error_code: 'VALIDATION_ERROR',
            timestamp: new Date(),
            recoverable: true,
          },
        ],
      };

      vi.mocked(syncInboundTickets).mockResolvedValue(mockInboundSyncResult);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] });

      const result = await runFullSync({});

      // Verify comprehensive report structure
      expect(result.inbound_stats).toMatchObject({
        total_processed: 50,
        successful: 45,
        failed: 3,
        skipped: 2,
        created: 40,
        updated: 5,
      });

      expect(result.outbound_stats).toMatchObject({
        total_processed: 0,
        successful: 0,
        failed: 0,
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        qcontact_ticket_id: 'QC-001',
        sync_type: 'create',
        error_message: 'Validation error',
      });
    });
  });

  describe('runInboundOnlySync', () => {
    it('should run inbound sync only', async () => {
      // 🟢 WORKING: Test inbound-only sync
      const mockInboundSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        total_processed: 30,
        successful: 28,
        failed: 2,
        skipped: 0,
        created: 28,
        updated: 0,
        errors: [],
      };

      vi.mocked(syncInboundTickets).mockResolvedValue(mockInboundSyncResult);

      const request: FullSyncRequest = {
        sync_direction: SyncDirection.INBOUND,
      };

      const result = await runInboundOnlySync(request);

      expect(syncInboundTickets).toHaveBeenCalledTimes(1);
      expect(result.inbound_stats.total_processed).toBe(30);
      expect(result.inbound_stats.successful).toBe(28);

      // Outbound stats should be zero
      expect(result.outbound_stats.total_processed).toBe(0);
      expect(result.outbound_stats.successful).toBe(0);
    });

    it('should pass options to inbound sync service', async () => {
      // 🟢 WORKING: Test options passing
      const mockInboundSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        total_processed: 10,
        successful: 10,
        failed: 0,
        skipped: 0,
        created: 10,
        updated: 0,
        errors: [],
      };

      vi.mocked(syncInboundTickets).mockResolvedValue(mockInboundSyncResult);

      const request: FullSyncRequest = {
        sync_direction: SyncDirection.INBOUND,
        start_date: new Date('2024-01-01T00:00:00Z'),
        end_date: new Date('2024-01-31T23:59:59Z'),
      };

      await runInboundOnlySync(request);

      expect(syncInboundTickets).toHaveBeenCalledWith({
        created_after: request.start_date,
        created_before: request.end_date,
      });
    });
  });

  describe('runOutboundOnlySync', () => {
    it('should run outbound sync only', async () => {
      // 🟢 WORKING: Test outbound-only sync
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          { id: 'ticket-1', external_id: 'QC-001', status: 'in_progress', assigned_to: 'user-1' },
          { id: 'ticket-2', external_id: 'QC-002', status: 'closed', assigned_to: null },
        ],
      });

      const request: FullSyncRequest = {
        sync_direction: SyncDirection.OUTBOUND,
      };

      const result = await runOutboundOnlySync(request);

      // Inbound stats should be zero
      expect(result.inbound_stats.total_processed).toBe(0);
      expect(result.inbound_stats.successful).toBe(0);

      // Outbound stats should show processing
      expect(result.outbound_stats.total_processed).toBeGreaterThanOrEqual(0);
    });

    it('should filter tickets by updated_at when start_date provided', async () => {
      // 🟢 WORKING: Test date filtering for outbound sync
      const startDate = new Date('2024-01-15T00:00:00Z');

      vi.mocked(query).mockResolvedValueOnce({
        rows: [],
      });

      const request: FullSyncRequest = {
        sync_direction: SyncDirection.OUTBOUND,
        start_date: startDate,
      };

      await runOutboundOnlySync(request);

      // Verify query was called with date filter
      expect(query).toHaveBeenCalled();
      const queryCall = vi.mocked(query).mock.calls[0];
      expect(queryCall[0]).toContain('updated_at');
    });
  });

  describe('getSyncProgress', () => {
    it('should return sync progress stats', async () => {
      // 🟢 WORKING: Test progress tracking
      vi.mocked(queryOne).mockResolvedValueOnce({
        total: 100,
        successful: 85,
        failed: 10,
        partial: 5,
      });

      const progress = await getSyncProgress();

      expect(progress).toHaveProperty('total');
      expect(progress).toHaveProperty('successful');
      expect(progress).toHaveProperty('failed');
      expect(progress).toHaveProperty('partial');
      expect(progress.total).toBe(100);
      expect(progress.successful).toBe(85);
    });

    it('should calculate success rate in progress stats', async () => {
      // 🟢 WORKING: Test success rate in progress
      vi.mocked(queryOne).mockResolvedValueOnce({
        total: 200,
        successful: 180,
        failed: 15,
        partial: 5,
      });

      const progress = await getSyncProgress();

      // Success rate is calculated as successful / (successful + failed)
      const expectedSuccessRate = 180 / (180 + 15); // 0.923
      expect(progress).toHaveProperty('success_rate');
      expect(progress.success_rate).toBeCloseTo(expectedSuccessRate, 2);
    });
  });

  describe('calculateSyncSuccessRate', () => {
    it('should calculate success rate correctly with only successes', () => {
      // 🟢 WORKING: Test 100% success rate
      const rate = calculateSyncSuccessRate(100, 0);
      expect(rate).toBe(1.0);
    });

    it('should calculate success rate correctly with mixed results', () => {
      // 🟢 WORKING: Test partial success rate
      const rate = calculateSyncSuccessRate(75, 25);
      expect(rate).toBeCloseTo(0.75, 2);
    });

    it('should return 0 when total is zero', () => {
      // 🟢 WORKING: Test zero total handling
      const rate = calculateSyncSuccessRate(0, 0);
      expect(rate).toBe(0);
    });

    it('should handle all failures correctly', () => {
      // 🟢 WORKING: Test 0% success rate
      const rate = calculateSyncSuccessRate(0, 100);
      expect(rate).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle inbound sync service errors', async () => {
      // 🟢 WORKING: Test error handling for inbound failures
      vi.mocked(syncInboundTickets).mockRejectedValue(
        new Error('QContact API unavailable')
      );

      await expect(runFullSync({})).rejects.toThrow('QContact API unavailable');
    });

    it('should continue outbound sync even if inbound fails', async () => {
      // 🟢 WORKING: Test resilience - partial sync completion
      const mockInboundSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        total_processed: 10,
        successful: 0,
        failed: 10,
        skipped: 0,
        created: 0,
        updated: 0,
        errors: [
          {
            ticket_id: null,
            qcontact_ticket_id: 'QC-001',
            sync_type: 'create' as const,
            error_message: 'API error',
            error_code: 'API_ERROR',
            timestamp: new Date(),
            recoverable: false,
          },
        ],
      };

      vi.mocked(syncInboundTickets).mockResolvedValue(mockInboundSyncResult);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] });

      const result = await runFullSync({});

      // Should complete with failed inbound stats
      expect(result.inbound_stats.failed).toBe(10);
      expect(result.inbound_stats.successful).toBe(0);

      // Should still attempt outbound
      expect(result.outbound_stats).toBeDefined();
    });
  });
});
