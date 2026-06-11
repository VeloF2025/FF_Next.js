/**
 * @vitest-environment jsdom
 */
/**
 * EnterQuantityStep — quantity entry for non-serial issues.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnterQuantityStep } from '../EnterQuantityStep';

const ITEM = {
  id: 'i1', name: 'Cable ties', sku: 'CABLETIE-2.5x100',
  trackingType: 'quantity' as const, uom: 'Units', unitValueZar: 12.5,
};

describe('EnterQuantityStep', () => {
  it('disables Continue at quantity 0 and propagates a positive quantity', () => {
    const onDone = vi.fn();
    const onChange = vi.fn();
    render(<EnterQuantityStep stockItem={ITEM} quantity={0} onChange={onChange} onDone={onDone} />);
    const btn = screen.getByRole('button', { name: /continue/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '25' } });
    expect(onChange).toHaveBeenCalledWith(25);
  });

  it('shows the uom and rejects negative input', () => {
    const onChange = vi.fn();
    render(<EnterQuantityStep stockItem={ITEM} quantity={5} onChange={onChange} onDone={vi.fn()} />);
    expect(screen.getByText('Units')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '-3' } });
    expect(onChange).not.toHaveBeenCalledWith(-3);
  });

  it('enables Continue with a positive quantity and calls onDone', () => {
    const onDone = vi.fn();
    render(<EnterQuantityStep stockItem={ITEM} quantity={5} onChange={vi.fn()} onDone={onDone} />);
    const btn = screen.getByRole('button', { name: /continue/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onDone).toHaveBeenCalled();
  });
});
