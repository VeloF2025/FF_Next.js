/**
 * QContact Sync Cron Job API Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing cron-triggered sync endpoint:
 * - POST /api/ticketing/cron/sync-qcontact
 * - Authorization verification
 * - Job execution tracking
 * - Error handling
 *
 * 🟢 WORKING: All tests passing - comprehensive coverage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, GET } from '@/app/api/ticketing/cron/sync-qcontact/route';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@/modules/ticketing/jobs/qcontactSync', () => ({
  runSyncJob: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { runSyncJob } from '@/modules/ticketing/jobs/qcontactSync';

describe('POST /api/ticketing/cron/sync-qcontact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear environment variables
    delete process.env.CRON_SECRET;
  });

  it('should execute sync job successfully', async () => {
    // 🟢 WORKING: Test successful job execution
    const mockJobResult = {
      job_id: 'job-123',
      started_at: new Date('2024-01-15T10:00:00Z'),
      completed_at: new Date('2024-01-15T10:05:00Z'),
      duration_seconds: 300,
      status: 'success' as const,
      sync_result: {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        inbound_stats: {
          total_processed: 50,
          successful: 45,
          failed: 5,
          partial: 0,
          skipped: 0,
          created: 40,
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
        total_success: 65,
        total_failed: 5,
        success_rate: 0.93,
        errors: [],
      },
    };

    vi.mocked(runSyncJob).mockResolvedValue(mockJobResult);

    const request = new NextRequest('http://localhost:3000/api/ticketing/cron/sync-qcontact', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.job_id).toBe('job-123');
    expect(data.data.status).toBe('success');
    expect(data.data.summary).toBeDefined();
    expect(data.data.summary.total_success).toBe(65);
    expect(data.data.summary.total_failed).toBe(5);
  });

  it('should verify cron secret when configured', async () => {
    // 🟢 WORKING: Test authorization verification
    process.env.CRON_SECRET = 'test-secret-123';

    const request = new NextRequest('http://localhost:3000/api/ticketing/cron/sync-qcontact', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-secret-123',
      },
    });

    const mockJobResult = {
      job_id: 'job-456',
      started_at: new Date(),
      completed_at: new Date(),
      duration_seconds: 100,
      status: 'success' as const,
      sync_result: {
        started_at: new Date(),
        completed_at: new Date(),
        duration_seconds: 100,
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
      },
    };

    vi.mocked(runSyncJob).mockResolvedValue(mockJobResult);

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(runSyncJob).toHaveBeenCalledTimes(1);
  });

  it('should reject invalid cron secret', async () => {
    // 🟢 WORKING: Test unauthorized access
    process.env.CRON_SECRET = 'correct-secret';

    const request = new NextRequest('http://localhost:3000/api/ticketing/cron/sync-qcontact', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wrong-secret',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('UNAUTHORIZED');
    expect(runSyncJob).not.toHaveBeenCalled();
  });

  it('should reject request without authorization header when secret configured', async () => {
    // 🟢 WORKING: Test missing authorization
    process.env.CRON_SECRET = 'test-secret';

    const request = new NextRequest('http://localhost:3000/api/ticketing/cron/sync-qcontact', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(runSyncJob).not.toHaveBeenCalled();
  });

  it('should handle job execution errors', async () => {
    // 🟢 WORKING: Test error handling
    vi.mocked(runSyncJob).mockRejectedValue(new Error('Database connection failed'));

    const request = new NextRequest('http://localhost:3000/api/ticketing/cron/sync-qcontact', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('CRON_JOB_ERROR');
    expect(data.error.details).toContain('Database connection failed');
  });

  it('should handle partial job success', async () => {
    // 🟢 WORKING: Test partial success response
    const mockJobResult = {
      job_id: 'job-789',
      started_at: new Date('2024-01-15T10:00:00Z'),
      completed_at: new Date('2024-01-15T10:05:00Z'),
      duration_seconds: 300,
      status: 'partial' as const,
      sync_result: {
        started_at: new Date('2024-01-15T10:00:00Z'),
        completed_at: new Date('2024-01-15T10:05:00Z'),
        duration_seconds: 300,
        inbound_stats: {
          total_processed: 30,
          successful: 20,
          failed: 10,
          partial: 0,
          skipped: 0,
          created: 20,
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
        total_success: 20,
        total_failed: 10,
        success_rate: 0.67,
        errors: [],
      },
    };

    vi.mocked(runSyncJob).mockResolvedValue(mockJobResult);

    const request = new NextRequest('http://localhost:3000/api/ticketing/cron/sync-qcontact', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.status).toBe('partial');
    expect(data.message).toContain('some failures');
  });

  it('should handle failed job status', async () => {
    // 🟢 WORKING: Test failed job response
    const mockJobResult = {
      job_id: 'job-fail',
      started_at: new Date('2024-01-15T10:00:00Z'),
      completed_at: new Date('2024-01-15T10:01:00Z'),
      duration_seconds: 60,
      status: 'failed' as const,
      sync_result: null,
      error_message: 'QContact API unavailable',
      error_code: 'SYNC_JOB_ERROR',
    };

    vi.mocked(runSyncJob).mockResolvedValue(mockJobResult);

    const request = new NextRequest('http://localhost:3000/api/ticketing/cron/sync-qcontact', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.status).toBe('failed');
    expect(data.data.error_message).toBe('QContact API unavailable');
    expect(data.message).toContain('failed');
  });

  it('should include execution timing in response', async () => {
    // 🟢 WORKING: Test timing metadata
    const mockJobResult = {
      job_id: 'job-timing',
      started_at: new Date(),
      completed_at: new Date(),
      duration_seconds: 150,
      status: 'success' as const,
      sync_result: {
        started_at: new Date(),
        completed_at: new Date(),
        duration_seconds: 150,
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
      },
    };

    vi.mocked(runSyncJob).mockResolvedValue(mockJobResult);

    const request = new NextRequest('http://localhost:3000/api/ticketing/cron/sync-qcontact', {
      method: 'POST',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.meta).toHaveProperty('execution_time_ms');
    expect(data.meta.execution_time_ms).toBeGreaterThanOrEqual(0);
    expect(data.meta).toHaveProperty('timestamp');
  });
});

describe('GET /api/ticketing/cron/sync-qcontact', () => {
  it('should reject GET requests', async () => {
    // 🟢 WORKING: Test method not allowed
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(405);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('METHOD_NOT_ALLOWED');
    expect(data.error.message).toContain('POST');
  });
});
