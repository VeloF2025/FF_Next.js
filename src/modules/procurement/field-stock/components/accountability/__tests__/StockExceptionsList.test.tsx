/**
 * Tests for StockExceptionsList.
 *
 * Covers:
 * - Renders a row per exception with class badge, serial, Unassigned project, aged days
 * - Cross-DR row shows the "WA ≠ OES" drop annotation
 * - Holder name calls onSelectHolder with holder_id
 * - Class filter narrows the list
 * - Empty state when no exceptions
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StockExceptionsList } from '../StockExceptionsList';
import type { StockException } from '../../../hooks/useStockExceptions';

const base: Omit<StockException, 'serial_id' | 'serial_number' | 'exception_class' | 'held_days'> = {
  status: 'issued',
  holder_id: 'h-1',
  holder_type: 'staff',
  holder_name: 'Louis Ellis',
  stock_item_id: 'i-1',
  item_code: 'FT-ONT',
  item_name: 'Nokia ONT',
  project_id: null,
  project_name: null,
  held_since: '2026-04-27T00:00:00.000Z',
  wa_drop: null,
  oes_drop: null,
  oes_status: null,
  oes_activation_date: null,
};

const AGED: StockException = { ...base, serial_id: 's-1', serial_number: 'ALCLB491AA22', held_days: 45, exception_class: 'aged_no_evidence' };
const CROSS: StockException = {
  ...base, serial_id: 's-2', serial_number: 'ALCLB492BB33', holder_id: 'h-2', holder_name: 'TestTech',
  held_days: 12, exception_class: 'cross_dr_conflict', wa_drop: 'DR111', oes_drop: 'DR222',
};

describe('StockExceptionsList', () => {
  it('renders a row per exception with class badge, serial, Unassigned project and aged days', () => {
    render(<StockExceptionsList exceptions={[AGED]} onSelectHolder={vi.fn()} />);
    expect(screen.getByText('ALCLB491AA22')).toBeTruthy();
    // Class label appears both as a row badge (span) and a filter <option>; target the badge.
    expect(screen.getByText('Aged, no evidence', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
    expect(screen.getByText('45d')).toBeTruthy();
  });

  it('annotates a cross-DR conflict with the WA ≠ OES drops', () => {
    render(<StockExceptionsList exceptions={[CROSS]} onSelectHolder={vi.fn()} />);
    expect(screen.getByText('Cross-DR', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText(/WA DR111 ≠ OES DR222/)).toBeTruthy();
  });

  it('calls onSelectHolder with the holder_id when the name is clicked', () => {
    const onSelectHolder = vi.fn();
    render(<StockExceptionsList exceptions={[AGED]} onSelectHolder={onSelectHolder} />);
    fireEvent.click(screen.getByRole('button', { name: 'Louis Ellis' }));
    expect(onSelectHolder).toHaveBeenCalledWith('h-1');
  });

  it('class filter narrows the visible rows', () => {
    render(<StockExceptionsList exceptions={[AGED, CROSS]} onSelectHolder={vi.fn()} />);
    // Both present initially
    expect(screen.getByText('ALCLB491AA22')).toBeTruthy();
    expect(screen.getByText('ALCLB492BB33')).toBeTruthy();

    // Filter to cross_dr_conflict (the class <select> is the one with the "All Classes" option)
    const classSelect = screen.getByRole('combobox');
    fireEvent.change(classSelect, { target: { value: 'cross_dr_conflict' } });

    expect(screen.queryByText('ALCLB491AA22')).toBeNull();
    expect(screen.getByText('ALCLB492BB33')).toBeTruthy();
  });

  it('shows an empty state when there are no exceptions', () => {
    render(<StockExceptionsList exceptions={[]} onSelectHolder={vi.fn()} />);
    expect(screen.getByText('No exceptions found')).toBeTruthy();
  });
});
