/**
 * Tests for HolderAccountabilityList — focused on the new onSelect entry point
 * that opens the holder-detail drawer.
 *
 * Covers:
 * - When onSelect is provided, the holder name is a button that calls onSelect
 *   with the holder_id (the drawer's entry point).
 * - When onSelect is omitted, the name renders as plain text (no button).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HolderAccountabilityList } from '../HolderAccountabilityList';
import type { HolderAccountability } from '../../../hooks/useHolderAccountability';

const HOLDER: HolderAccountability = {
  holder_id: 'h-1',
  holder_type: 'staff',
  staff_id: 's-1',
  contractor_id: null,
  name: 'Louis Ellis',
  is_active: true,
  issued_count: 10,
  issued_value: 1000,
  consumed_count: 0,
  consumed_value: 0,
  returned_count: 0,
  returned_value: 0,
  held_count: 4,
  held_value: 400.5,
  unaccounted_count: 0,
  is_blocked: false,
  blocked_reason: null,
  blocked_at: null,
  blocked_by: null,
  pending_recovery_amount: 0,
  recovered_amount: 0,
  held_age_0_7: 1,
  held_age_8_30: 1,
  held_age_31_plus: 2,
  oldest_held_days: 45,
  oldest_held_at: '2026-04-27T00:00:00.000Z',
};

describe('HolderAccountabilityList — onSelect', () => {
  it('renders the holder name as a button that calls onSelect with holder_id', () => {
    const onSelect = vi.fn();
    render(<HolderAccountabilityList holders={[HOLDER]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Louis Ellis' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('h-1');
  });

  it('renders the holder name as plain text when onSelect is omitted', () => {
    render(<HolderAccountabilityList holders={[HOLDER]} />);
    expect(screen.queryByRole('button', { name: 'Louis Ellis' })).toBeNull();
    expect(screen.getByText('Louis Ellis')).toBeTruthy();
  });
});
