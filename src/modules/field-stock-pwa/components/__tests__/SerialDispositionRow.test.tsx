/**
 * Tests for SerialDispositionRow.
 *
 * Covers:
 * - Tapping a condition button calls onChange with that condition
 * - Tapping a disposition button calls onChange with that disposition
 * - Notes textarea appears only when disposition is 'repair' or 'scrap'
 * - Typing in notes calls onChange with new notes value
 * - ARIA role="radio" and aria-checked on each button
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SerialDispositionRow } from '../SerialDispositionRow';
import { CONDITION_OPTIONS } from '../../lib/conditionOptions';
import { DISPOSITION_OPTIONS } from '../../lib/dispositionOptions';

const BASE_PROPS = {
  lineId: 'line-001',
  serialNumber: 'SN-TEST-001',
  stockItemName: 'ONT XS-010X-Q',
  condition: null,
  disposition: null,
  notes: '',
};

describe('SerialDispositionRow', () => {
  it('renders serial number and stock item name', () => {
    render(<SerialDispositionRow {...BASE_PROPS} onChange={vi.fn()} />);
    expect(screen.getByText('SN-TEST-001')).toBeTruthy();
    expect(screen.getByText('ONT XS-010X-Q')).toBeTruthy();
  });

  it('renders all condition buttons with role="radio"', () => {
    render(<SerialDispositionRow {...BASE_PROPS} onChange={vi.fn()} />);
    for (const opt of CONDITION_OPTIONS) {
      const btn = screen.getByRole('radio', { name: opt.label });
      expect(btn).toBeTruthy();
    }
  });

  it('renders all disposition buttons with role="radio"', () => {
    render(<SerialDispositionRow {...BASE_PROPS} onChange={vi.fn()} />);
    for (const opt of DISPOSITION_OPTIONS) {
      const btn = screen.getByRole('radio', { name: opt.label });
      expect(btn).toBeTruthy();
    }
  });

  it('tapping a condition button calls onChange with that condition', () => {
    const onChange = vi.fn();
    render(<SerialDispositionRow {...BASE_PROPS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Good' }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      condition: 'good',
      disposition: null,
      notes: '',
    });
  });

  it('tapping a condition button preserves existing disposition and notes', () => {
    const onChange = vi.fn();
    render(
      <SerialDispositionRow
        {...BASE_PROPS}
        condition="damaged"
        disposition="repair"
        notes="cracked housing"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Non-functional' }));
    expect(onChange).toHaveBeenCalledWith({
      condition: 'non_functional',
      disposition: 'repair',
      notes: 'cracked housing',
    });
  });

  it('tapping a disposition button calls onChange with that disposition', () => {
    const onChange = vi.fn();
    render(<SerialDispositionRow {...BASE_PROPS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Restock' }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      condition: null,
      disposition: 'restock',
      notes: '',
    });
  });

  it('tapping a disposition button preserves existing condition', () => {
    const onChange = vi.fn();
    render(
      <SerialDispositionRow
        {...BASE_PROPS}
        condition="good"
        disposition={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Scrap' }));
    expect(onChange).toHaveBeenCalledWith({
      condition: 'good',
      disposition: 'scrap',
      notes: '',
    });
  });

  it('aria-checked is true only on the selected condition', () => {
    render(
      <SerialDispositionRow {...BASE_PROPS} condition="damaged" onChange={vi.fn()} />,
    );
    expect(screen.getByRole('radio', { name: 'Damaged' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Good' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Non-functional' })).toHaveAttribute('aria-checked', 'false');
  });

  it('aria-checked is true only on the selected disposition', () => {
    render(
      <SerialDispositionRow {...BASE_PROPS} disposition="scrap" onChange={vi.fn()} />,
    );
    expect(screen.getByRole('radio', { name: 'Scrap' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Restock' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Repair' })).toHaveAttribute('aria-checked', 'false');
  });

  it('notes textarea is NOT shown when disposition is null', () => {
    render(<SerialDispositionRow {...BASE_PROPS} onChange={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('notes textarea is NOT shown when disposition is restock', () => {
    render(
      <SerialDispositionRow {...BASE_PROPS} disposition="restock" onChange={vi.fn()} />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('notes textarea IS shown when disposition is repair', () => {
    render(
      <SerialDispositionRow {...BASE_PROPS} disposition="repair" onChange={vi.fn()} />,
    );
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('notes textarea IS shown when disposition is scrap', () => {
    render(
      <SerialDispositionRow {...BASE_PROPS} disposition="scrap" onChange={vi.fn()} />,
    );
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('typing in notes calls onChange with the new notes value', () => {
    const onChange = vi.fn();
    render(
      <SerialDispositionRow
        {...BASE_PROPS}
        condition="damaged"
        disposition="repair"
        notes=""
        onChange={onChange}
      />,
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'cracked screen' } });
    expect(onChange).toHaveBeenCalledWith({
      condition: 'damaged',
      disposition: 'repair',
      notes: 'cracked screen',
    });
  });
});
