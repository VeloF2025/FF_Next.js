import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScopeChipPicker } from '../ScopeChipPicker';

describe('ScopeChipPicker', () => {
  it('renders chips for each option', () => {
    render(<ScopeChipPicker<number> label="Zones" options={[1, 2, 3]} selected={[]} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
  });

  it('marks selected chips visually (aria-pressed=true)', () => {
    render(<ScopeChipPicker<number> label="Zones" options={[1, 2, 3]} selected={[2]} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles selection on click', () => {
    const onChange = vi.fn();
    render(<ScopeChipPicker<number> label="Zones" options={[1, 2, 3]} selected={[1]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(onChange).toHaveBeenCalledWith([1, 2]);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows filter input when options > 8', () => {
    const opts = Array.from({ length: 12 }, (_, i) => i + 1);
    render(<ScopeChipPicker<number> label="PONs" options={opts} selected={[]} onChange={() => {}} />);
    expect(screen.getByPlaceholderText(/filter/i)).toBeInTheDocument();
  });

  it('disabled prop blocks clicks and onChange', () => {
    const onChange = vi.fn();
    render(<ScopeChipPicker<number> label="Zones" options={[1]} selected={[]} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
