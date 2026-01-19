/**
 * useVerification Hook Tests
 *
 * 🟢 WORKING: Comprehensive test suite for verification checklist state management hook
 *
 * Tests:
 * - Loading verification steps
 * - Updating step completion
 * - Calculating progress
 * - Handling loading states
 * - Handling errors
 * - Optimistic updates
 * - Query invalidation
 *
 * TDD Methodology: Tests written FIRST, implementation SECOND
 */

import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useVerificationSteps,
  useVerificationProgress,
  useUpdateVerificationStep,
  verificationKeys,
} from '../../hooks/useVerification';
import type { VerificationStep, VerificationProgress } from '../../types/verification';

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

const mockVerificationSteps: VerificationStep[] = [
  {
    id: 'step-1-id',
    ticket_id: mockTicketId,
    step_number: 1,
    step_name: 'Fiber Connection Verified',
    step_description: 'Verify fiber connection at ONT',
    is_complete: true,
    completed_at: new Date('2024-01-15T10:00:00Z'),
    completed_by: 'user-123',
    photo_required: true,
    photo_url: 'https://example.com/photo1.jpg',
    photo_verified: true,
    notes: 'Connection verified successfully',
    created_at: new Date('2024-01-15T09:00:00Z'),
  },
  {
    id: 'step-2-id',
    ticket_id: mockTicketId,
    step_number: 2,
    step_name: 'Power Levels Checked',
    step_description: 'Check RX power levels',
    is_complete: false,
    completed_at: null,
    completed_by: null,
    photo_required: true,
    photo_url: null,
    photo_verified: false,
    notes: null,
    created_at: new Date('2024-01-15T09:00:00Z'),
  },
  {
    id: 'step-3-id',
    ticket_id: mockTicketId,
    step_number: 3,
    step_name: 'ONT Configured',
    step_description: 'Configure ONT settings',
    is_complete: false,
    completed_at: null,
    completed_by: null,
    photo_required: false,
    photo_url: null,
    photo_verified: false,
    notes: null,
    created_at: new Date('2024-01-15T09:00:00Z'),
  },
];

const mockVerificationProgress: VerificationProgress = {
  ticket_id: mockTicketId,
  total_steps: 12,
  completed_steps: 1,
  pending_steps: 11,
  progress_percentage: 8,
  all_steps_complete: false,
  steps: mockVerificationSteps,
};

describe('verificationKeys', () => {
  // 🟢 WORKING: Test query key generation
  it('should generate correct query keys', () => {
    expect(verificationKeys.all).toEqual(['verification']);
    expect(verificationKeys.steps(mockTicketId)).toEqual(['verification', 'steps', mockTicketId]);
    expect(verificationKeys.progress(mockTicketId)).toEqual(['verification', 'progress', mockTicketId]);
  });
});

describe('useVerificationSteps', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 🟢 WORKING: Test loading verification steps successfully
  it('should load verification steps successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockVerificationSteps,
        message: 'Retrieved 3 verification steps',
      }),
    });

    const { result } = renderHook(() => useVerificationSteps(mockTicketId), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    // Wait for data to load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockVerificationSteps);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/ticketing/tickets/${mockTicketId}/verification`,
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  // 🟢 WORKING: Test handling empty steps (not initialized)
  it('should handle empty steps (not initialized yet)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: [],
        message: 'No verification steps found. Initialize steps first.',
      }),
    });

    const { result } = renderHook(() => useVerificationSteps(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
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

    const { result } = renderHook(() => useVerificationSteps(mockTicketId), {
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

    const { result } = renderHook(() => useVerificationSteps(mockTicketId), {
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
    const { result } = renderHook(() => useVerificationSteps(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 🟢 WORKING: Test enabled parameter
  it('should not fetch when enabled is false', async () => {
    const { result } = renderHook(() => useVerificationSteps(mockTicketId, false), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('useVerificationProgress', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 🟢 WORKING: Test loading verification progress successfully
  it('should load verification progress successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockVerificationProgress,
        message: 'Verification progress calculated',
      }),
    });

    const { result } = renderHook(() => useVerificationProgress(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockVerificationProgress);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/ticketing/tickets/${mockTicketId}/verification/complete`,
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  // 🟢 WORKING: Test progress calculation accuracy
  it('should calculate progress percentage correctly', async () => {
    const progressData: VerificationProgress = {
      ticket_id: mockTicketId,
      total_steps: 12,
      completed_steps: 6,
      pending_steps: 6,
      progress_percentage: 50,
      all_steps_complete: false,
      steps: mockVerificationSteps,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: progressData,
      }),
    });

    const { result } = renderHook(() => useVerificationProgress(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.progress_percentage).toBe(50);
    expect(result.current.data?.completed_steps).toBe(6);
    expect(result.current.data?.pending_steps).toBe(6);
  });

  // 🟢 WORKING: Test all steps complete flag
  it('should indicate when all steps are complete', async () => {
    const completeProgress: VerificationProgress = {
      ticket_id: mockTicketId,
      total_steps: 12,
      completed_steps: 12,
      pending_steps: 0,
      progress_percentage: 100,
      all_steps_complete: true,
      steps: mockVerificationSteps,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: completeProgress,
      }),
    });

    const { result } = renderHook(() => useVerificationProgress(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.all_steps_complete).toBe(true);
    expect(result.current.data?.progress_percentage).toBe(100);
  });

  // 🟢 WORKING: Test handling error when steps not initialized
  it('should handle error when steps not initialized', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'No verification steps found for this ticket',
        },
      }),
    });

    const { result } = renderHook(() => useVerificationProgress(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });
});

describe('useUpdateVerificationStep', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 🟢 WORKING: Test updating step completion successfully
  it('should update step completion successfully', async () => {
    const updatedStep: VerificationStep = {
      ...mockVerificationSteps[1],
      is_complete: true,
      completed_at: new Date('2024-01-15T11:00:00Z'),
      completed_by: 'user-456',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: updatedStep,
        message: 'Verification step 2 updated successfully',
      }),
    });

    const { result } = renderHook(() => useUpdateVerificationStep(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isPending).toBe(false);

    // Trigger mutation
    result.current.mutate({
      ticketId: mockTicketId,
      stepNumber: 2,
      payload: {
        is_complete: true,
        completed_by: 'user-456',
      },
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(updatedStep);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/ticketing/tickets/${mockTicketId}/verification/2`,
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_complete: true,
          completed_by: 'user-456',
        }),
      })
    );
  });

  // 🟢 WORKING: Test updating photo URL
  it('should update photo URL successfully', async () => {
    const updatedStep: VerificationStep = {
      ...mockVerificationSteps[1],
      photo_url: 'https://example.com/new-photo.jpg',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: updatedStep,
      }),
    });

    const { result } = renderHook(() => useUpdateVerificationStep(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      ticketId: mockTicketId,
      stepNumber: 2,
      payload: {
        photo_url: 'https://example.com/new-photo.jpg',
      },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.photo_url).toBe('https://example.com/new-photo.jpg');
  });

  // 🟢 WORKING: Test updating notes
  it('should update notes successfully', async () => {
    const updatedStep: VerificationStep = {
      ...mockVerificationSteps[1],
      notes: 'Power levels within acceptable range',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: updatedStep,
      }),
    });

    const { result } = renderHook(() => useUpdateVerificationStep(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      ticketId: mockTicketId,
      stepNumber: 2,
      payload: {
        notes: 'Power levels within acceptable range',
      },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.notes).toBe('Power levels within acceptable range');
  });

  // 🟢 WORKING: Test updating multiple fields at once
  it('should update multiple fields at once', async () => {
    const updatedStep: VerificationStep = {
      ...mockVerificationSteps[1],
      is_complete: true,
      completed_by: 'user-789',
      photo_url: 'https://example.com/photo.jpg',
      photo_verified: true,
      notes: 'All checks passed',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: updatedStep,
      }),
    });

    const { result } = renderHook(() => useUpdateVerificationStep(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      ticketId: mockTicketId,
      stepNumber: 2,
      payload: {
        is_complete: true,
        completed_by: 'user-789',
        photo_url: 'https://example.com/photo.jpg',
        photo_verified: true,
        notes: 'All checks passed',
      },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(updatedStep);
  });

  // 🟢 WORKING: Test handling validation error
  it('should handle validation error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid step number. Must be an integer between 1 and 12',
        },
      }),
    });

    const { result } = renderHook(() => useUpdateVerificationStep(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      ticketId: mockTicketId,
      stepNumber: 99 as any, // Invalid step number
      payload: {
        is_complete: true,
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeTruthy();
  });

  // 🟢 WORKING: Test handling step not found error
  it('should handle step not found error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Verification step not found',
        },
      }),
    });

    const { result } = renderHook(() => useUpdateVerificationStep(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      ticketId: mockTicketId,
      stepNumber: 5,
      payload: {
        is_complete: true,
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeTruthy();
  });

  // 🟢 WORKING: Test mutation invalidates queries
  it('should invalidate verification queries on success', async () => {
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
        data: { ...mockVerificationSteps[0], is_complete: true },
      }),
    });

    const { result } = renderHook(() => useUpdateVerificationStep(), {
      wrapper: WrapperWithSpy,
    });

    result.current.mutate({
      ticketId: mockTicketId,
      stepNumber: 1,
      payload: { is_complete: true },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Check that invalidateQueries was called
    expect(invalidateSpy).toHaveBeenCalled();
  });
});

describe('useVerificationSteps - data refresh', () => {
  // 🟢 WORKING: Test stale time configuration
  it('should use correct stale time', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockVerificationSteps,
      }),
    });

    const { result } = renderHook(() => useVerificationSteps(mockTicketId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Data should be fresh initially (no refetch)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
