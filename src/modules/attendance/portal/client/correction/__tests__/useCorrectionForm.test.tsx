/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ submitMyCorrection: vi.fn(), submitRequiredAttendanceCorrection: vi.fn() }));
vi.mock('../../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api')>(),
  submitMyCorrection: mocks.submitMyCorrection,
}));
vi.mock('../../attendanceStateApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../attendanceStateApi')>(),
  submitRequiredAttendanceCorrection: mocks.submitRequiredAttendanceCorrection,
}));

import { useCorrectionForm } from '../useCorrectionForm';

const REQUIRED_RESULT = {
  adjustmentId: 'adj-1', exceptionId: 'exc-1', decisionEventId: 'evt-1', exceptionStatus: 'awaiting_supervisor' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.submitMyCorrection.mockResolvedValue({ adjustmentId: 'generic-adj-1' });
  mocks.submitRequiredAttendanceCorrection.mockResolvedValue(REQUIRED_RESULT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCorrectionForm — required-flow onRequiredSuccess', () => {
  it('supplies the canonical adjustment ID from a required-flow success to onRequiredSuccess', async () => {
    const onRequiredSuccess = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCorrectionForm({
      entryId: 'entry-1', exceptionId: 'exc-1', hints: null,
      onGenericSuccess: vi.fn(), onRequiredSuccess,
    }));

    act(() => { result.current.setAdjustedOut('2026-08-10T09:00'); });
    act(() => { result.current.setReason('Forgot to clock out at end of shift'); });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as unknown as React.FormEvent);
    });

    await waitFor(() => expect(result.current.confirmed).toBe(true));
    expect(onRequiredSuccess).toHaveBeenCalledWith('adj-1');
    expect(onRequiredSuccess).toHaveBeenCalledTimes(1);
  });

  it('preserves existing callers with no onRequiredSuccess as a default no-op — required success still confirms', async () => {
    const { result } = renderHook(() => useCorrectionForm({
      entryId: 'entry-1', exceptionId: 'exc-1', hints: null, onGenericSuccess: vi.fn(),
    }));

    act(() => { result.current.setAdjustedOut('2026-08-10T09:00'); });
    act(() => { result.current.setReason('Forgot to clock out at end of shift'); });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as unknown as React.FormEvent);
    });

    await waitFor(() => expect(result.current.confirmed).toBe(true));
    expect(result.current.submitError).toBeNull();
  });

  it('never reports the Attendance submission as failed when onRequiredSuccess (the Fleet link call) rejects', async () => {
    const onRequiredSuccess = vi.fn().mockRejectedValue(new Error('link endpoint unreachable'));
    const { result } = renderHook(() => useCorrectionForm({
      entryId: 'entry-1', exceptionId: 'exc-1', hints: null,
      onGenericSuccess: vi.fn(), onRequiredSuccess,
    }));

    act(() => { result.current.setAdjustedOut('2026-08-10T09:00'); });
    act(() => { result.current.setReason('Forgot to clock out at end of shift'); });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as unknown as React.FormEvent);
    });

    await waitFor(() => expect(result.current.confirmed).toBe(true));
    expect(onRequiredSuccess).toHaveBeenCalledWith('adj-1');
    expect(result.current.submitError).toBeNull();
  });

  it('does not call onRequiredSuccess for the existing generic (non-required) correction flow', async () => {
    const onRequiredSuccess = vi.fn();
    const onGenericSuccess = vi.fn();
    const { result } = renderHook(() => useCorrectionForm({
      entryId: 'entry-1', exceptionId: '', hints: null, onGenericSuccess, onRequiredSuccess,
    }));

    act(() => { result.current.setKind('wrong_site'); });
    act(() => { result.current.setAdjustedIn('2026-08-10T08:00'); });
    act(() => { result.current.setReason('Was dispatched to the wrong site by mistake'); });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as unknown as React.FormEvent);
    });

    await waitFor(() => expect(onGenericSuccess).toHaveBeenCalledTimes(1));
    expect(onRequiredSuccess).not.toHaveBeenCalled();
  });
});
