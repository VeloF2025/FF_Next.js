import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSnagResolve } from '../useSnagResolve';
import { OfflineQueueStore, QueueFullError } from '@/lib/offline-queue';
import { TicketStatus } from '@/modules/noc/types/ticket';
import type { SharedData } from '../types';

// Mutable flag so individual tests can flip online/offline deterministically
// (mirrors the pattern in src/lib/offline-queue/__tests__/useOfflineQueue.test.ts).
let mockOnline = true;
vi.mock('@/lib/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));

const mockSharedData: SharedData = {
  ticket: {
    id: 't1',
    ticket_uid: 'TCK-1',
    status: TicketStatus.ASSIGNED,
    title: 'Test ticket',
    description: 'A snag to resolve',
    priority: 'medium',
    assigned_to_name: null,
    project_name: null,
  },
  canInteract: true,
  canStartWork: true,
  canSubmit: false,
  steps: [],
  beforePhotos: [],
  attachments: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function postedCompleteStep(fetchMock: ReturnType<typeof vi.fn>): boolean {
  return fetchMock.mock.calls.some(([, init]: [unknown, RequestInit | undefined]) => {
    const body = init?.body;
    return typeof body === 'string' && body.includes('"action":"complete_step"');
  });
}

describe('useSnagResolve — offline/online mark-complete branch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnline = true;
    // Unique token per test => unique IndexedDB name (SnagCompleteDB:<token>)
    // so queue state from one test can't bleed into the next.
    (globalThis as { __t?: number }).__t = ((globalThis as { __t?: number }).__t ?? 0) + 1;
    fetchMock = vi.fn(async () => jsonResponse({ data: mockSharedData }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('offline: enqueues the step and does not POST complete_step', async () => {
    mockOnline = false;
    const token = `tok-offline-${(globalThis as { __t?: number }).__t}`;
    const { result } = renderHook(() => useSnagResolve(token));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleMarkComplete('step-1');
    });

    await waitFor(() => expect(result.current.pendingCompleteCount).toBe(1));
    expect(postedCompleteStep(fetchMock)).toBe(false);
  });

  it('online: calls performAction (POSTs complete_step) and does not enqueue', async () => {
    const token = `tok-online-${(globalThis as { __t?: number }).__t}`;
    const { result } = renderHook(() => useSnagResolve(token));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleMarkComplete('step-1');
    });

    await waitFor(() => expect(postedCompleteStep(fetchMock)).toBe(true));
    expect(result.current.pendingCompleteCount).toBe(0);
  });

  it('offline + enqueue rejection: surfaces an error message', async () => {
    mockOnline = false;
    vi.spyOn(OfflineQueueStore.prototype, 'enqueue').mockRejectedValue(new QueueFullError(50));

    const token = `tok-full-${(globalThis as { __t?: number }).__t}`;
    const { result } = renderHook(() => useSnagResolve(token));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleMarkComplete('step-1');
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toContain('Offline queue is full');
  });
});
