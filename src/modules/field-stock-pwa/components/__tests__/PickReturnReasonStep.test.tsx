/**
 * Tests for PickReturnReasonStep.
 *
 * Covers:
 * - Continue button disabled until a reason is picked
 * - Emits the picked reason on Continue
 * - Initial value pre-selects a reason
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PickReturnReasonStep } from '../PickReturnReasonStep';
import { RETURN_REASONS } from '../../lib/returnReasons';

vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('PickReturnReasonStep', () => {
  it('renders all return reason options', () => {
    render(<PickReturnReasonStep initial={null} onPick={vi.fn()} />);
    for (const r of RETURN_REASONS) {
      expect(screen.getByText(r.label)).toBeTruthy();
    }
  });

  it('Continue button is disabled when no reason selected', () => {
    render(<PickReturnReasonStep initial={null} onPick={vi.fn()} />);
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeDisabled();
  });

  it('enables Continue after a reason is picked', () => {
    render(<PickReturnReasonStep initial={null} onPick={vi.fn()} />);
    const firstOption = screen.getByRole('button', { name: RETURN_REASONS[0].label });
    fireEvent.click(firstOption);
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).not.toBeDisabled();
  });

  it('emits the picked reason on Continue', () => {
    const onPick = vi.fn();
    render(<PickReturnReasonStep initial={null} onPick={onPick} />);
    const targetReason = RETURN_REASONS[2]; // wrong_item
    fireEvent.click(screen.getByRole('button', { name: targetReason.label }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith(targetReason.code);
  });

  it('pre-selects the initial reason', () => {
    const initial = RETURN_REASONS[1].code; // job_cancelled
    render(<PickReturnReasonStep initial={initial} onPick={vi.fn()} />);
    const preSelected = screen.getByRole('button', { name: RETURN_REASONS[1].label });
    expect(preSelected).toHaveAttribute('aria-pressed', 'true');
    // Continue should be enabled immediately
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).not.toBeDisabled();
  });

  it('only marks the selected button as aria-pressed=true', () => {
    render(<PickReturnReasonStep initial={null} onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: RETURN_REASONS[0].label }));
    for (const r of RETURN_REASONS) {
      const btn = screen.getByRole('button', { name: r.label });
      expect(btn).toHaveAttribute(
        'aria-pressed',
        r.code === RETURN_REASONS[0].code ? 'true' : 'false',
      );
    }
  });
});
