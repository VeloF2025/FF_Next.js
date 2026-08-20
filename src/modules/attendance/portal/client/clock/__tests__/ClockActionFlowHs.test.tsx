/** @vitest-environment jsdom */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClockActionFlow } from '../ClockActionFlow';
import type { HsCheckinSteps as HsCheckinStepsType } from '../HsCheckinSteps';

// A spy wrapper around the REAL HsCheckinSteps, not a stand-in for it. It
// still mounts and behaves exactly like the production component (tests 1
// and 4 exercise it end to end), but every render is also recorded here.
// That gives the offline/clock-out tests a signal that does not depend on
// HsCheckinSteps's own async bootstrap timing — "was the component asked to
// mount at all" is decided synchronously by React, unlike its rendered
// output, which stays an empty fragment until the bootstrap fetch settles.
const hsStepsSpy = vi.hoisted(() => vi.fn());

vi.mock('../HsCheckinSteps', async () => {
  const actual = await vi.importActual<{ HsCheckinSteps: typeof HsCheckinStepsType }>(
    '../HsCheckinSteps'
  );
  return {
    HsCheckinSteps: (props: Parameters<typeof HsCheckinStepsType>[0]) => {
      hsStepsSpy(props);
      return React.createElement(actual.HsCheckinSteps, props);
    },
  };
});

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
  hsStepsSpy.mockClear();
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
    // Never resolves. If a future mutation lets HsCheckinSteps mount here,
    // its bootstrap fetch hangs instead of crashing on an unconfigured
    // mock's `undefined.then(...)` — so a regression fails on the
    // assertions below, not on an unrelated TypeError.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    let container!: HTMLElement;
    await act(async () => {
      container = render(
        <ClockActionFlow action="out" onDone={vi.fn()} />
      ).container;
    });
    expect(concatText(container)).not.toMatch(/where are you working/i);
    expect(fetchMock).not.toHaveBeenCalled();
    // Timing-independent: HsCheckinSteps must never even be asked to mount
    // for a clock-out, not just fail to have rendered visible text yet.
    expect(hsStepsSpy).not.toHaveBeenCalled();
  });

  it('does NOT show them when the clock-in was queued offline', async () => {
    hookState.submission.state = 'queued';
    hookState.submission.queuedEventId = 'event-1';
    hookState.submission.successMessage = 'Clock-in saved on this phone.';
    // Never resolves. There is genuinely no network in the offline-queued
    // state, so this test intentionally never configures a real response —
    // but an unconfigured vi.fn() call returns undefined, and if a
    // regression lets HsCheckinSteps mount, its bootstrap fetch would crash
    // on `undefined.then(...)` before the assertions below run, masking a
    // real failure behind an unrelated TypeError. Hanging instead keeps the
    // failure on the assertions, where it belongs.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    let container!: HTMLElement;
    await act(async () => {
      container = render(
        <ClockActionFlow action="in" onDone={vi.fn()} />
      ).container;
    });
    expect(concatText(container)).toMatch(/saved on this phone/i);
    expect(concatText(container)).not.toMatch(/where are you working/i);
    expect(fetchMock).not.toHaveBeenCalled();
    // HsCheckinSteps starts loading=true and renders an empty fragment for
    // its first tick regardless of whether the guard held — the text
    // assertion above cannot tell "guard worked" from "hasn't fetched yet".
    // This is the assertion that actually proves the guard: the component
    // was never even instantiated for a queued (offline) clock-in.
    expect(hsStepsSpy).not.toHaveBeenCalled();
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
