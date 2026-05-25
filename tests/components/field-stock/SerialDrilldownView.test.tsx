/**
 * Tests for SerialDrilldownView — the headline correctness invariant
 * (fixed filter wins over user filters) and name derivation from results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SerialSearchFilters, SerialSearchRowView } from '@/types/field-stock';

const { useSerialSearchMock } = vi.hoisted(() => ({ useSerialSearchMock: vi.fn() }));
vi.mock('@/modules/procurement/field-stock/hooks/useSerialSearch', () => ({
  useSerialSearch: useSerialSearchMock,
}));

// Stub SerialSearch with a button that pushes a filter set including a rogue
// warehouseId the user must NOT be able to escape to.
vi.mock('@/components/field-stock/SerialSearch', () => ({
  SerialSearch: ({ onFiltersChange }: { onFiltersChange: (f: SerialSearchFilters) => void }) => (
    <button onClick={() => onFiltersChange({ q: 'abc', warehouseId: 'ROGUE' })}>apply-filters</button>
  ),
}));

import { SerialDrilldownView } from '@/components/field-stock/SerialDrilldownView';

const ROW: SerialSearchRowView = {
  id: 'r1', serialNumber: 'S1', macAddress: null, category: null, itemName: null,
  status: 'available', currentLocationName: 'Main WH', allocatedProjectName: null,
  installedAtDropNumber: null, lastEventType: null, lastEventAt: null,
};

function renderView() {
  return render(
    <SerialDrilldownView
      kicker="Warehouse"
      nameField="currentLocationName"
      fallbackHeading="w1-uuid"
      fixedFilter={{ warehouseId: 'w1' }}
      backHref="/procurement/field-stock/warehouses"
      backLabel="All warehouses"
    />
  );
}

describe('SerialDrilldownView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSerialSearchMock.mockReturnValue({ rows: [ROW], total: 1, loading: false, error: null });
  });

  it('bakes the fixed warehouseId into the initial search', () => {
    renderView();
    expect(useSerialSearchMock).toHaveBeenCalledWith({ warehouseId: 'w1' });
  });

  it('keeps the fixed filter even when the user supplies a different warehouseId', () => {
    renderView();
    fireEvent.click(screen.getByText('apply-filters'));
    const lastCall = useSerialSearchMock.mock.calls.at(-1)?.[0];
    // user q is honoured, but warehouseId stays pinned to the page's entity
    expect(lastCall).toEqual({ q: 'abc', warehouseId: 'w1' });
  });

  it('derives the heading from the first result row that carries the name', () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'Main WH' })).toBeInTheDocument();
  });

  it('falls back to the id when no row carries the name', () => {
    useSerialSearchMock.mockReturnValue({ rows: [], total: 0, loading: false, error: null });
    renderView();
    expect(screen.getByRole('heading', { name: 'w1-uuid' })).toBeInTheDocument();
  });
});
