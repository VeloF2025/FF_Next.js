/**
 * Tests for useScanSerial — scan-time location cross-check.
 *
 * A serial registered at a different warehouse than the selected source must
 * resolve to an invalid chip at scan time (naming both locations), instead of
 * sailing through and 422-ing at the final process step after the tech signed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScanSerial } from '../useScanSerial';
import type { PwaScannedSerial } from '../../types';

vi.mock('@/modules/field-stock-pwa/api', () => ({
  validateSerial: vi.fn(),
}));

import { validateSerial } from '@/modules/field-stock-pwa/api';
const validateSerialMock = vi.mocked(validateSerial);

const STOCK_ITEM = { id: 'item-ont', name: 'FT-ONT' };
const GARSTFONTEIN = { id: 'loc-garst', name: 'Garstfontein DC' };

function lastChange(onChange: ReturnType<typeof vi.fn>): PwaScannedSerial[] {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]![0] as PwaScannedSerial[];
}

describe('useScanSerial location cross-check', () => {
  beforeEach(() => {
    validateSerialMock.mockReset();
  });

  it('marks a serial invalid when it is registered at another warehouse', async () => {
    validateSerialMock.mockResolvedValueOnce({
      valid: true,
      stockItemId: 'item-ont',
      stockItemName: 'FT-ONT',
      currentLocationId: 'loc-lawley',
      currentLocationName: 'Lawley',
    });
    const onChange = vi.fn();

    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN })
    );
    await act(async () => {
      await result.current.handleRawSerial('ALCLB465A813');
    });

    const rows = lastChange(onChange);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('invalid');
    expect(rows[0]!.errorMessage).toContain('Lawley');
    expect(rows[0]!.errorMessage).toContain('Garstfontein DC');
  });

  it('marks a serial valid when its location matches the source warehouse', async () => {
    validateSerialMock.mockResolvedValueOnce({
      valid: true,
      stockItemId: 'item-ont',
      stockItemName: 'FT-ONT',
      currentLocationId: 'loc-garst',
      currentLocationName: 'Garstfontein DC',
    });
    const onChange = vi.fn();

    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN })
    );
    await act(async () => {
      await result.current.handleRawSerial('ALCLB465A813');
    });

    const rows = lastChange(onChange);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('valid');
  });

  it('accepts a serial with no recorded location (missing data is not a contradiction)', async () => {
    validateSerialMock.mockResolvedValueOnce({
      valid: true,
      stockItemId: 'item-ont',
      stockItemName: 'FT-ONT',
      currentLocationId: undefined,
      currentLocationName: undefined,
    });
    const onChange = vi.fn();

    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN })
    );
    await act(async () => {
      await result.current.handleRawSerial('ALCLB465A813');
    });

    expect(lastChange(onChange)[0]!.state).toBe('valid');
  });

  it('skips the location check when no sourceLocation is provided (back-compat)', async () => {
    validateSerialMock.mockResolvedValueOnce({
      valid: true,
      stockItemId: 'item-ont',
      stockItemName: 'FT-ONT',
      currentLocationId: 'loc-lawley',
      currentLocationName: 'Lawley',
    });
    const onChange = vi.fn();

    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange })
    );
    await act(async () => {
      await result.current.handleRawSerial('ALCLB465A813');
    });

    expect(lastChange(onChange)[0]!.state).toBe('valid');
  });

  it('still rejects wrong-item serials before the location check', async () => {
    validateSerialMock.mockResolvedValueOnce({
      valid: true,
      stockItemId: 'item-gizzu',
      stockItemName: 'FT-GIZZU',
      currentLocationId: 'loc-lawley',
      currentLocationName: 'Lawley',
    });
    const onChange = vi.fn();

    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN })
    );
    await act(async () => {
      await result.current.handleRawSerial('GU18W12V2512041619');
    });

    const rows = lastChange(onChange);
    expect(rows[0]!.state).toBe('invalid');
    expect(rows[0]!.errorMessage).toContain('Wrong stock item');
  });
});
