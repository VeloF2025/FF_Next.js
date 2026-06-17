/**
 * Tests for the useSiteCamCapture state machine — attempt counting,
 * escalation after maxAttempts, and the fail-open paths.
 *
 * FileReader is stubbed so readFileAsBase64 resolves deterministically
 * without depending on jsdom's async file plumbing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// jsdom can't decode images, so the canvas watermark path would hang — stub
// it to behave like its own fallback (clean + watermarked both the raw base64).
vi.mock('../../lib/watermarkPhoto', () => ({
  prepareCapturePhotos: vi.fn(async () => ({ clean: 'RkFLRQ==', watermarked: 'RkFLRQ==' })),
}));

import { useSiteCamCapture, type SiteInfo, type StepState } from '../useSiteCamCapture';
import type { SiteCamStep } from '../../lib/sitecamSteps';
import { buildReading } from '../../lib/geofence';
import { saveDraft } from '../../lib/sitecamDraft';

const TWO_STEPS: readonly SiteCamStep[] = [
  { number: 1, label: 'A', hasVlm: true },
  { number: 2, label: 'B', hasVlm: true },
];

function stepFixture(num: number, over: Partial<StepState> = {}): StepState {
  return {
    stepNumber: num, label: `Step ${num}`, hasVlm: true, hasSerialScan: false,
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

    const { result } = renderHook(() => useSiteCamCapture(STEPS, SITE_INFO));

    await act(async () => {
      await result.current.captureAndValidate(file());
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

    const { result } = renderHook(() => useSiteCamCapture(STEPS, SITE_INFO));

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await result.current.captureAndValidate(file());
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

    const { result } = renderHook(() => useSiteCamCapture(STEPS, SITE_INFO));

    await act(async () => {
      await result.current.captureAndValidate(file());
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

    const { result } = renderHook(() => useSiteCamCapture(STEPS, SITE_INFO));
    await act(async () => {
      await result.current.captureAndValidate(file());
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

    const { result } = renderHook(() => useSiteCamCapture(STEPS, SITE_INFO));
    await act(async () => {
      await result.current.captureAndValidate(file());
    });

    expect(result.current.stepStates[0].status).toBe('pass');
    expect(result.current.stepStates[0].needsManualReview).toBe(false);
  });

  it('auto-passes a non-VLM step without calling the validate API', async () => {
    const noVlmSteps: readonly SiteCamStep[] = [{ number: 3, label: 'Entry Outside', hasVlm: false }];
    const { result } = renderHook(() => useSiteCamCapture(noVlmSteps, SITE_INFO));

    await act(async () => {
      await result.current.captureAndValidate(file());
    });

    expect(result.current.stepStates[0].status).toBe('pass');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useSiteCamCapture geofence payload', () => {
  it('includes the entry reading + submit-time stamp in the upload body', async () => {
    vi.stubGlobal('navigator', {
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

    const { result } = renderHook(() => useSiteCamCapture(STEPS, SITE_INFO, entryReading));
    await act(async () => { await result.current.captureAndValidate(file()); });
    await act(async () => { await vi.runAllTimersAsync(); });
    await act(async () => { await result.current.submitAll(); });

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
      SITE_INFO.siteId,
      [stepFixture(1, { status: 'pass', photoBase64: 'AAAA' }), stepFixture(2)],
      1,
      null,
    );

    const { result } = renderHook(() => useSiteCamCapture(TWO_STEPS, SITE_INFO));

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

    const { result } = renderHook(() => useSiteCamCapture(TWO_STEPS, SITE_INFO));

    await act(async () => { await result.current.captureAndValidate(file()); });
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

    const { result } = renderHook(() => useSiteCamCapture(TWO_STEPS, SITE_INFO));

    await act(async () => { await result.current.captureAndValidate(file()); });
    await act(async () => { result.current.onAppealSubmitted(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(result.current.stepStates[0].status).toBe('fail');
    expect(result.current.stepStates[0].failReasons).toEqual(['Still wrong angle']);
    expect(result.current.currentStepIndex).toBe(0);
  });
});
