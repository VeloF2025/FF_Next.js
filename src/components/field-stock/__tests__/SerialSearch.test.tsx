/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SerialSearch } from '../SerialSearch';

describe('SerialSearch', () => {
  it('renders search input prefilled from initialFilters.q', () => {
    render(
      <SerialSearch
        initialFilters={{ q: 'SN-12345' }}
        onFiltersChange={vi.fn()}
      />
    );
    const input = screen.getByRole('searchbox', { name: /serial or mac/i }) as HTMLInputElement;
    expect(input.value).toBe('SN-12345');
  });
});

describe('SerialSearch debounce', () => {
  it('fires onFiltersChange once after 300ms of no typing', async () => {
    vi.useFakeTimers();
    const onFiltersChange = vi.fn();
    render(<SerialSearch initialFilters={{}} onFiltersChange={onFiltersChange} />);
    const input = screen.getByRole('searchbox') as HTMLInputElement;

    await vi.advanceTimersByTimeAsync(300);
    onFiltersChange.mockClear();

    fireEvent.change(input, { target: { value: 'SN-1' } });
    fireEvent.change(input, { target: { value: 'SN-12' } });
    await vi.advanceTimersByTimeAsync(150);
    expect(onFiltersChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith({ q: 'SN-12' });
    vi.useRealTimers();
  });
});

describe('SerialSearch status multi-select', () => {
  it('toggles status filter values', async () => {
    vi.useFakeTimers();
    const onFiltersChange = vi.fn();
    render(<SerialSearch initialFilters={{}} onFiltersChange={onFiltersChange} />);
    await vi.advanceTimersByTimeAsync(300);
    onFiltersChange.mockClear();

    fireEvent.click(screen.getByRole('checkbox', { name: /available/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /installed/i }));
    await vi.advanceTimersByTimeAsync(300);

    expect(onFiltersChange).toHaveBeenLastCalledWith({ status: ['available', 'installed'] });
    vi.useRealTimers();
  });
});

describe('SerialSearch category', () => {
  it('renders categories from prop', () => {
    render(<SerialSearch initialFilters={{}} onFiltersChange={vi.fn()} categories={['ONT', 'GIZZU']} />);
    const select = screen.getByRole('combobox', { name: /category/i }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'ONT', 'GIZZU']);
  });
});
