/** Tests for ReconciliationTile — the per-check pass/fail tile (PR-11). */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconciliationTile } from '@/components/field-stock/serial-reconciliation/ReconciliationTile';

describe('ReconciliationTile', () => {
  it('renders the human-readable label, the raw check id, and the drift count', () => {
    render(<ReconciliationTile result={{ name: 'latest_event_matches_status', tolerance: 0, drift: 0, passed: true }} />);
    expect(screen.getByText('Status matches latest event')).toBeInTheDocument();
    expect(screen.getByText('latest_event_matches_status')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/tolerance 0/)).toBeInTheDocument();
  });

  it('falls back to a humanized name for an unknown check id', () => {
    render(<ReconciliationTile result={{ name: 'some_new_check', tolerance: 5, drift: 2, passed: true }} />);
    expect(screen.getByText('some new check')).toBeInTheDocument();
  });

  it('shows the drift count prominently when a check is failing', () => {
    render(<ReconciliationTile result={{ name: 'assets_without_serial', tolerance: 0, drift: 12, passed: false }} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Assets without a serial row')).toBeInTheDocument();
  });
});
