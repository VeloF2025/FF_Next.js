/**
 * QContact Sync Background Job Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing automatic periodic sync job:
 * - Job runs on schedule
 * - Job triggers full sync
 * - Job handles errors gracefully
 * - Job logs execution
 * - Job tracks execution history
 *
 * ⚪ UNTESTED: Tests written, implementation pending
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runSyncJob,
  getSyncJobHistory,
  getLastSyncJobRun,
  type SyncJobResult,
  type SyncJobHistoryEntry,
} from '../../jobs/qcontactSync';

// Mock dependencies
vi.mock('../../services/qcontactSyncOrchestrator', () => ({
  runFullSync: vi.fn(),
  runInboundOnlySync: vi.fn(),
  runOutboundOnlySync: vi.fn(),
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

import { runFullSync } from '../../services/qcontactSyncOrchestrator';
import { query, queryOne } from '../../utils/db';

describe('QContact Sync Background Job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runSyncJob', () => {
    it('should run full sync successfully', async () => {
      // 🟢 TDD: Test basic job execution
      const mockSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        inbound_stats: {
          total_processed: 50,
          successful: 50,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 45,
          updated: 5,
        },
        outbound_stats: {
          total_processed: 20,
          successful: 20,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 0,
          updated: 20,
        },
        total_success: 70,
        total_failed: 0,
        success_rate: 1.0,
        errors: [],
      };

      vi.mocked(runFullSync).mockResolvedValue(mockSyncResult);

      // Mock job history insert
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            id: 'job-1',
            started_at: mockSyncResult.started_at,
            completed_at: mockSyncResult.completed_at,
          },
        ],
      });

      const result = await runSyncJob();

      // Verify full sync was called
      expect(runFullSync).toHaveBeenCalledTimes(1);

      // Verify result structure
      expect(result).toHaveProperty('job_id');
      expect(result).toHaveProperty('started_at');
      expect(result).toHaveProperty('completed_at');
      expect(result).toHaveProperty('duration_seconds');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('sync_result');

      // Verify job succeeded (no failures = success)
      expect(result.status).toBe('success');
      expect(result.sync_result).toEqual(mockSyncResult);
    });

    it('should handle sync errors gracefully', async () => {
      // 🟢 TDD: Test error handling
      const syncError = new Error('QContact API unavailable');
      vi.mocked(runFullSync).mockRejectedValue(syncError);

      // Mock job history insert for failed job
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            id: 'job-2',
            started_at: new Date(),
            completed_at: new Date(),
          },
        ],
      });

      const result = await runSyncJob();

      // Job should complete with error status
      expect(result.status).toBe('failed');
      expect(result).toHaveProperty('error_message');
      expect(result.error_message).toContain('QContact API unavailable');

      // Sync result should be null on failure
      expect(result.sync_result).toBeNull();
    });

    it('should log execution to database', async () => {
      // 🟢 TDD: Test execution logging
      const mockSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        inbound_stats: {
          total_processed: 10,
          successful: 10,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 10,
          updated: 0,
        },
        outbound_stats: {
          total_processed: 0,
          successful: 0,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 0,
          updated: 0,
        },
        total_success: 10,
        total_failed: 0,
        success_rate: 1.0,
        errors: [],
      };

      vi.mocked(runFullSync).mockResolvedValue(mockSyncResult);

      // Mock database insert
      const mockJobId = 'job-123';
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            id: mockJobId,
            started_at: mockSyncResult.started_at,
            completed_at: mockSyncResult.completed_at,
          },
        ],
      });

      const result = await runSyncJob();

      // Verify database insert was called
      expect(query).toHaveBeenCalled();

      // Verify SQL includes job tracking fields
      const insertCall = vi.mocked(query).mock.calls[0];
      const sql = insertCall[0];
      expect(sql).toContain('INSERT INTO');
      expect(sql).toContain('sync_job_history');

      // Verify job ID returned
      expect(result.job_id).toBe(mockJobId);
    });

    it('should track duration correctly', async () => {
      // 🟢 TDD: Test duration tracking
      const mockSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        inbound_stats: {
          total_processed: 5,
          successful: 5,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 5,
          updated: 0,
        },
        outbound_stats: {
          total_processed: 0,
          successful: 0,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 0,
          updated: 0,
        },
        total_success: 5,
        total_failed: 0,
        success_rate: 1.0,
        errors: [],
      };

      vi.mocked(runFullSync).mockResolvedValue(mockSyncResult);
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            id: 'job-4',
            started_at: mockSyncResult.started_at,
            completed_at: mockSyncResult.completed_at,
          },
        ],
      });

      const beforeRun = Date.now();
      const result = await runSyncJob();
      const afterRun = Date.now();

      // Duration should be positive
      expect(result.duration_seconds).toBeGreaterThanOrEqual(0);

      // Timestamps should be in correct range
      expect(result.started_at.getTime()).toBeGreaterThanOrEqual(beforeRun);
      expect(result.completed_at!.getTime()).toBeLessThanOrEqual(afterRun);
      expect(result.completed_at!.getTime()).toBeGreaterThanOrEqual(
        result.started_at.getTime()
      );
    });

    it('should support custom sync options', async () => {
      // 🟢 TDD: Test custom sync configuration
      const mockSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        inbound_stats: {
          total_processed: 5,
          successful: 5,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 5,
          updated: 0,
        },
        outbound_stats: {
          total_processed: 0,
          successful: 0,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 0,
          updated: 0,
        },
        total_success: 5,
        total_failed: 0,
        success_rate: 1.0,
        errors: [],
      };

      vi.mocked(runFullSync).mockResolvedValue(mockSyncResult);
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ id: 'job-5', started_at: new Date(), completed_at: new Date() }],
      });

      const customOptions = {
        start_date: new Date('2024-01-01T00:00:00Z'),
        end_date: new Date('2024-01-31T23:59:59Z'),
      };

      await runSyncJob(customOptions);

      // Verify custom options passed to sync
      expect(runFullSync).toHaveBeenCalledWith(customOptions);
    });

    it('should handle partial failures gracefully', async () => {
      // 🟢 TDD: Test partial failure handling
      const mockSyncResult = {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        inbound_stats: {
          total_processed: 20,
          successful: 15,
          failed: 5,
          partial: 0,
          skipped: 0,
          created: 15,
          updated: 0,
        },
        outbound_stats: {
          total_processed: 10,
          successful: 8,
          failed: 2,
          partial: 0,
          skipped: 0,
          created: 0,
          updated: 8,
        },
        total_success: 23,
        total_failed: 7,
        success_rate: 0.77,
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

      vi.mocked(runFullSync).mockResolvedValue(mockSyncResult);
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ id: 'job-6', started_at: new Date(), completed_at: new Date() }],
      });

      const result = await runSyncJob();

      // Job should complete with partial success
      expect(result.status).toBe('partial');
      expect(result.sync_result?.total_failed).toBeGreaterThan(0);
      expect(result.sync_result?.total_success).toBeGreaterThan(0);
    });
  });

  describe('getSyncJobHistory', () => {
    it('should retrieve job execution history', async () => {
      // 🟢 TDD: Test history retrieval
      const mockHistory = [
        {
          id: 'job-1',
          started_at: new Date('2024-01-15T10:00:00Z'),
          completed_at: new Date('2024-01-15T10:05:00Z'),
          duration_seconds: 300,
          status: 'success',
          total_processed: 50,
          total_success: 45,
          total_failed: 5,
          success_rate: 0.9,
          error_message: null,
        },
        {
          id: 'job-2',
          started_at: new Date('2024-01-15T09:00:00Z'),
          completed_at: new Date('2024-01-15T09:03:00Z'),
          duration_seconds: 180,
          status: 'success',
          total_processed: 30,
          total_success: 30,
          total_failed: 0,
          success_rate: 1.0,
          error_message: null,
        },
      ];

      vi.mocked(query).mockResolvedValueOnce({
        rows: mockHistory,
      });

      const history = await getSyncJobHistory({ limit: 10 });

      expect(history).toHaveLength(2);
      expect(history[0]).toHaveProperty('id');
      expect(history[0]).toHaveProperty('status');
      expect(history[0]).toHaveProperty('duration_seconds');
      expect(history[0]).toHaveProperty('success_rate');
    });

    it('should support limit parameter', async () => {
      // 🟢 TDD: Test pagination limit
      vi.mocked(query).mockResolvedValueOnce({
        rows: [],
      });

      await getSyncJobHistory({ limit: 5 });

      // Verify limit in SQL
      expect(query).toHaveBeenCalled();
      const queryCall = vi.mocked(query).mock.calls[0];
      expect(queryCall[0]).toContain('LIMIT');
    });

    it('should filter by status', async () => {
      // 🟢 TDD: Test status filtering
      const mockHistory = [
        {
          id: 'job-1',
          started_at: new Date('2024-01-15T10:00:00Z'),
          completed_at: new Date('2024-01-15T10:05:00Z'),
          duration_seconds: 300,
          status: 'failed',
          total_processed: 10,
          total_success: 0,
          total_failed: 10,
          success_rate: 0,
          error_message: 'API error',
        },
      ];

      vi.mocked(query).mockResolvedValueOnce({
        rows: mockHistory,
      });

      const history = await getSyncJobHistory({ status: 'failed' });

      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('failed');

      // Verify status filter in SQL
      const queryCall = vi.mocked(query).mock.calls[0];
      expect(queryCall[0]).toContain('WHERE');
      expect(queryCall[0]).toContain('status');
    });
  });

  describe('getLastSyncJobRun', () => {
    it('should retrieve the most recent job run', async () => {
      // 🟢 TDD: Test last run retrieval
      const mockLastRun = {
        id: 'job-latest',
        started_at: new Date('2024-01-15T12:00:00Z'),
        completed_at: new Date('2024-01-15T12:05:00Z'),
        duration_seconds: 300,
        status: 'success',
        total_processed: 25,
        total_success: 25,
        total_failed: 0,
        success_rate: 1.0,
        error_message: null,
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockLastRun);

      const lastRun = await getLastSyncJobRun();

      expect(lastRun).toBeDefined();
      expect(lastRun?.id).toBe('job-latest');
      expect(lastRun?.status).toBe('success');

      // Verify query includes ORDER BY and LIMIT 1
      expect(queryOne).toHaveBeenCalled();
      const queryCall = vi.mocked(queryOne).mock.calls[0];
      expect(queryCall[0]).toContain('ORDER BY');
      expect(queryCall[0]).toContain('LIMIT 1');
    });

    it('should return null when no job history exists', async () => {
      // 🟢 TDD: Test empty history case
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const lastRun = await getLastSyncJobRun();

      expect(lastRun).toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      // 🟢 TDD: Test error handling
      vi.mocked(queryOne).mockRejectedValueOnce(
        new Error('Database connection error')
      );

      await expect(getLastSyncJobRun()).rejects.toThrow(
        'Database connection error'
      );
    });
  });
});
