/**
 * Tests for HolderDetailDrawer.
 *
 * Covers:
 * - Renders nothing when holderId is null (closed)
 * - Fetches and renders holder name, per-project breakdown (Unassigned for NULL),
 *   aging buckets, oldest-held age, custody and serial lists
 * - Close button invokes onClose
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HolderDetailDrawer } from '../HolderDetailDrawer';

const DETAIL_ROW = {
  holder_id: 'h-1',
  holder_type: 'staff',
  staff_id: 's-1',
  contractor_id: null,
  name: 'Louis Ellis',
  is_active: true,
  issued_count: '10',
  issued_value: '1000.00',
  consumed_count: '0',
  consumed_value: '0',
  returned_count: '0',
  returned_value: '0',
  held_count: '4',
  held_value: '400.50',
  unaccounted_count: '0',
  is_blocked: false,
  blocked_reason: null,
  blocked_at: null,
  blocked_by: null,
  pending_recovery_amount: '0',
  recovered_amount: '0',
  held_age_0_7: '1',
  held_age_8_30: '1',
  held_age_31_plus: '2',
  oldest_held_days: '45',
  oldest_held_at: '2026-04-27T00:00:00.000Z',
  custody: [
    { stock_item_id: 'i-1', item_code: 'CBL-1', item_name: 'Drop Cable', lot_number: 'LOT-9', quantity: '3', total_value: '150.00' },
  ],
  serials: [
    { id: 'sr-1', serial_number: 'ALCLB4XYZ', stock_item_id: 'i-2', status: 'issued' },
  ],
  projectBreakdown: [
    { project_id: 'p-1', project_name: 'Mohadin', held_count: '3', held_value: '300.00' },
    { project_id: null, project_name: null, held_count: '1', held_value: '100.50' },
  ],
};

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body } as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HolderDetailDrawer', () => {
  it('renders nothing when holderId is null', () => {
    const fetchMock = mockFetchOk({ data: DETAIL_ROW });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<HolderDetailDrawer holderId={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and renders the holder detail', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ data: DETAIL_ROW }));
    render(<HolderDetailDrawer holderId="h-1" fallbackName="Louis Ellis" onClose={vi.fn()} />);

    // Wait for the body to render (per-project breakdown), including the
    // Unassigned row for the NULL project. The heading would resolve early off
    // fallbackName, so we gate on body content instead.
    await waitFor(() => expect(screen.getByText('Mohadin')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Louis Ellis' })).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();

    // Aging bucket labels + oldest-held age.
    expect(screen.getByText('30+ days')).toBeTruthy();
    expect(screen.getByText('45d')).toBeTruthy();

    // Custody + serials.
    expect(screen.getByText('Drop Cable')).toBeTruthy();
    expect(screen.getByText('ALCLB4XYZ')).toBeTruthy();
  });

  it('invokes onClose when the close button is clicked', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ data: DETAIL_ROW }));
    const onClose = vi.fn();
    render(<HolderDetailDrawer holderId="h-1" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Louis Ellis' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
