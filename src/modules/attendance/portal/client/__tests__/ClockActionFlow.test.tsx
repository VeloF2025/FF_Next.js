import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClockActionFlow } from '../clock/ClockActionFlow';

const hookState = vi.hoisted(() => {
  const queuedEventId = '171b4754-fbcf-4e34-bc86-e6240311f38e';
  const olderEventId = '0bff65f6-e8da-4d04-bcf4-23db41dd8960';
  return {
    queuedEventId,
    olderEventId,
    sync: {
    online: true,
    pendingCount: 0,
    syncing: false,
    queueUnavailable: false,
    lastReport: {
      attempted: 1,
      succeeded: 0,
      drained: 1,
      kept: 0,
      failures: [
        {
          id: queuedEventId,
          message: 'Dropped queued clock-in: you already had an open shift.',
        },
      ],
    },
    syncNow: vi.fn(),
    refreshPendingCount: vi.fn(),
    },
    evidence: {
    selfieFile: null,
    selfiePreview: null,
    gps: null,
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
    state: 'queued' as const,
    error: null,
    successMessage: 'Clock-in saved on this phone.',
    queuedEventId,
    doSubmit: vi.fn(),
    grantConsent: vi.fn(),
    reset: vi.fn(),
    cancelConsent: vi.fn(),
    },
  };
});

vi.mock('../offline/useAttendanceSync', () => ({
  useAttendanceSync: () => hookState.sync,
}));

vi.mock('../useDeviceFingerprint', () => ({
  useDeviceFingerprint: () => '0123456789abcdef0123456789abcdef',
}));

vi.mock('../clock/useClockEvidence', () => ({
  useClockEvidence: () => hookState.evidence,
}));

vi.mock('../clock/useClockSubmission', () => ({
  useClockSubmission: () => hookState.submission,
}));

describe('ClockActionFlow queued sync outcome', () => {
  beforeEach(() => {
    hookState.sync.pendingCount = 0;
    hookState.sync.lastReport = {
      attempted: 1,
      succeeded: 0,
      drained: 1,
      kept: 0,
      failures: [{
        id: hookState.queuedEventId,
        message: 'Dropped queued clock-in: you already had an open shift.',
      }],
    };
    hookState.submission.queuedEventId = hookState.queuedEventId;
  });

  it('replaces stale queued copy after an open-entry conflict drains the local event', () => {
    render(<ClockActionFlow action="in" onDone={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'Queued event not submitted' })
    ).toBeVisible();
    expect(
      screen.getByText('Dropped queued clock-in: you already had an open shift.')
    ).toBeVisible();
    expect(
      screen.queryByText('Saved on this phone — not yet submitted')
    ).not.toBeInTheDocument();
  });

  it('keeps an unrelated drain out of the current submission result', () => {
    hookState.sync.lastReport = {
      attempted: 2,
      succeeded: 1,
      drained: 1,
      kept: 0,
      failures: [{
        id: hookState.olderEventId,
        message: 'Dropped older clock-in: clock time was invalid.',
      }],
    };

    render(<ClockActionFlow action="in" onDone={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'Queued clock-in submitted' })
    ).toBeVisible();
    expect(
      screen.getByText('1 other queued event was not submitted.')
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Queued event not submitted' })
    ).not.toBeInTheDocument();
  });
});
