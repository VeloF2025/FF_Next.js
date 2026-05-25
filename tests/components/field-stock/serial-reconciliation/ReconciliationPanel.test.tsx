/** Tests for ReconciliationPanel — the four render states + refresh wiring (PR-11). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReconciliationSummary } from '@/types/field-stock';

const { useHookMock } = vi.hoisted(() => ({ useHookMock: vi.fn() }));
vi.mock('@/modules/procurement/field-stock/hooks/useSerialReconciliation', () => ({
  useSerialReconciliation: useHookMock,
}));

import { ReconciliationPanel } from '@/components/field-stock/serial-reconciliation/ReconciliationPanel';

const refresh = vi.fn();
function mockHook(over: Partial<ReturnType<typeof useHookMock>>) {
  useHookMock.mockReturnValue({ summary: null, loading: false, error: null, refresh, ...over });
}
const summary = (checks: ReconciliationSummary['checks']): ReconciliationSummary => ({
  checks, ranAt: '2026-05-25T10:00:00.000Z', allPassed: checks.every((c) => c.passed),
});

describe('ReconciliationPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the loading state before the first result', () => {
    mockHook({ loading: true });
    render(<ReconciliationPanel />);
    expect(screen.getByText('Running reconciliation checks…')).toBeInTheDocument();
  });

  it('shows the error state with a Try again action', () => {
    mockHook({ error: 'HTTP 500' });
    render(<ReconciliationPanel />);
    expect(screen.getByText('Error running reconciliation')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('shows the all-passed banner when every check passes', () => {
    mockHook({ summary: summary([{ name: 'latest_event_matches_status', tolerance: 0, drift: 0, passed: true }]) });
    render(<ReconciliationPanel />);
    expect(screen.getByText('All 1 checks passed')).toBeInTheDocument();
  });

  it('shows the failing banner with the failed count when checks fail', () => {
    mockHook({ summary: summary([
      { name: 'assets_without_serial', tolerance: 0, drift: 12, passed: false },
      { name: 'latest_event_matches_status', tolerance: 0, drift: 0, passed: true },
    ]) });
    render(<ReconciliationPanel />);
    expect(screen.getByText('1 of 2 checks failing')).toBeInTheDocument();
  });

  it('calls refresh when the Refresh button is clicked', () => {
    mockHook({ summary: summary([{ name: 'latest_event_matches_status', tolerance: 0, drift: 0, passed: true }]) });
    render(<ReconciliationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
