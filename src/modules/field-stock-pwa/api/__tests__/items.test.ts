/**
 * fetchIssuableStockItems — row mapping incl. trackingType/uom and the
 * no-trackingType-param query string.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestMock = vi.fn();
vi.mock('../request', () => ({ request: (...args: unknown[]) => requestMock(...args) }));

import { fetchIssuableStockItems } from '../items';

describe('fetchIssuableStockItems', () => {
  beforeEach(() => requestMock.mockReset());

  it('maps rows including trackingType and uom, parsing standard_cost', async () => {
    requestMock.mockResolvedValue([
      { id: 'i1', name: 'Cable ties', item_code: 'CABLETIE-2.5x100',
        tracking_type: 'quantity', uom: 'Units', standard_cost: '12.50' },
      { id: 'i2', name: 'FT-ONT', item_code: 'FT-ONT',
        tracking_type: 'serial', uom: 'Units', standard_cost: null },
    ]);
    const items = await fetchIssuableStockItems();
    expect(items).toEqual([
      { id: 'i1', name: 'Cable ties', sku: 'CABLETIE-2.5x100',
        trackingType: 'quantity', uom: 'Units', unitValueZar: 12.5 },
      { id: 'i2', name: 'FT-ONT', sku: 'FT-ONT',
        trackingType: 'serial', uom: 'Units', unitValueZar: null },
    ]);
  });

  it('omits trackingType from the query (all types) and passes search', async () => {
    requestMock.mockResolvedValue([]);
    await fetchIssuableStockItems({ search: 'cable' });
    const url = requestMock.mock.calls[0][0] as string;
    expect(url).toBe('/api/my/stores/items?search=cable');
  });
});
