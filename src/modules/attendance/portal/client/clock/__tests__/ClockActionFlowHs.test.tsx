/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClockActionFlow } from '../ClockActionFlow';

const hookState = vi.hoisted(() => {
  return {
    sync: {
      online: true,
      pendingCount: 0,
      syncing: false,
      queueUnavailable: false,
      lastReport: null,
      syncNow: vi.fn(),
      refreshPendingCount: vi.fn(),
    },
    evidence: {
      selfieFile: null,
      selfiePreview: null,
      gps: { lat: -26.1, lon: 28.0, accuracyM: 10, capturedAt: '2026-08-20T08:00:00Z' },
      gpsAddress: null,
      gpsDenied: false,
      capturing: false,
      error: null,
      cameraRef: { current: null },
      captureGpsOnce: vi.fn(),
      handleSelfieChange: vi.fn(),
      retryDenied: vi.fn(),
    },
    submission: {
      state: 'success' as string,
      error: null as string | null,
      successMessage: 'Clocked in at Lawley FTTH.',
      queuedEventId: null as string | null,
      entryId: 'entry-1' as string | null,
      doSubmit: vi.fn(),
      grantConsent: vi.fn(),
      reset: vi.fn(),
      cancelConsent: vi.fn(),
    },
  };
});

vi.mock('../../offline/useAttendanceSync', () => ({
  useAttendanceSync: () => hookState.sync,
}));

vi.mock('../../useDeviceFingerprint', () => ({
  useDeviceFingerprint: () => '0123456789abcdef0123456789abcdef',
}));

vi.mock('../useClockEvidence', () => ({
  useClockEvidence: () => hookState.evidence,
}));

vi.mock('../useClockSubmission', () => ({
  useClockSubmission: () => hookState.submission,
}));

/**
 * Concatenated rendered text — React can split an interpolated string across
 * sibling text nodes, so matching against a single serialised node is not
 * reliable evidence the text is actually there.
 */
function concatText(container: HTMLElement): string {
  return container.textContent ?? '';
}

function bootstrapResponse() {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        checkin_date: '2026-08-20',
        completed: false,
        checkin: null,
        projects: [],
        default_project_id: null,
        activities: [],
        medical_status: 'current',
      },
    }),
  };
}

function postResponse() {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: { checkin: { id: 'checkin-1' }, clearance: 'cleared', blocked_reasons: [] },
    }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  hookState.submission.state = 'success';
  hookState.submission.queuedEventId = null;
  hookState.submission.successMessage = 'Clocked in at Lawley FTTH.';
  hookState.sync.pendingCount = 0;
  hookState.sync.lastReport = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function completeHsSteps() {
  const user = userEvent.setup();
  await waitFor(() => screen.getByText(/where are you working/i));
  await user.click(screen.getByRole('button', { name: 'Office' }));
  await user.click(screen.getByRole('button', { name: 'Yes, I am' }));
  await user.click(screen.getByRole('button', { name: /submit/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  // Acknowledge the H&S outcome screen to trigger onDone -> SuccessView.
  await waitFor(() => screen.getByRole('button', { name: 'Back to hub' }));
  await user.click(screen.getByRole('button', { name: 'Back to hub' }));
}

describe('ClockActionFlow — H&S steps', () => {
  it('shows the H&S steps after a successful clock-in', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapResponse());
    let container!: HTMLElement;
    await act(async () => {
      container = render(
        <ClockActionFlow action="in" onDone={vi.fn()} />
      ).container;
    });
    await waitFor(() => expect(concatText(container)).toMatch(/where are you working/i));
  });

  it('does NOT show them after a clock-OUT', async () => {
    hookState.submission.successMessage = 'Clocked out. Shift length: 8.0h.';
    let container!: HTMLElement;
    await act(async () => {
      container = render(
        <ClockActionFlow action="out" onDone={vi.fn()} />
      ).container;
    });
    expect(concatText(container)).not.toMatch(/where are you working/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does NOT show them when the clock-in was queued offline', async () => {
    hookState.submission.state = 'queued';
    hookState.submission.queuedEventId = 'event-1';
    hookState.submission.successMessage = 'Clock-in saved on this phone.';
    let container!: HTMLElement;
    await act(async () => {
      container = render(
        <ClockActionFlow action="in" onDone={vi.fn()} />
      ).container;
    });
    expect(concatText(container)).toMatch(/saved on this phone/i);
    expect(concatText(container)).not.toMatch(/where are you working/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reaches the normal success screen after the declaration is done', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapResponse());
    fetchMock.mockResolvedValueOnce(postResponse());
    let container!: HTMLElement;
    await act(async () => {
      container = render(
        <ClockActionFlow action="in" onDone={vi.fn()} />
      ).container;
    });
    await completeHsSteps();
    await waitFor(() => expect(concatText(container)).toMatch(/clocked in/i));
  });
});
