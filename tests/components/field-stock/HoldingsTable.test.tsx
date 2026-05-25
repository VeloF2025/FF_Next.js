/** Tests for HoldingsTable — entity count label, row links, sublabel, empty state. */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoldingsTable, type HoldingRow } from '@/components/field-stock/HoldingsTable';

const ROWS: HoldingRow[] = [
  { href: '/procurement/field-stock/warehouses/w1', label: 'Main WH', sublabel: 'WH-1 · warehouse', count: 12 },
];

describe('HoldingsTable', () => {
  it('renders the pluralised entity count and a link per row', () => {
    render(<HoldingsTable rows={ROWS} loading={false} error={null} entityHeader="Warehouse" emptyLabel="none" />);
    expect(screen.getByText('1 warehouse')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Main WH' });
    expect(link).toHaveAttribute('href', '/procurement/field-stock/warehouses/w1');
    expect(screen.getByText('WH-1 · warehouse')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows the empty label when not loading and no rows', () => {
    render(<HoldingsTable rows={[]} loading={false} error={null} entityHeader="Project" emptyLabel="No projects." />);
    expect(screen.getByText('No projects.')).toBeInTheDocument();
    expect(screen.getByText('0 projects')).toBeInTheDocument();
  });

  it('shows the error banner when error is set', () => {
    render(<HoldingsTable rows={[]} loading={false} error="db down" entityHeader="Warehouse" emptyLabel="none" />);
    expect(screen.getByText('db down')).toBeInTheDocument();
  });

  it('shows Loading… instead of a count while loading', () => {
    render(<HoldingsTable rows={[]} loading error={null} entityHeader="Warehouse" emptyLabel="none" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
