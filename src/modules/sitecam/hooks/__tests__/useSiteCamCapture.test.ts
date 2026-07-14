/**
 * Tests for the useSiteCamCapture state machine — attempt counting,
 * escalation after maxAttempts, and the fail-open paths.
 *
 * FileReader is stubbed so readFileAsBase64 resolves deterministically
 * without depending on jsdom's async file plumbing.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// jsdom can't decode images, so the canvas watermark path would hang — stub
// it to behave like its own fallback (clean + watermarked both the raw base64,
// plus a small real Blob for the durability-store write Task 5 adds).
vi.mock('../../lib/watermarkPhoto', () => ({
  prepareCapturePhotos: vi.fn(async () => ({
    clean: 'RkFLRQ==',
    watermarked: 'RkFLRQ==',
    watermarkedBlob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
  })),
}));

import { useSiteCamCapture, type SiteInfo, type StepState } from '../useSiteCamCapture';
import type { SiteCamStep } from '../../lib/sitecamSteps';
import { buildReading } from '../../lib/geofence';
import { saveDraft } from '../../lib/sitecamDraft';
import { SiteCamPhotoStore } from '../../offline/photoStore';
import { QuotaExceededError } from '@/lib/offline-queue';

const TWO_STEPS: readonly SiteCamStep[] = [
  { number: 1, label: 'A', hasVlm: true },
  { number: 2, label: 'B', hasVlm: true },
];

function stepFixture(num: number, over: Partial<StepState> = {}): StepState {
  return {
    stepNumber: num, label: `Step ${num}`, hasVlm: true, hasSerialScan: false,
    serials: [], serialIndex: 0,
    serialLabel: '', serialDevice: null, serialAttempts: 0, serialScanned: null,
    status: 'pending', photoBase64: null, attemptNumber: 0, failReasons: [],
    corrections: [], needsManualReview: false, ...over,
  };
}

class MockFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: unknown = null;
  readAsDataURL(_file: Blob): void {
    this.result = 'data:image/jpeg;base64,RkFLRQ==';
    queueMicrotask(() => this.onload?.());
  }
}

const STEPS: readonly SiteCamStep[] = [{ number: 1, label: 'Before Photo', hasVlm: true }];
const STAFF_ID = 'staff-1';
const SITE_INFO: SiteInfo = {
  jobType: 'civils',
  siteId: 'POLE-1',
  customerName: null,
  address: null,
  projectName: null,
  plannedLat: null,
  plannedLon: null,
  pon: null,
  zone: null,
};

function file(): File {
  return new File(['x'], 'p.jpg', { type: 'image/jpeg' });
}

/**
 * Flush chained zero-delay `setTimeout` hops (fake-indexeddb's scheduling)
 * WITHOUT touching a real timer — unlike `vi.runAllTimersAsync()`, which
 * would spin forever once `useSiteCamFlush`'s 60s poll `setInterval` is
 * registered (a queued job + online + no error), since that interval never
 * naturally drains. A handful of small (10ms) advances fully drains the
 * chain while staying nowhere near the 60s interval — `advanceTimersByTimeAsync(0)`
 * does NOT reliably re-check for timers newly scheduled mid-drain in this
 * fake-timer implementation, so a small positive step is used instead. Safe
 * to use unconditionally (even once a poll interval exists), unlike
 * `runAllTimersAsync()`.
 */
async function flushZeroDelayChain(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
}

/**
 * Start a capture, then drain fake-indexeddb's zero-delay `setTimeout`
 * scheduling (the durability write Task 5 added to `captureAndValidate`)
 * before awaiting the settled result. `vi.useFakeTimers()` is active for
 * every test in this file (to skip the 1500ms auto-advance delay) — without
 * this explicit drain, the IDB transaction's `oncomplete` callback (which
 * fake-indexeddb schedules via a REAL `setTimeout(fn, 0)`, see
 * node_modules/fake-indexeddb/build/cjs/lib/scheduling.js) never fires,
 * deadlocking a plain `await result.current.captureAndValidate(...)`. No
 * poll interval is active yet at capture time in any of these tests, so
 * `flushZeroDelayChain` (not `runAllTimersAsync`) is used defensively.
 */
async function capture(
  result: { current: { captureAndValidate: (f: File) => Promise<void> } },
  f: File = file(),
): Promise<void> {
  const pending = result.current.captureAndValidate(f);
  await flushZeroDelayChain();
  await pending;
}

/**
 * Await a promise that resolves via fake-indexeddb's zero-delay `setTimeout`
 * chain (any direct `SiteCamPhotoStore` read/write done in test assertions,
 * outside the hook) — same fake-timer drain `capture()` needs, for the same
 * reason. May run after a poll interval already exists, so uses the
 * interval-safe drain rather than `runAllTimersAsync()`.
 */
async function drain<T>(promise: Promise<T>): Promise<T> {
  const pending = promise;
  await flushZeroDelayChain();
  return pending;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // The hook now persists progress to localStorage keyed by siteId; clear it so
  // a draft from one test never restores into the next (they share 'POLE-1').
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // Task 5's QuotaExceededError test spies on SiteCamPhotoStore.prototype —
  // without restoring, that mock would poison every subsequent test in this
  // file (spies persist across tests until explicitly restored).
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function jsonOk(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
}

describe('useSiteCamCapture', () => {
  it('marks a failing step "fail" while attempts remain, incrementing attemptNumber', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') {
        return jsonOk({ data: { pass: false, reasons: ['bad'], corrections: ['retry'], maxAttempts: 3 } });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, SITE_INFO));

    await act(async () => {
      await capture(result);
    });

    expect(result.current.stepStates[0].status).toBe('fail');
    expect(result.current.stepStates[0].attemptNumber).toBe(1);
    expect(result.current.stepStates[0].failReasons).toEqual(['bad']);
  });

  it('escalates after maxAttempts consecutive failures, sending the final photo', async () => {
    let escalateBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation((url: string, init?: { body?: string }) => {
      if (url === '/api/sitecam/validate') {
        return jsonOk({ data: { pass: false, reasons: ['bad'], corrections: [], maxAttempts: 3 } });
      }
      if (url === '/api/sitecam/escalate') {
        escalateBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
        return jsonOk({});
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, SITE_INFO));

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await capture(result);
      });
    }

    expect(result.current.stepStates[0].attemptNumber).toBe(3);
    expect(result.current.stepStates[0].status).toBe('escalated');
    expect(escalateBody).not.toBeNull();
    expect(escalateBody!.finalPhotoBase64).toBe('RkFLRQ==');
    expect(escalateBody!.finalAttemptNumber).toBe(3);
    expect(escalateBody!.failReasons).toEqual(['bad']);
  });

  it('fails open (auto-pass) on a non-OK validate response and flags for manual review', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, SITE_INFO));

    await act(async () => {
      await capture(result);
    });

    expect(result.current.stepStates[0].status).toBe('pass');
    expect(result.current.stepStates[0].needsManualReview).toBe(true);
  });

  it('flags a step for manual review when the server fails open (needsManualReview)', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') {
        return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3, needsManualReview: true } });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, SITE_INFO));
    await act(async () => {
      await capture(result);
    });

    expect(result.current.stepStates[0].status).toBe('pass');
    expect(result.current.stepStates[0].needsManualReview).toBe(true);
  });

  it('does not flag a genuine VLM pass for manual review', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') {
        return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, SITE_INFO));
    await act(async () => {
      await capture(result);
    });

    expect(result.current.stepStates[0].status).toBe('pass');
    expect(result.current.stepStates[0].needsManualReview).toBe(false);
  });

  it('auto-passes a non-VLM step without calling the validate API', async () => {
    const noVlmSteps: readonly SiteCamStep[] = [{ number: 3, label: 'Entry Outside', hasVlm: false }];
    const { result } = renderHook(() => useSiteCamCapture(noVlmSteps, STAFF_ID, SITE_INFO));

    await act(async () => {
      await capture(result);
    });

    expect(result.current.stepStates[0].status).toBe('pass');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useSiteCamCapture geofence payload', () => {
  it('includes the entry reading + submit-time stamp in the upload body', async () => {
    vi.stubGlobal('navigator', {
      // Explicit — submitAll (Task 6) is now offline-aware and reads
      // navigator.onLine directly; this test exercises the ONLINE path.
      onLine: true,
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: -26.2, longitude: 27.6, accuracy: 9 } } as GeolocationPosition),
      },
    });

    let uploadBody: Record<string, unknown> = {};
    fetchMock.mockImplementation((url: string, opts: { body: string }) => {
      if (url === '/api/sitecam/validate') {
        return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      }
      if (url === '/api/sitecam/upload') {
        uploadBody = JSON.parse(opts.body);
        return jsonOk({ data: { uploadedCount: 1 } });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const entryReading = buildReading({
      plannedLat: -26.1, plannedLon: 27.5, deviceLat: -26.101, deviceLon: 27.5, accuracyM: 5,
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, SITE_INFO, entryReading));
    await act(async () => { await capture(result); });
    await act(async () => { await vi.runAllTimersAsync(); });
    // submitAll also reads/clears the durable store (Task 6) — same
    // zero-delay-timer drain as `capture()` above.
    await act(async () => {
      const pending = result.current.submitAll();
      await vi.runAllTimersAsync();
      await pending;
    });

    expect(uploadBody.geofence).toMatchObject({
      status: 'out_of_range',
      deviceLat: -26.101,
      submitLat: -26.2,
      submitLon: 27.6,
    });
  });
});

describe('useSiteCamCapture draft persistence', () => {
  it('restores saved progress instead of starting at step 1', () => {
    saveDraft(
      SITE_INFO.jobType,
      SITE_INFO.siteId,
      [stepFixture(1, { status: 'pass', photoBase64: 'AAAA' }), stepFixture(2)],
      1,
      null,
    );

    const { result } = renderHook(() => useSiteCamCapture(TWO_STEPS, STAFF_ID, SITE_INFO));

    expect(result.current.currentStepIndex).toBe(1);
    expect(result.current.stepStates[0].status).toBe('pass');
    expect(result.current.stepStates[0].photoBase64).toBe('AAAA');
  });
});

describe('useSiteCamCapture appeal resolution', () => {
  it('marks the step passed and advances when the appeal is approved', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') {
        return jsonOk({ data: { pass: false, reasons: ['nope'], corrections: [], maxAttempts: 3 } });
      }
      if (url.startsWith('/api/my/sitecam/appeal-status/')) {
        return jsonOk({ data: { status: 'approved' } });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(TWO_STEPS, STAFF_ID, SITE_INFO));

    await act(async () => { await capture(result); });
    expect(result.current.stepStates[0].status).toBe('fail');

    await act(async () => { result.current.onAppealSubmitted(); });
    // The polling effect fires once immediately — flush its async fetch chain.
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(result.current.stepStates[0].status).toBe('pass');
    expect(result.current.currentStepIndex).toBe(1);
    expect(result.current.appealPending).toBe(false);
  });

  it('returns the step to failed with the supervisor reason when the appeal is denied', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') {
        return jsonOk({ data: { pass: false, reasons: ['nope'], corrections: [], maxAttempts: 3 } });
      }
      if (url.startsWith('/api/my/sitecam/appeal-status/')) {
        return jsonOk({ data: { status: 'denied', denialReason: 'Still wrong angle' } });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(TWO_STEPS, STAFF_ID, SITE_INFO));

    await act(async () => { await capture(result); });
    await act(async () => { result.current.onAppealSubmitted(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(result.current.stepStates[0].status).toBe('fail');
    expect(result.current.stepStates[0].failReasons).toEqual(['Still wrong angle']);
    expect(result.current.currentStepIndex).toBe(0);
  });
});

// =============================================================================
// Task 5 — durability (upsert on capture) + restore-on-mount
// =============================================================================

function onlineNavigator(over: Record<string, unknown> = {}) {
  return {
    onLine: true,
    geolocation: { getCurrentPosition: (_ok: PositionCallback, err?: PositionErrorCallback) => err?.({ code: 1 } as GeolocationPositionError) },
    ...over,
  };
}

describe('useSiteCamCapture durability (Task 5)', () => {
  it('persists the watermarked photo into the durable store on a successful capture', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-DUR-1' };
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });

    const store = new SiteCamPhotoStore(STAFF_ID, 'civils', siteInfo.siteId);
    const photos = await drain(store.listStepPhotos());
    expect(photos).toHaveLength(1);
    expect(photos[0].stepNumber).toBe(1);
    expect(photos[0].byteSize).toBeGreaterThan(0);
  });

  it('a QuotaExceededError from the store surfaces photoNotSaved and keeps the step un-captured (never green)', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-DUR-2' };
    vi.spyOn(SiteCamPhotoStore.prototype, 'putStepPhoto').mockRejectedValue(
      new QuotaExceededError(100, 50, 100, 'queue'),
    );
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });

    expect(result.current.photoNotSaved).toBe(true);
    expect(result.current.stepStates[0].status).toBe('pending');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears photoNotSaved on a subsequent successful capture (retry after freeing space)', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-DUR-2B' };
    // Rejects only the FIRST call — the retry falls through to the real
    // (successful) implementation, simulating the tech freeing up space.
    vi.spyOn(SiteCamPhotoStore.prototype, 'putStepPhoto').mockRejectedValueOnce(
      new QuotaExceededError(100, 50, 100, 'queue'),
    );
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });
    expect(result.current.photoNotSaved).toBe(true);

    await act(async () => { await capture(result); });

    expect(result.current.photoNotSaved).toBe(false);
    expect(result.current.stepStates[0].status).toBe('pass');
  });

  it('mints a clientSubmissionId once and reuses it across every subsequent capture', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-DUR-3' };
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(TWO_STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });
    await act(async () => { await vi.runAllTimersAsync(); }); // settle the 1500ms auto-advance to step 2

    const store = new SiteCamPhotoStore(STAFF_ID, 'civils', siteInfo.siteId);
    const firstId = (await drain(store.getMeta()))?.clientSubmissionId;
    expect(firstId).toBeTruthy();

    await act(async () => { await capture(result); });

    const secondId = (await drain(store.getMeta()))?.clientSubmissionId;
    expect(secondId).toBe(firstId);
  });
});

describe('useSiteCamCapture restore-on-mount (Task 5)', () => {
  it('hydrates a captured step photo from the durable store after a simulated remount (localStorage lite draft)', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-RESTORE-1' };
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const first = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(first.result); });
    expect(first.result.current.stepStates[0].status).toBe('pass');
    first.unmount();

    // Simulate the localStorage draft's "lite" quota fallback: progress kept,
    // photos stripped — this is the gap Task 5 closes via the durable store.
    saveDraft(siteInfo.jobType, siteInfo.siteId, [
      { ...first.result.current.stepStates[0], photoBase64: null },
    ], 0, null);

    const second = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    expect(second.result.current.stepStates[0].photoBase64).toBeNull(); // stripped, pre-restore

    await act(async () => { await vi.runAllTimersAsync(); });

    expect(second.result.current.stepStates[0].photoBase64).toBe('RkFLRQ==');
    expect(second.result.current.stepStates[0].status).toBe('pass');
  });
});

// =============================================================================
// Task 6 — offline-aware submitAll + page-context flush
// =============================================================================

describe('useSiteCamCapture offline submit + flush (Task 6)', () => {
  it('offline submitAll marks the job queued and does not set uploadResult', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-OFFLINE-1' };
    vi.stubGlobal('navigator', onlineNavigator({ onLine: false }));
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });

    await act(async () => {
      const pending = result.current.submitAll();
      await vi.runAllTimersAsync();
      await pending;
    });

    expect(result.current.queued).toBe(true);
    expect(result.current.uploadResult).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/sitecam/upload')).toBe(false);
  });

  it('online submitAll on 2xx clears the durable store and sets uploadResult', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-OFFLINE-2' };
    vi.stubGlobal('navigator', onlineNavigator());
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      if (url === '/api/sitecam/upload') return jsonOk({ data: { uploadedCount: 1 } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });

    await act(async () => {
      const pending = result.current.submitAll();
      await vi.runAllTimersAsync();
      await pending;
    });

    expect(result.current.uploadResult).toEqual({ uploadedCount: 1 });
    expect(result.current.queued).toBe(false);

    const store = new SiteCamPhotoStore(STAFF_ID, 'civils', siteInfo.siteId);
    expect(await drain(store.getMeta())).toBeNull();
    expect(await drain(store.listStepPhotos())).toHaveLength(0);
  });

  it('a queued job flushes automatically when the device comes back online, then clears', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-FLUSH-1' };
    vi.stubGlobal('navigator', onlineNavigator({ onLine: false }));
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      if (url === '/api/sitecam/upload') return jsonOk({ data: { uploadedCount: 1 } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });
    await act(async () => {
      const pending = result.current.submitAll();
      await flushZeroDelayChain(); // avoid looping the newly-registered 60s poll interval
      await pending;
    });
    expect(result.current.queued).toBe(true);

    (globalThis.navigator as unknown as { onLine: boolean }).onLine = true;
    // Two separate act() calls: React needs to process the online-state
    // update (and run useSiteCamFlush's effect) BEFORE we start draining the
    // fake-timer chain the resulting attemptFlush() kicks off — a single
    // combined act() callback lets the drain loop run to completion before
    // React ever re-renders, missing the effect entirely.
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await flushZeroDelayChain();
    });

    expect(result.current.uploadResult).toEqual({ uploadedCount: 1 });
    expect(result.current.queued).toBe(false);
  });

  it('a flush that hits a transient 503 keeps the job queued (retried later)', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-FLUSH-2' };
    vi.stubGlobal('navigator', onlineNavigator({ onLine: false }));
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      if (url === '/api/sitecam/upload') return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('unavailable') });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });
    await act(async () => {
      const pending = result.current.submitAll();
      await flushZeroDelayChain(); // avoid looping the newly-registered 60s poll interval
      await pending;
    });
    expect(result.current.queued).toBe(true);

    (globalThis.navigator as unknown as { onLine: boolean }).onLine = true;
    // Two separate act() calls: React needs to process the online-state
    // update (and run useSiteCamFlush's effect) BEFORE we start draining the
    // fake-timer chain the resulting attemptFlush() kicks off — a single
    // combined act() callback lets the drain loop run to completion before
    // React ever re-renders, missing the effect entirely.
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await flushZeroDelayChain();
    });

    expect(result.current.queued).toBe(true);
    expect(result.current.uploadResult).toBeNull();

    const store = new SiteCamPhotoStore(STAFF_ID, 'civils', siteInfo.siteId);
    expect(await drain(store.listStepPhotos())).toHaveLength(1);
  });

  it('a flush that hits a definitive 404 surfaces a visible error, never silently', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-FLUSH-3' };
    vi.stubGlobal('navigator', onlineNavigator({ onLine: false }));
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      if (url === '/api/sitecam/upload') return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Site not found') });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });
    await act(async () => {
      const pending = result.current.submitAll();
      await flushZeroDelayChain(); // avoid looping the newly-registered 60s poll interval
      await pending;
    });
    expect(result.current.queued).toBe(true);

    (globalThis.navigator as unknown as { onLine: boolean }).onLine = true;
    // Two separate act() calls: React needs to process the online-state
    // update (and run useSiteCamFlush's effect) BEFORE we start draining the
    // fake-timer chain the resulting attemptFlush() kicks off — a single
    // combined act() callback lets the drain loop run to completion before
    // React ever re-renders, missing the effect entirely.
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await flushZeroDelayChain();
    });

    expect(result.current.uploadError).toBe('Site not found');
    expect(result.current.uploadResult).toBeNull();
  });

  it('tapping Submit surfaces a visible error (not a silent no-op) when the store read fails (blind-review MEDIUM fix)', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-FLUSH-4' };
    vi.stubGlobal('navigator', onlineNavigator());
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });

    // Simulate the store erroring on read (e.g. IDB genuinely unreachable) —
    // previously this rejection propagated uncaught past `submitAll`'s
    // `onClick={() => void submitAll()}`, leaving the tap a silent no-op.
    vi.spyOn(SiteCamPhotoStore.prototype, 'getMeta').mockRejectedValue(new Error('IDB unavailable'));

    await act(async () => {
      const pending = result.current.submitAll();
      await flushZeroDelayChain();
      await pending;
    });

    expect(result.current.uploadError).toBe("Couldn't prepare your photos to submit — try again.");
    expect(result.current.uploadResult).toBeNull();
    expect(result.current.queued).toBe(false);
  });

  it('a queued flush that hits a persistent store-read failure surfaces uploadError and stops auto-retrying', async () => {
    const siteInfo: SiteInfo = { ...SITE_INFO, siteId: 'POLE-FLUSH-5' };
    vi.stubGlobal('navigator', onlineNavigator({ onLine: false }));
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/sitecam/validate') return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, STAFF_ID, siteInfo));
    await act(async () => { await capture(result); });
    await act(async () => {
      const pending = result.current.submitAll();
      await flushZeroDelayChain();
      await pending;
    });
    expect(result.current.queued).toBe(true);

    // The retry attempt (triggered by reconnect) hits a broken store read.
    vi.spyOn(SiteCamPhotoStore.prototype, 'listStepPhotos').mockRejectedValue(new Error('IDB cursor failed'));

    (globalThis.navigator as unknown as { onLine: boolean }).onLine = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await flushZeroDelayChain();
    });

    // Visible, not a silent stall — and the job is NOT lost (still queued,
    // ready for a manual retry once the store recovers).
    expect(result.current.uploadError).toBe("Couldn't prepare your photos to submit — try again.");
    expect(result.current.queued).toBe(true);
    expect(result.current.uploadResult).toBeNull();
  });
});

describe('useSiteCamCapture — step 6 dual serial (6a ONT → 6b Gizzu UPS)', () => {
  // An activation step that scans two serials, plus a following photo step so
  // there is somewhere to advance to once both serials are saved.
  const DUAL_SERIAL_STEPS: readonly SiteCamStep[] = [
    {
      number: 1, label: 'ONT Back After Install', hasVlm: false, hasSerialScan: true,
      serials: [
        { device: 'ont', label: 'ONT Serial' },
        { device: 'ups', label: 'Gizzu UPS Serial' },
      ],
    },
    { number: 2, label: 'Power Meter', hasVlm: true, hasSerialScan: false },
  ];
  const ACT_SITE: SiteInfo = { ...SITE_INFO, jobType: 'activations', siteId: 'DR2600734' };

  it('scans ONT first, then re-enters serial scan for the Gizzu UPS without advancing', async () => {
    const { result } = renderHook(() => useSiteCamCapture(DUAL_SERIAL_STEPS, STAFF_ID, ACT_SITE));

    // Take the ONT-back photo → enters the serial-scan stage on the ONT serial.
    await act(async () => { await capture(result); });
    expect(result.current.stepStates[0].status).toBe('serial_scan');
    expect(result.current.stepStates[0].serialIndex).toBe(0);
    expect(result.current.stepStates[0].serialDevice).toBe('ont');

    // 6a saved → still serial_scan, advanced to the UPS serial, attempts reset,
    // and the STEP has NOT advanced.
    await act(async () => { result.current.handleSerialSaved('ALCLB48CC3CA'); });
    expect(result.current.stepStates[0].status).toBe('serial_scan');
    expect(result.current.stepStates[0].serialIndex).toBe(1);
    expect(result.current.stepStates[0].serialDevice).toBe('ups');
    expect(result.current.stepStates[0].serialLabel).toBe('Gizzu UPS Serial');
    expect(result.current.stepStates[0].serialAttempts).toBe(0);
    expect(result.current.currentStepIndex).toBe(0);
  });

  it('completes step 6 and advances only after the Gizzu UPS serial is saved', async () => {
    const { result } = renderHook(() => useSiteCamCapture(DUAL_SERIAL_STEPS, STAFF_ID, ACT_SITE));
    await act(async () => { await capture(result); });
    await act(async () => { result.current.handleSerialSaved('ALCLB48CC3CA'); });

    // 6b saved → step complete and advance to step 7 after the delay.
    await act(async () => {
      result.current.handleSerialSaved('GU18W12V2508057584');
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(result.current.stepStates[0].status).toBe('serial_pending');
    expect(result.current.stepStates[0].serialScanned).toBe('GU18W12V2508057584');
    expect(result.current.currentStepIndex).toBe(1);
  });

  it('dev skip advances 6a → 6b (skips the current serial only, no step advance)', async () => {
    const { result } = renderHook(() => useSiteCamCapture(DUAL_SERIAL_STEPS, STAFF_ID, ACT_SITE));
    await act(async () => { await capture(result); });
    await act(async () => { result.current.skipSerialStep(); });
    expect(result.current.stepStates[0].status).toBe('serial_scan');
    expect(result.current.stepStates[0].serialIndex).toBe(1);
    expect(result.current.stepStates[0].serialDevice).toBe('ups');
    expect(result.current.currentStepIndex).toBe(0);
  });
});
