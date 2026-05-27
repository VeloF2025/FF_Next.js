/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoresTodayList } from '../StoresTodayList';
import type { StoresTodayRow } from '@/modules/field-stock-pwa/services/storesTodayService';

function makeRow(overrides: Partial<StoresTodayRow> = {}): StoresTodayRow {
  return {
    technician_id: 't-1',
    technician_name: 'Sipho M',
    issued_count: 3,
    issued_value_rand: 4500,
    installed_count: 1,
    returned_count: 0,
    unaccounted_count: 2,
    ...overrides,
  };
}

describe('StoresTodayList', () => {
  it('renders empty state when no rows', () => {
    render(<StoresTodayList rows={[]} />);
    expect(screen.getByText(/no stock issued today/i)).toBeInTheDocument();
  });

  it('renders one row per technician with all four stats', () => {
    render(<StoresTodayList rows={[makeRow()]} />);
    expect(screen.getByText('Sipho M')).toBeInTheDocument();
    // en-ZA locale uses U+00A0 (non-breaking space) as thousands separator;
    // match flexibly so the test isn't tied to a specific NBSP rendering.
    expect(screen.getByText(/R4\s?500/)).toBeInTheDocument();
    expect(screen.getByText('Issued')).toBeInTheDocument();
    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(screen.getByText('Returned')).toBeInTheDocument();
    expect(screen.getByText('Unaccounted')).toBeInTheDocument();
  });

  it('falls back to "Unknown" when technician_name is empty', () => {
    render(<StoresTodayList rows={[makeRow({ technician_name: '' })]} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('emphasises unaccounted stat in red when > 0', () => {
    const { container } = render(<StoresTodayList rows={[makeRow({ unaccounted_count: 5 })]} />);
    // The Stat with the highlighted value gets text-red-400.
    const reds = container.querySelectorAll('.text-red-400');
    expect(reds.length).toBeGreaterThan(0);
  });

  it('alerts the row container when unaccounted_count exceeds the 3-item threshold', () => {
    const { container } = render(<StoresTodayList rows={[makeRow({ unaccounted_count: 4 })]} />);
    const alertingRow = container.querySelector('li.border-red-800');
    expect(alertingRow).not.toBeNull();
  });

  it('alerts the row container when pro-rated unaccounted value exceeds R5000', () => {
    // 10 issued, 0 installed/returned, R10000 issued → R10000 unaccounted (>R5000), 10 count (>3)
    const { container } = render(
      <StoresTodayList
        rows={[
          makeRow({
            issued_count: 10,
            installed_count: 0,
            returned_count: 0,
            unaccounted_count: 10,
            issued_value_rand: 10000,
          }),
        ]}
      />
    );
    const alertingRow = container.querySelector('li.border-red-800');
    expect(alertingRow).not.toBeNull();
  });

  it('does NOT alert when fully accounted (zero unaccounted)', () => {
    const { container } = render(
      <StoresTodayList rows={[makeRow({ unaccounted_count: 0, installed_count: 3, returned_count: 0 })]} />
    );
    const alertingRow = container.querySelector('li.border-red-800');
    expect(alertingRow).toBeNull();
  });
});
