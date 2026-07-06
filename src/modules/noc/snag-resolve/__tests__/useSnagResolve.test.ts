import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSnagResolve } from '../useSnagResolve';
import { OfflineQueueStore, QueueFullError, QuotaExceededError } from '@/lib/offline-queue';
import { TicketStatus } from '@/modules/noc/types/ticket';
import type { SharedData } from '../types';
import { persistActor } from '../session';

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

/** Stub the browser image primitives jsdom lacks so the real downscaleImage in
 *  the photo-upload path produces a small blob. */
function installCanvasStubs(): void {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 80, close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback
  ) {
    cb(new Blob([new Uint8Array(2000)], { type: 'image/jpeg' }));
  });
}

describe('useSnagResolve — photo upload branch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnline = true;
    (globalThis as { __t?: number }).__t = ((globalThis as { __t?: number }).__t ?? 0) + 1;
    fetchMock = vi.fn(async () => jsonResponse({ data: mockSharedData }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function seedActorAndRender(token: string) {
    persistActor(token, { id: 'actor-1', name: 'Tech', phone: '0700000000', company: null });
    return renderHook(() => useSnagResolve(token));
  }

  function multipartPosted(mock: ReturnType<typeof vi.fn>): boolean {
    return mock.mock.calls.some(([, init]: [unknown, RequestInit | undefined]) =>
      init?.body instanceof FormData
    );
  }

  const photoFile = () => new File([new Uint8Array(4000)], 'p.jpg', { type: 'image/jpeg' });

  it('online: POSTs the photo and does not queue', async () => {
    const token = `tok-photo-online-${(globalThis as { __t?: number }).__t}`;
    const { result } = seedActorAndRender(token);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.actor).not.toBeNull();
    });

    await act(async () => { await result.current.handlePhotoUpload('step-1', photoFile(), 'front'); });

    expect(multipartPosted(fetchMock)).toBe(true);
    expect(result.current.pendingPhotoCount).toBe(0);
    expect(result.current.photoNotSaved).toBeNull();
  });

  it('offline: queues the photo (pendingPhotoCount increments), no error, no POST', async () => {
    mockOnline = false;
    installCanvasStubs();
    const token = `tok-photo-offline-${(globalThis as { __t?: number }).__t}`;
    const { result } = seedActorAndRender(token);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.actor).not.toBeNull();
    });

    await act(async () => { await result.current.handlePhotoUpload('step-1', photoFile(), 'front'); });

    await waitFor(() => expect(result.current.pendingPhotoCount).toBe(1));
    expect(result.current.error).toBeNull();
    expect(result.current.photoNotSaved).toBeNull();
    expect(multipartPosted(fetchMock)).toBe(false); // no upload while offline
  });

  it('offline + byte budget exceeded: surfaces photoNotSaved, never queues a green tile', async () => {
    mockOnline = false;
    installCanvasStubs();
    vi.spyOn(OfflineQueueStore.prototype, 'enqueue').mockRejectedValue(
      new QuotaExceededError(40_000_000, 300_000, 40_000_000, 'queue')
    );
    const token = `tok-photo-quota-${(globalThis as { __t?: number }).__t}`;
    const { result } = seedActorAndRender(token);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.actor).not.toBeNull();
    });

    await act(async () => { await result.current.handlePhotoUpload('step-1', photoFile(), 'front'); });

    await waitFor(() => expect(result.current.photoNotSaved).toBeTruthy());
    expect(result.current.photoNotSaved).toMatch(/not saved/i);
    expect(result.current.pendingPhotoCount).toBe(0);
  });

  it('no actor: opens the identity modal instead of uploading', async () => {
    const token = `tok-photo-noactor-${(globalThis as { __t?: number }).__t}`;
    const { result } = renderHook(() => useSnagResolve(token));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.handlePhotoUpload('step-1', photoFile(), 'front'); });

    expect(result.current.showIdentityModal).toBe(true);
    expect(multipartPosted(fetchMock)).toBe(false);
  });
});
