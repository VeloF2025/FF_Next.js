/**
 * useQAReadiness Hook Tests
 *
 * 🟢 WORKING: Comprehensive test suite for QA readiness state management hook
 *
 * Tests:
 * - Triggering readiness checks
 * - Getting readiness status
 * - Displaying failed checks
 * - Handling check in progress
 * - Handling loading states
 * - Handling errors
 * - Query invalidation
 *
 * TDD Methodology: Tests written FIRST, implementation SECOND
 */

import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useQAReadinessStatus,
  useQAReadiness,
  useRunQAReadinessCheck,
  qaReadinessKeys,
} from '../../hooks/useQAReadiness';
import type { QAReadinessCheck, QAReadinessStatus } from '../../types/verification';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock logger to prevent console output during tests
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Test utilities
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// Mock data
const mockTicketId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const mockCheckerId = 'user-123-456-789';

const mockPassedCheck: QAReadinessCheck = {
  id: 'check-passed-id',
  ticket_id: mockTicketId,
  passed: true,
  checked_at: new Date('2024-01-15T10:00:00Z'),
  checked_by: mockCheckerId,
  photos_exist: true,
  photos_count: 12,
  photos_required_count: 11,
  dr_populated: true,
  pole_populated: true,
  pon_populated: true,
  zone_populated: true,
  ont_serial_recorded: true,
  ont_rx_recorded: true,
  platforms_aligned: true,
  failed_checks: [],
  created_at: new Date('2024-01-15T10:00:00Z'),
};

const mockFailedCheck: QAReadinessCheck = {
  id: 'check-failed-id',
  ticket_id: mockTicketId,
  passed: false,
  checked_at: new Date('2024-01-15T10:00:00Z'),
  checked_by: mockCheckerId,
  photos_exist: false,
  photos_count: 2,
  photos_required_count: 11,
  dr_populated: true,
  pole_populated: false,
  pon_populated: false,
  zone_populated: true,
  ont_serial_recorded: false,
  ont_rx_recorded: false,
  platforms_aligned: true,
  failed_checks: [
    { check: 'photos_exist', reason: 'Only 2/11 required photos uploaded' },
    { check: 'pole_populated', reason: 'Pole number not recorded' },
    { check: 'pon_populated', reason: 'PON number not recorded' },
    { check: 'ont_serial_recorded', reason: 'ONT serial number missing' },
    { check: 'ont_rx_recorded', reason: 'ONT RX power level not recorded' },
  ],
  created_at: new Date('2024-01-15T10:00:00Z'),
};

const mockReadyStatus: QAReadinessStatus = {
  ticket_id: mockTicketId,
  is_ready: true,
  last_check: mockPassedCheck,
  last_check_at: mockPassedCheck.checked_at,
  failed_reasons: null,
  next_action: 'Ticket is ready for QA',
};

const mockNotReadyStatus: QAReadinessStatus = {
  ticket_id: mockTicketId,
  is_ready: false,
  last_check: mockFailedCheck,
  last_check_at: mockFailedCheck.checked_at,
  failed_reasons: [
    'Only 2/11 required photos uploaded',
    'Pole number not recorded',
    'PON number not recorded',
    'ONT serial number missing',
    'ONT RX power level not recorded',
  ],
  next_action: 'Fix failed checks before QA',
};

const mockNoCheckStatus: QAReadinessStatus = {
  ticket_id: mockTicketId,
  is_ready: false,
  last_check: null,
  last_check_at: null,
  failed_reasons: null,
  next_action: 'Run readiness check first',
};

describe('qaReadinessKeys', () => {
  // 🟢 WORKING: Test query key generation
  it('should generate correct query keys', () => {
    expect(qaReadinessKeys.all).toEqual(['qa-readiness']);
    expect(qaReadinessKeys.status(mockTicketId)).toEqual(['qa-readiness', 'status', mockTicketId]);
  });
});

describe('useQAReadinessStatus', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 🟢 WORKING: Test loading readiness status when ready
  it('should load QA ready status successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockReadyStatus,
        message: 'QA readiness status retrieved',
      }),
    });

    const { result } = renderHook(() => useQAReadinessStatus(mockTicketId), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    // Wait for data to load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockReadyStatus);
    expect(result.current.data?.is_ready).toBe(true);
    expect(result.current.data?.failed_reasons).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/ticketing/tickets/${mockTicketId}/qa-readiness`,
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  // 🟢 WORKING: Test loading readiness status when not ready
  it('should load QA not ready status with failed checks', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockNotReadyStatus,
        message: 'QA readiness status retrieved',
      }),
    });

    const { result } = renderHook(() => useQAReadinessStatus(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockNotReadyStatus);
    expect(result.current.data?.is_ready).toBe(false);
    expect(result.current.data?.failed_reasons).toHaveLength(5);
    expect(result.current.data?.next_action).toBe('Fix failed checks before QA');
  });

  // 🟢 WORKING: Test loading status when no check has been run
  it('should handle status when no check has been run', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockNoCheckStatus,
        message: 'QA readiness status retrieved',
      }),
    });

    const { result } = renderHook(() => useQAReadinessStatus(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.is_ready).toBe(false);
    expect(result.current.data?.last_check).toBeNull();
    expect(result.current.data?.next_action).toBe('Run readiness check first');
  });

  // 🟢 WORKING: Test handling 404 error (ticket not found)
  it('should handle 404 error when ticket not found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Ticket with ID '${mockTicketId}' not found`,
        },
      }),
    });

    const { result } = renderHook(() => useQAReadinessStatus(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeTruthy();
  });

  // 🟢 WORKING: Test handling network error
  it('should handle network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useQAReadinessStatus(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeTruthy();
  });

  // 🟢 WORKING: Test disabled query when ticketId is empty
  it('should not fetch when ticketId is empty', async () => {
    const { result } = renderHook(() => useQAReadinessStatus(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 🟢 WORKING: Test enabled parameter
  it('should not fetch when enabled is false', async () => {
    const { result } = renderHook(() => useQAReadinessStatus(mockTicketId, false), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('useQAReadiness (combined hook)', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 🟢 WORKING: Test combined hook provides all convenience properties
  it('should provide status and check mutation together', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockReadyStatus,
      }),
    });

    const { result } = renderHook(() => useQAReadiness(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Check convenience properties
    expect(result.current.status).toEqual(mockReadyStatus);
    expect(result.current.isReady).toBe(true);
    expect(result.current.failedReasons).toBeNull();
    expect(result.current.nextAction).toBe('Ticket is ready for QA');
    expect(result.current.runCheck).toBeDefined();
    expect(result.current.refetch).toBeDefined();
  });

  // 🟢 WORKING: Test combined hook with not ready status
  it('should provide failed reasons when not ready', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockNotReadyStatus,
      }),
    });

    const { result } = renderHook(() => useQAReadiness(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.failedReasons).toHaveLength(5);
    expect(result.current.nextAction).toBe('Fix failed checks before QA');
  });
});

describe('useRunQAReadinessCheck', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 🟢 WORKING: Test triggering readiness check successfully (passed)
  it('should trigger readiness check and pass', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockPassedCheck,
        message: 'QA readiness check completed. Ticket is ready for QA.',
      }),
    });

    const { result } = renderHook(() => useRunQAReadinessCheck(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isPending).toBe(false);

    // Trigger mutation
    result.current.mutate({
      ticketId: mockTicketId,
      checkedBy: mockCheckerId,
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockPassedCheck);
    expect(result.current.data?.passed).toBe(true);
    expect(result.current.data?.failed_checks).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/ticketing/tickets/${mockTicketId}/qa-readiness-check`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ checked_by: mockCheckerId }),
      })
    );
  });

  // 🟢 WORKING: Test triggering readiness check and failing
  it('should trigger readiness check and fail with reasons', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockFailedCheck,
        message: 'QA readiness check completed. Ticket is not ready for QA.',
      }),
    });

    const { result } = renderHook(() => useRunQAReadinessCheck(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      ticketId: mockTicketId,
      checkedBy: mockCheckerId,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.passed).toBe(false);
    expect(result.current.data?.failed_checks).toHaveLength(5);
    expect(result.current.data?.failed_checks?.[0]).toMatchObject({
      check: 'photos_exist',
      reason: 'Only 2/11 required photos uploaded',
    });
  });

  // 🟢 WORKING: Test system check (without checked_by)
  it('should trigger system check without checked_by parameter', async () => {
    const systemCheck = { ...mockPassedCheck, checked_by: null };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: systemCheck,
        message: 'QA readiness check completed',
      }),
    });

    const { result } = renderHook(() => useRunQAReadinessCheck(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      ticketId: mockTicketId,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.checked_by).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/ticketing/tickets/${mockTicketId}/qa-readiness-check`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
  });

  // 🟢 WORKING: Test handling check in progress (pending state)
  it('should handle check in progress state', async () => {
    // Delay the response to test pending state
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                data: mockPassedCheck,
              }),
            });
          }, 100);
        })
    );

    const { result } = renderHook(() => useRunQAReadinessCheck(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      ticketId: mockTicketId,
      checkedBy: mockCheckerId,
    });

    // Should be pending immediately after mutation
    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });

    // Eventually should complete
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  // 🟢 WORKING: Test handling validation error
  it('should handle validation error (invalid UUID)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid ticket ID format',
        },
      }),
    });

    const { result } = renderHook(() => useRunQAReadinessCheck(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      ticketId: 'invalid-id',
      checkedBy: mockCheckerId,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeTruthy();
  });

  // 🟢 WORKING: Test handling ticket not found error
  it('should handle ticket not found error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Ticket not found',
        },
      }),
    });

    const { result } = renderHook(() => useRunQAReadinessCheck(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      ticketId: mockTicketId,
      checkedBy: mockCheckerId,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeTruthy();
  });

  // 🟢 WORKING: Test mutation invalidates readiness status query
  it('should invalidate readiness status query on success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function WrapperWithSpy({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockPassedCheck,
      }),
    });

    const { result } = renderHook(() => useRunQAReadinessCheck(), {
      wrapper: WrapperWithSpy,
    });

    result.current.mutate({
      ticketId: mockTicketId,
      checkedBy: mockCheckerId,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Check that invalidateQueries was called
    expect(invalidateSpy).toHaveBeenCalled();
  });
});

describe('useQAReadinessStatus - failed checks display', () => {
  // 🟢 WORKING: Test displaying failed checks in detail
  it('should display failed checks with detailed reasons', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockNotReadyStatus,
      }),
    });

    const { result } = renderHook(() => useQAReadinessStatus(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const failedReasons = result.current.data?.failed_reasons;
    expect(failedReasons).toBeTruthy();
    expect(failedReasons).toHaveLength(5);
    expect(failedReasons).toContain('Only 2/11 required photos uploaded');
    expect(failedReasons).toContain('Pole number not recorded');
    expect(failedReasons).toContain('PON number not recorded');
    expect(failedReasons).toContain('ONT serial number missing');
    expect(failedReasons).toContain('ONT RX power level not recorded');
  });

  // 🟢 WORKING: Test next action guidance
  it('should provide next action guidance based on status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockNotReadyStatus,
      }),
    });

    const { result } = renderHook(() => useQAReadinessStatus(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.next_action).toBe('Fix failed checks before QA');
  });
});
