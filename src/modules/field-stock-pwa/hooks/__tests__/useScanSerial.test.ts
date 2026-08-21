/**
 * Tests for useScanSerial — scan-time location cross-check.
 *
 * A serial recorded at a different warehouse than the selected source is
 * ALLOWED and flagged, naming both locations. It used to be refused, but that
 * location is an assumption from a workbook tab which predicts the real site
 * 27.5% of the time (measured 2026-08-21), and stock genuinely moves between
 * sites — refusing blocked real work over a guess.
 *
 * The original reason for checking at scan time still holds: the storeman must
 * learn about it BEFORE the technician signs, not via a 422 afterwards.
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

  it('allows and FLAGS a serial recorded at another warehouse', async () => {
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
    expect(rows[0]!.state).toBe('valid');
    // Flagged, not blocked — and it still names both sites, before signing.
    expect(rows[0]!.warning).toContain('Lawley');
    expect(rows[0]!.warning).toContain('Garstfontein DC');
    expect(rows[0]!.errorMessage).toBeUndefined();
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
