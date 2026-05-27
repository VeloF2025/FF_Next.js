/**
 * Tests for DashboardV2QuickActions — the tab-jump shortcuts carried over from the
 * legacy FieldStockDashboard when v2 was promoted to the default Dashboard tab.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardV2QuickActions } from '@/components/field-stock/dashboard-v2/DashboardV2QuickActions';

describe('DashboardV2QuickActions', () => {
  it('renders the four shortcut buttons', () => {
    render(<DashboardV2QuickActions onNavigate={vi.fn()} />);
    expect(screen.getByText('Issue Stock')).toBeInTheDocument();
    expect(screen.getByText('Record Consumption')).toBeInTheDocument();
    expect(screen.getByText('Process Return')).toBeInTheDocument();
    expect(screen.getByText('Manage Locations')).toBeInTheDocument();
  });

  it('calls onNavigate with the correct tab for each shortcut', () => {
    const onNavigate = vi.fn();
    render(<DashboardV2QuickActions onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('Issue Stock'));
    fireEvent.click(screen.getByText('Record Consumption'));
    fireEvent.click(screen.getByText('Process Return'));
    fireEvent.click(screen.getByText('Manage Locations'));

    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual([
      'pickings',
      'consumptions',
      'returns',
      'locations',
    ]);
  });
});
