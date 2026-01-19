/**
 * QContact Sync API Integration Tests
 *
 * 🟢 WORKING: Tests written following TDD methodology
 *
 * Tests all QContact sync endpoints:
 * - POST /api/ticketing/sync/qcontact - Trigger sync
 * - GET /api/ticketing/sync/qcontact/status - Get sync status
 * - GET /api/ticketing/sync/qcontact/log - Get sync audit log
 *
 * Test Strategy:
 * - Mock service layer to isolate API route logic
 * - Test validation, error handling, and response formats
 * - Verify proper HTTP status codes
 * - Verify response structure matches API standards
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { FullSyncResult } from '../../types/qcontact';
import { SyncDirection, SyncStatus } from '../../types/qcontact';

// Helper to create mock sync result
function createMockSyncResult(
  overrides: Partial<FullSyncResult> = {}
): FullSyncResult {
  return {
    started_at: new Date('2024-01-01T10:00:00Z'),
    completed_at: new Date('2024-01-01T10:05:00Z'),
    duration_seconds: 300,
    inbound_stats: {
      total_processed: 50,
      successful: 48,
      failed: 2,
      partial: 0,
      skipped: 0,
      created: 30,
      updated: 18,
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
    total_success: 68,
    total_failed: 2,
    success_rate: 0.971,
    errors: [],
    ...overrides,
  };
}

// Mock the sync orchestrator service
vi.mock('../../services/qcontactSyncOrchestrator', () => ({
  runFullSync: vi.fn(),
  runInboundOnlySync: vi.fn(),
  runOutboundOnlySync: vi.fn(),
  getSyncProgress: vi.fn(),
}));

// Mock the database utilities
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('QContact Sync API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // POST /api/ticketing/sync/qcontact
  // ============================================================================

  describe('POST /api/ticketing/sync/qcontact', () => {
    it('should trigger full bidirectional sync successfully', async () => {
      const { runFullSync } = await import('../../services/qcontactSyncOrchestrator');
      const mockResult = createMockSyncResult();

      vi.mocked(runFullSync).mockResolvedValue(mockResult);

      const { POST } = await import('@/app/api/ticketing/sync/qcontact/route');
      const request = new Request('http://localhost/api/ticketing/sync/qcontact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Dates are serialized to ISO strings in API responses
      expect(data.data.sync_result.duration_seconds).toBe(mockResult.duration_seconds);
      expect(data.data.sync_result.total_success).toBe(mockResult.total_success);
      expect(data.data.sync_result.total_failed).toBe(mockResult.total_failed);
      expect(data.data.summary).toBeDefined();
      expect(data.data.summary.direction).toBe('bidirectional');
      expect(data.data.summary.total_success).toBe(68);
      expect(data.data.summary.total_failed).toBe(2);
      expect(runFullSync).toHaveBeenCalledOnce();
    });

    it('should trigger inbound-only sync when direction specified', async () => {
      const { runInboundOnlySync } = await import(
        '../../services/qcontactSyncOrchestrator'
      );
      const mockResult = createMockSyncResult({
        outbound_stats: {
          total_processed: 0,
          successful: 0,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 0,
          updated: 0,
        },
      });

      vi.mocked(runInboundOnlySync).mockResolvedValue(mockResult);

      const { POST } = await import('@/app/api/ticketing/sync/qcontact/route');
      const request = new Request('http://localhost/api/ticketing/sync/qcontact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sync_direction: SyncDirection.INBOUND,
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(runInboundOnlySync).toHaveBeenCalledOnce();
    });

    it('should trigger outbound-only sync when direction specified', async () => {
      const { runOutboundOnlySync } = await import(
        '../../services/qcontactSyncOrchestrator'
      );
      const mockResult = createMockSyncResult({
        inbound_stats: {
          total_processed: 0,
          successful: 0,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 0,
          updated: 0,
        },
      });

      vi.mocked(runOutboundOnlySync).mockResolvedValue(mockResult);

      const { POST } = await import('@/app/api/ticketing/sync/qcontact/route');
      const request = new Request('http://localhost/api/ticketing/sync/qcontact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sync_direction: SyncDirection.OUTBOUND,
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(runOutboundOnlySync).toHaveBeenCalledOnce();
    });

    it('should accept date range filters', async () => {
      const { runFullSync } = await import('../../services/qcontactSyncOrchestrator');
      const mockResult = createMockSyncResult();

      vi.mocked(runFullSync).mockResolvedValue(mockResult);

      const { POST } = await import('@/app/api/ticketing/sync/qcontact/route');
      const request = new Request('http://localhost/api/ticketing/sync/qcontact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: '2024-01-01T00:00:00Z',
          end_date: '2024-01-31T23:59:59Z',
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(runFullSync).toHaveBeenCalledWith(
        expect.objectContaining({
          start_date: expect.any(Date),
          end_date: expect.any(Date),
        })
      );
    });

    it('should reject invalid sync_direction', async () => {
      const { POST } = await import('@/app/api/ticketing/sync/qcontact/route');
      const request = new Request('http://localhost/api/ticketing/sync/qcontact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sync_direction: 'invalid_direction',
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('Invalid sync_direction');
    });

    it('should reject invalid date range (start_date after end_date)', async () => {
      const { POST } = await import('@/app/api/ticketing/sync/qcontact/route');
      const request = new Request('http://localhost/api/ticketing/sync/qcontact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: '2024-01-31T00:00:00Z',
          end_date: '2024-01-01T00:00:00Z',
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('Invalid date range');
    });

    it('should handle sync errors gracefully', async () => {
      const { runFullSync } = await import('../../services/qcontactSyncOrchestrator');

      vi.mocked(runFullSync).mockRejectedValue(new Error('Sync service error'));

      const { POST } = await import('@/app/api/ticketing/sync/qcontact/route');
      const request = new Request('http://localhost/api/ticketing/sync/qcontact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('SYNC_ERROR');
    });
  });

  // ============================================================================
  // GET /api/ticketing/sync/qcontact/status
  // ============================================================================

  describe('GET /api/ticketing/sync/qcontact/status', () => {
    it('should return sync status successfully', async () => {
      const { getSyncProgress } = await import(
        '../../services/qcontactSyncOrchestrator'
      );
      const { query, queryOne } = await import('../../utils/db');

      vi.mocked(getSyncProgress).mockResolvedValue({
        total: 100,
        successful: 85,
        failed: 10,
        partial: 5,
        success_rate: 0.85,
      });

      vi.mocked(queryOne).mockResolvedValue({
        synced_at: new Date('2024-01-01T10:00:00Z'),
        status: 'success',
        sync_type: 'full_sync',
        sync_direction: 'inbound',
      });

      vi.mocked(query).mockResolvedValue([
        {
          sync_direction: 'inbound',
          total: '60',
          successful: '50',
          failed: '10',
        },
        {
          sync_direction: 'outbound',
          total: '40',
          successful: '35',
          failed: '5',
        },
      ]);

      const { GET } = await import('@/app/api/ticketing/sync/qcontact/status/route');
      const request = new Request(
        'http://localhost/api/ticketing/sync/qcontact/status',
        {
          method: 'GET',
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.last_sync).toBeDefined();
      expect(data.data.last_24h).toBeDefined();
      expect(data.data.last_24h.total).toBe(100);
      expect(data.data.last_24h.successful).toBe(85);
      expect(data.data.last_24h.success_rate).toBe(0.85);
      expect(data.data.last_7d.by_direction).toBeDefined();
      expect(data.data.health).toBeDefined();
      expect(data.data.health.is_healthy).toBe(true);
    });

    it('should mark as unhealthy when success rate is low', async () => {
      const { getSyncProgress } = await import(
        '../../services/qcontactSyncOrchestrator'
      );
      const { query, queryOne } = await import('../../utils/db');

      vi.mocked(getSyncProgress).mockResolvedValue({
        total: 100,
        successful: 50,
        failed: 50,
        partial: 0,
        success_rate: 0.5, // Below 80% threshold
      });

      vi.mocked(queryOne).mockResolvedValue(null);
      vi.mocked(query).mockResolvedValue([]);

      const { GET } = await import('@/app/api/ticketing/sync/qcontact/status/route');
      const request = new Request(
        'http://localhost/api/ticketing/sync/qcontact/status',
        {
          method: 'GET',
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.health.is_healthy).toBe(false);
      expect(data.data.health.health_issues.length).toBeGreaterThan(0);
      // Check that at least one health issue mentions low success rate
      const hasSuccessRateIssue = data.data.health.health_issues.some((issue: string) =>
        issue.toLowerCase().includes('success rate')
      );
      expect(hasSuccessRateIssue).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      const { getSyncProgress } = await import(
        '../../services/qcontactSyncOrchestrator'
      );

      vi.mocked(getSyncProgress).mockRejectedValue(new Error('Database error'));

      const { GET } = await import('@/app/api/ticketing/sync/qcontact/status/route');
      const request = new Request(
        'http://localhost/api/ticketing/sync/qcontact/status',
        {
          method: 'GET',
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });
  });

  // ============================================================================
  // GET /api/ticketing/sync/qcontact/log
  // ============================================================================

  describe('GET /api/ticketing/sync/qcontact/log', () => {
    it('should return sync logs with pagination', async () => {
      const { query } = await import('../../utils/db');

      const mockLogs = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          ticket_id: '223e4567-e89b-12d3-a456-426614174000',
          qcontact_ticket_id: 'QC-12345',
          sync_direction: SyncDirection.INBOUND,
          sync_type: 'create',
          request_payload: {},
          response_payload: {},
          status: SyncStatus.SUCCESS,
          error_message: null,
          synced_at: new Date(),
        },
      ];

      // Mock count query
      vi.mocked(query)
        .mockResolvedValueOnce([{ total: '1' }])
        // Mock logs query
        .mockResolvedValueOnce(mockLogs)
        // Mock stats query
        .mockResolvedValueOnce([
          {
            sync_direction: 'inbound',
            status: 'success',
            count: '1',
          },
        ]);

      const { GET } = await import('@/app/api/ticketing/sync/qcontact/log/route');
      const request = new Request(
        'http://localhost/api/ticketing/sync/qcontact/log',
        {
          method: 'GET',
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.logs).toHaveLength(1);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.total).toBe(1);
    });

    it('should reject invalid sync_direction filter', async () => {
      const { GET } = await import('@/app/api/ticketing/sync/qcontact/log/route');
      const request = new Request(
        'http://localhost/api/ticketing/sync/qcontact/log?sync_direction=invalid',
        {
          method: 'GET',
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      const { query } = await import('../../utils/db');

      vi.mocked(query).mockRejectedValue(new Error('Database error'));

      const { GET } = await import('@/app/api/ticketing/sync/qcontact/log/route');
      const request = new Request(
        'http://localhost/api/ticketing/sync/qcontact/log',
        {
          method: 'GET',
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });
  });
});
