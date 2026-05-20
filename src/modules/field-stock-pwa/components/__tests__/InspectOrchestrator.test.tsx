/**
 * Tests for InspectOrchestrator.
 *
 * Covers:
 * - Loading state while fetch is in progress
 * - Renders line rows after data loads
 * - Submit disabled until all lines have condition + disposition AND signature
 * - Submit calls submitInspectAndAccept with correct body shape
 * - Retry path uses retryAccept (not submitInspectAndAccept)
 * - Error state renders inline banner
 * - Success view renders return number
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { InspectOrchestrator } from '../InspectOrchestrator';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="shell" data-title={title}>{children}</div>
  ),
}));

// Mock SignaturePad to expose a simple "sign" button
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

const mockSubmitInspectAndAccept = vi.fn();
const mockRetryAccept = vi.fn();

vi.mock('@/modules/field-stock-pwa/api/returns', () => ({
  submitInspectAndAccept: (...args: unknown[]) => mockSubmitInspectAndAccept(...args),
  retryAccept: (...args: unknown[]) => mockRetryAccept(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROFILE: AttendanceProfile = {
  id: 'staff-1',
  name: 'Stores Person',
  role: 'stores',
  authRole: null,
  phone: null,
  profilePhotoUrl: null,
  accountStatus: 'active',
  contractorId: null,
};

const PENDING_RETURN = {
  id: 'ret-uuid-1',
  return_number: 'RET-202601-00001',
  status: 'pending',
  lines: [
    {
      id: 'line-001',
      serial_number: 'SN-TEST-001',
      item_name: 'ONT XS-010X-Q',
      condition: null,
      disposition: null,
      notes: null,
    },
    {
      id: 'line-002',
      serial_number: 'SN-TEST-002',
      item_name: 'ONT XS-010X-Q',
      condition: null,
      disposition: null,
      notes: null,
    },
  ],
};

const INSPECTED_RETURN = {
  ...PENDING_RETURN,
  status: 'inspected',
  lines: PENDING_RETURN.lines.map((l) => ({
    ...l,
    condition: 'good',
    disposition: 'restock',
  })),
};

const SUCCESS_RESULT = {
  returnId: 'ret-uuid-1',
  returnNumber: 'RET-202601-00001',
  status: 'restocked',
};

function setupFetch(pendingRows: unknown[] = [], inspectedRows: unknown[] = []) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const rows = url.includes('status=inspected') ? inspectedRows : pendingRows;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(rows),
    } as Response);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InspectOrchestrator', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSubmitInspectAndAccept.mockReset();
    mockRetryAccept.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    setupFetch([PENDING_RETURN]);
    render(<InspectOrchestrator profile={PROFILE} returnId="ret-uuid-1" />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders line rows after data loads', async () => {
    setupFetch([PENDING_RETURN]);
    render(<InspectOrchestrator profile={PROFILE} returnId="ret-uuid-1" />);
    await waitFor(() => {
      expect(screen.getByText('SN-TEST-001')).toBeTruthy();
      expect(screen.getByText('SN-TEST-002')).toBeTruthy();
    });
  });

  it('shows error banner when return is not found', async () => {
    setupFetch([], []);
    render(<InspectOrchestrator profile={PROFILE} returnId="nonexistent-id" />);
    await waitFor(() => {
      expect(screen.getByText('Return not found')).toBeTruthy();
    });
  });

  it('submit button is disabled when not all lines have condition + disposition', async () => {
    setupFetch([PENDING_RETURN]);
    render(<InspectOrchestrator profile={PROFILE} returnId="ret-uuid-1" />);
    await waitFor(() => screen.getByText('SN-TEST-001'));

    // Only set condition+disposition on first line
    const goodBtns = screen.getAllByRole('radio', { name: 'Good' });
    const restockBtns = screen.getAllByRole('radio', { name: 'Restock' });
    fireEvent.click(goodBtns[0]);
    fireEvent.click(restockBtns[0]);

    const submitBtn = screen.getByRole('button', { name: /inspect and restock/i });
    expect(submitBtn).toBeDisabled();
  });

  it('submit button is disabled when lines complete but no signature', async () => {
    setupFetch([PENDING_RETURN]);
    render(<InspectOrchestrator profile={PROFILE} returnId="ret-uuid-1" />);
    await waitFor(() => screen.getByText('SN-TEST-001'));

    // Complete all lines
    const goodBtns = screen.getAllByRole('radio', { name: 'Good' });
    const restockBtns = screen.getAllByRole('radio', { name: 'Restock' });
    fireEvent.click(goodBtns[0]);
    fireEvent.click(restockBtns[0]);
    fireEvent.click(goodBtns[1]);
    fireEvent.click(restockBtns[1]);

    const submitBtn = screen.getByRole('button', { name: /inspect and restock/i });
    expect(submitBtn).toBeDisabled();
  });

  it('submit enabled when all lines complete + signature present', async () => {
    setupFetch([PENDING_RETURN]);
    render(<InspectOrchestrator profile={PROFILE} returnId="ret-uuid-1" />);
    await waitFor(() => screen.getByText('SN-TEST-001'));

    const goodBtns = screen.getAllByRole('radio', { name: 'Good' });
    const restockBtns = screen.getAllByRole('radio', { name: 'Restock' });
    fireEvent.click(goodBtns[0]);
    fireEvent.click(restockBtns[0]);
    fireEvent.click(goodBtns[1]);
    fireEvent.click(restockBtns[1]);
    fireEvent.click(screen.getByTestId('sign-btn'));

    const submitBtn = screen.getByRole('button', { name: /inspect and restock/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it('submit calls submitInspectAndAccept with correct body shape', async () => {
    mockSubmitInspectAndAccept.mockResolvedValue(SUCCESS_RESULT);
    setupFetch([PENDING_RETURN]);
    render(<InspectOrchestrator profile={PROFILE} returnId="ret-uuid-1" />);
    await waitFor(() => screen.getByText('SN-TEST-001'));

    const goodBtns = screen.getAllByRole('radio', { name: 'Good' });
    const restockBtns = screen.getAllByRole('radio', { name: 'Restock' });
    fireEvent.click(goodBtns[0]);
    fireEvent.click(restockBtns[0]);
    fireEvent.click(goodBtns[1]);
    fireEvent.click(restockBtns[1]);
    fireEvent.click(screen.getByTestId('sign-btn'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /inspect and restock/i }));
    });

    expect(mockSubmitInspectAndAccept).toHaveBeenCalledOnce();
    const call = mockSubmitInspectAndAccept.mock.calls[0][0];
    expect(call.returnId).toBe('ret-uuid-1');
    expect(call.lineDispositions).toHaveLength(2);
    expect(call.lineDispositions[0]).toMatchObject({
      lineId: 'line-001',
      condition: 'good',
      disposition: 'restock',
    });
  });

  it('retry path uses retryAccept, not submitInspectAndAccept', async () => {
    mockRetryAccept.mockResolvedValue(SUCCESS_RESULT);
    // Return not found in pending list, found in inspected list
    setupFetch([], [INSPECTED_RETURN]);
    render(<InspectOrchestrator profile={PROFILE} returnId="ret-uuid-1" />);
    await waitFor(() => screen.getByText('SN-TEST-001'));

    // On retry path, submit button should be enabled immediately (no signature needed)
    const retryBtn = screen.getByRole('button', { name: /retry restock/i });
    expect(retryBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(mockRetryAccept).toHaveBeenCalledOnce();
    expect(mockRetryAccept).toHaveBeenCalledWith('ret-uuid-1');
    expect(mockSubmitInspectAndAccept).not.toHaveBeenCalled();
  });

  it('shows success view with return number after submit', async () => {
    mockSubmitInspectAndAccept.mockResolvedValue(SUCCESS_RESULT);
    setupFetch([PENDING_RETURN]);
    render(<InspectOrchestrator profile={PROFILE} returnId="ret-uuid-1" />);
    await waitFor(() => screen.getByText('SN-TEST-001'));

    const goodBtns = screen.getAllByRole('radio', { name: 'Good' });
    const restockBtns = screen.getAllByRole('radio', { name: 'Restock' });
    goodBtns.forEach((btn) => fireEvent.click(btn));
    restockBtns.forEach((btn) => fireEvent.click(btn));
    fireEvent.click(screen.getByTestId('sign-btn'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /inspect and restock/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Restocked')).toBeTruthy();
      expect(screen.getByText('RET-202601-00001')).toBeTruthy();
    });
  });

  it('shows error banner on submit failure', async () => {
    mockSubmitInspectAndAccept.mockRejectedValue(new Error('Database error'));
    setupFetch([PENDING_RETURN]);
    render(<InspectOrchestrator profile={PROFILE} returnId="ret-uuid-1" />);
    await waitFor(() => screen.getByText('SN-TEST-001'));

    const goodBtns = screen.getAllByRole('radio', { name: 'Good' });
    const restockBtns = screen.getAllByRole('radio', { name: 'Restock' });
    goodBtns.forEach((btn) => fireEvent.click(btn));
    restockBtns.forEach((btn) => fireEvent.click(btn));
    fireEvent.click(screen.getByTestId('sign-btn'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /inspect and restock/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeTruthy();
    });
  });
});
