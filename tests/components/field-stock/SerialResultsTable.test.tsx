/** Tests for SerialResultsTable — count label, serial link, empty state. */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SerialResultsTable } from '@/components/field-stock/SerialResultsTable';
import type { SerialSearchRowView } from '@/types/field-stock';

const ROW: SerialSearchRowView = {
  id: 'r1', serialNumber: 'ALCLB4-001', macAddress: 'AA:BB', category: 'ONT', itemName: 'ONT',
  status: 'available', currentLocationName: 'Main WH', allocatedProjectName: 'Lawley',
  installedAtDropNumber: null, lastEventType: 'received', lastEventAt: '2026-05-25T00:00:00.000Z',
};

describe('SerialResultsTable', () => {
  it('renders a count label and links each serial to its timeline', () => {
    render(<SerialResultsTable rows={[ROW]} total={1} loading={false} error={null} />);
    expect(screen.getByText('1 result')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'ALCLB4-001' });
    expect(link).toHaveAttribute('href', '/procurement/field-stock/serials/ALCLB4-001');
  });

  it('shows the empty state when not loading and no rows', () => {
    render(<SerialResultsTable rows={[]} total={0} loading={false} error={null} />);
    expect(screen.getByText('No serials found.')).toBeInTheDocument();
  });

  it('shows the error banner when error is set', () => {
    render(<SerialResultsTable rows={[]} total={0} loading={false} error="boom" />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows Loading… while loading', () => {
    render(<SerialResultsTable rows={[]} total={0} loading error={null} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
