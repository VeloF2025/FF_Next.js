/**
 * Tests for ReturnSignSubmitStep.
 *
 * Covers:
 * - Submit calls submitReturn with correct draft + idempotency key
 * - Offline path calls enqueueReturn instead
 * - Back button calls onBack
 * - Signature required before submit
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReturnSignSubmitStep } from '../ReturnSignSubmitStep';
import type { PwaMyHeldSerial, PwaReturnResult } from '../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSubmitReturn = vi.fn();
const mockEnqueueReturn = vi.fn();

vi.mock('@/modules/field-stock-pwa/api', () => ({
  submitReturn: (...args: unknown[]) => mockSubmitReturn(...args),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('@/modules/field-stock-pwa/offline/queueReturn', () => ({
  enqueueReturn: (...args: unknown[]) => mockEnqueueReturn(...args),
}));

// Mock SignaturePad to expose a simple "sign" button in tests
vi.mock('../SignaturePad', () => ({
  SignaturePad: ({
    onChange,
  }: {
    value: string | null;
    onChange: (v: string | null) => void;
  }) => (
    <button
      type="button"
      data-testid="sign-btn"
      onClick={() => onChange('data:image/png;base64,test')}
    >
      Sign
    </button>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SERIAL_1: PwaMyHeldSerial = {
  serialId: 'uuid-s1',
  serialNumber: 'SN-001',
  stockItemId: 'item-1',
  stockItemName: 'ONT XS-010X-Q',
  sourceLocationId: 'loc-lawley',
  sourceLocationName: 'Lawley Warehouse',
};

const SUCCESS_RESULT: PwaReturnResult = {
  returnId: 'ret-uuid',
  returnNumber: 'RET-202601-00001',
  status: 'pending',
};

function baseProps(overrides?: Partial<React.ComponentProps<typeof ReturnSignSubmitStep>>) {
  return {
    reason: 'unused' as const,
    serials: [SERIAL_1],
    returnToLocationId: 'loc-lawley',
    returnToLocationName: 'Lawley Warehouse',
    originalPickingId: null,
    onSubmitted: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('navigator', { ...navigator, onLine: true });
});

describe('ReturnSignSubmitStep', () => {
  it('renders the reason label and serial list', () => {
    render(<ReturnSignSubmitStep {...baseProps()} />);
    expect(screen.getByText(/Unused — end of job/i)).toBeTruthy();
    expect(screen.getByText('SN-001')).toBeTruthy();
    expect(screen.getAllByText(/Lawley Warehouse/i).length).toBeGreaterThan(0);
  });

  it('submit button is disabled when no signature', () => {
    render(<ReturnSignSubmitStep {...baseProps()} />);
    const submitBtn = screen.getByRole('button', { name: /Sign and submit/i });
    expect(submitBtn).toBeDisabled();
  });

  it('enables submit after signing', async () => {
    render(<ReturnSignSubmitStep {...baseProps()} />);
    fireEvent.click(screen.getByTestId('sign-btn'));
    const submitBtn = screen.getByRole('button', { name: /Sign and submit/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it('calls submitReturn with correct args and fires onSubmitted', async () => {
    mockSubmitReturn.mockResolvedValueOnce(SUCCESS_RESULT);
    const onSubmitted = vi.fn();
    render(<ReturnSignSubmitStep {...baseProps({ onSubmitted })} />);
    fireEvent.click(screen.getByTestId('sign-btn'));
    fireEvent.click(screen.getByRole('button', { name: /Sign and submit/i }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());

    // Verify submitReturn was called
    expect(mockSubmitReturn).toHaveBeenCalledOnce();
    const [draftArg, keyArg] = mockSubmitReturn.mock.calls[0] as [
      { reason: string; serials: unknown[]; returnToLocationId: string },
      string,
    ];
    expect(draftArg.reason).toBe('unused');
    expect(draftArg.serials).toHaveLength(1);
    expect(draftArg.returnToLocationId).toBe('loc-lawley');
    // Idempotency key must be a UUID string
    expect(typeof keyArg).toBe('string');
    expect(keyArg).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(onSubmitted).toHaveBeenCalledWith(SUCCESS_RESULT);
  });

  it('offline path calls enqueueReturn and fires onSubmitted with queued sentinel', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    mockEnqueueReturn.mockResolvedValueOnce('queue-uuid-1');
    const onSubmitted = vi.fn();
    render(<ReturnSignSubmitStep {...baseProps({ onSubmitted })} />);
    fireEvent.click(screen.getByTestId('sign-btn'));
    fireEvent.click(screen.getByRole('button', { name: /Sign and submit/i }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());

    expect(mockSubmitReturn).not.toHaveBeenCalled();
    expect(mockEnqueueReturn).toHaveBeenCalledOnce();
    const [result] = onSubmitted.mock.calls[0] as [PwaReturnResult];
    expect(result.returnNumber).toBe('QUEUED');
    expect(result.status).toBe('pending');
  });

  it('back button calls onBack', () => {
    const onBack = vi.fn();
    render(<ReturnSignSubmitStep {...baseProps({ onBack })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows inline error when submitReturn rejects', async () => {
    mockSubmitReturn.mockRejectedValueOnce(new Error('Network failure'));
    render(<ReturnSignSubmitStep {...baseProps()} />);
    fireEvent.click(screen.getByTestId('sign-btn'));
    fireEvent.click(screen.getByRole('button', { name: /Sign and submit/i }));

    await waitFor(() => screen.getByText(/Network failure/i));
  });

  it('idempotency key is stable across re-renders', async () => {
    mockSubmitReturn.mockResolvedValue(SUCCESS_RESULT);
    const onSubmitted = vi.fn();
    const { rerender } = render(
      <ReturnSignSubmitStep {...baseProps({ onSubmitted })} />,
    );
    fireEvent.click(screen.getByTestId('sign-btn'));
    fireEvent.click(screen.getByRole('button', { name: /Sign and submit/i }));
    // Wait for first submit to fully complete (button back to non-submitting)
    await waitFor(() => expect(mockSubmitReturn).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Sign and submit/i })).not.toBeDisabled(),
    );

    const firstKey = mockSubmitReturn.mock.calls[0][1] as string;

    // Re-render (parent state change) — key must be the same
    mockSubmitReturn.mockResolvedValue(SUCCESS_RESULT);
    rerender(<ReturnSignSubmitStep {...baseProps({ onSubmitted })} />);
    // Signature state is local — need to re-sign after rerender
    fireEvent.click(screen.getByTestId('sign-btn'));
    fireEvent.click(screen.getByRole('button', { name: /Sign and submit/i }));
    await waitFor(() => expect(mockSubmitReturn).toHaveBeenCalledTimes(2));

    const secondKey = mockSubmitReturn.mock.calls[1][1] as string;
    expect(firstKey).toBe(secondKey);
  });
});
