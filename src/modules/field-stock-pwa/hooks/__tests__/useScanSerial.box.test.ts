/**
 * Tests for useScanSerial's carton-scan path.
 *
 * One scan of a Nokia box code must expand into N grouped chips validated in a
 * single batch call. A partial box keeps its good members — a data problem must
 * never block the handout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useScanSerial } from '../useScanSerial';
import type { PwaScannedSerial } from '../../types';

vi.mock('@/modules/field-stock-pwa/api', () => ({
  validateSerial: vi.fn(),
  validateSerialBatch: vi.fn(),
}));

import { validateSerial, validateSerialBatch } from '@/modules/field-stock-pwa/api';
const validateSerialMock = vi.mocked(validateSerial);
const validateSerialBatchMock = vi.mocked(validateSerialBatch);

const STOCK_ITEM = { id: 'item-ont', name: 'FT-ONT' };
const GARSTFONTEIN = { id: 'loc-garst', name: 'Garstfontein DC' };
const BOX = 'ALCLB49486FF;ALCLB4948758;ALCLB4948779';
const PACKAGE_DATA = '[)>\x1e06\x1d1P3TN01414BA\x1dQ9\x1d3SM022540C0126A10210\x1e\x04';

function lastChange(onChange: ReturnType<typeof vi.fn>): PwaScannedSerial[] {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]![0] as PwaScannedSerial[];
}

describe('useScanSerial carton scans', () => {
  beforeEach(() => {
    validateSerialMock.mockReset();
    validateSerialBatchMock.mockReset();
  });

  it('expands a box code into one chip per serial in a single batch call', async () => {
    validateSerialBatchMock.mockResolvedValueOnce({
      results: [
        { serialNumber: 'ALCLB49486FF', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        { serialNumber: 'ALCLB4948758', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        { serialNumber: 'ALCLB4948779', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
      ],
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(BOX); });

    expect(validateSerialBatchMock).toHaveBeenCalledTimes(1);
    expect(validateSerialMock).not.toHaveBeenCalled();
    const rows = lastChange(onChange);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === 'valid')).toBe(true);
    const groupIds = new Set(rows.map((r) => r.groupId));
    expect(groupIds.size).toBe(1);
    expect(rows[0]!.groupLabel).toBe('Box · 3 serials');
  });

  it('keeps the good members of a partial box and flags the rest', async () => {
    validateSerialBatchMock.mockResolvedValueOnce({
      results: [
        { serialNumber: 'ALCLB49486FF', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        { serialNumber: 'ALCLB4948758', valid: false, errorMessage: 'Serial is not available (status: issued)' },
        { serialNumber: 'ALCLB4948779', valid: false, errorMessage: 'Serial is at Lawley, not Garstfontein DC' },
      ],
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(BOX); });

    const rows = lastChange(onChange);
    expect(rows.filter((r) => r.state === 'valid')).toHaveLength(1);
    expect(rows.filter((r) => r.state === 'invalid')).toHaveLength(2);
    expect(rows[1]!.errorMessage).toContain('status: issued');
  });

  it('marks every member invalid when the batch call fails outright', async () => {
    validateSerialBatchMock.mockRejectedValueOnce(new Error('Network down'));
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(BOX); });

    const rows = lastChange(onChange);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === 'invalid')).toBe(true);
    expect(rows[0]!.errorMessage).toBe('Network down');
  });

  it('skips serials already scanned, batching only the new ones', async () => {
    validateSerialBatchMock.mockResolvedValueOnce({
      results: [{ serialNumber: 'ALCLB4948758', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' }],
    });
    const existing: PwaScannedSerial[] = [{
      serialNumber: 'ALCLB49486FF', stockItemId: 'item-ont', stockItemName: 'FT-ONT',
      scannedAt: 1, state: 'valid',
    }];
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: existing, onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial('ALCLB49486FF;ALCLB4948758'); });

    expect(validateSerialBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ serials: ['ALCLB4948758'] }),
    );
    expect(lastChange(onChange)).toHaveLength(2);
  });

  it('tells the storeman which square to scan when he scans the data code', async () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(PACKAGE_DATA); });

    await waitFor(() => {
      expect(result.current.scanNotice).toBe(
        "That's the data code. Scan the large square marked FULL SERIAL NUMBER LIST.",
      );
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(validateSerialBatchMock).not.toHaveBeenCalled();
  });

  it('warns when the box read is short of the quantity the label declares', async () => {
    validateSerialBatchMock.mockResolvedValueOnce({
      results: [
        { serialNumber: 'ALCLB49486FF', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        { serialNumber: 'ALCLB4948758', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        { serialNumber: 'ALCLB4948779', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
      ],
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    // The storeman scans the small data square first (Q9), then the box code,
    // which only yields three serials — a short read the label can prove.
    await act(async () => { await result.current.handleRawSerial(PACKAGE_DATA); });
    await act(async () => { await result.current.handleRawSerial(BOX); });

    await waitFor(() => {
      expect(result.current.scanNotice).toBe('Label says 9, read 3 — rescan the box.');
    });
  });

  it('stays quiet when the box read matches the declared quantity', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `ALCLB4948${String(i).padStart(3, '0')}A`);
    validateSerialBatchMock.mockResolvedValueOnce({
      results: nine.map((serialNumber) => ({
        serialNumber, valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT',
      })),
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(PACKAGE_DATA); });
    await act(async () => { await result.current.handleRawSerial(nine.join(';')); });

    expect(result.current.scanNotice).toBeNull();
  });

  it('refuses a box larger than the cap instead of firing a huge request', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `ALCLB4948${String(i).padStart(4, '0')}`).join(';');
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(many); });

    await waitFor(() => { expect(result.current.scanNotice).toContain('60 serials'); });
    expect(validateSerialBatchMock).not.toHaveBeenCalled();
  });

  it('removes every member of a group at once', async () => {
    const rows: PwaScannedSerial[] = [
      { serialNumber: 'A1', stockItemId: 'i', stockItemName: 'n', scannedAt: 1, state: 'valid', groupId: 'g1', groupLabel: 'Box · 2 serials' },
      { serialNumber: 'A2', stockItemId: 'i', stockItemName: 'n', scannedAt: 1, state: 'valid', groupId: 'g1', groupLabel: 'Box · 2 serials' },
      { serialNumber: 'B1', stockItemId: 'i', stockItemName: 'n', scannedAt: 2, state: 'valid' },
    ];
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: rows, onChange, sourceLocation: GARSTFONTEIN }),
    );

    act(() => { result.current.handleRemoveGroup('g1'); });

    expect(onChange).toHaveBeenCalledWith([rows[2]]);
  });

  it('still validates a single serial one at a time', async () => {
    validateSerialMock.mockResolvedValueOnce({
      valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT',
      currentLocationId: 'loc-garst', currentLocationName: 'Garstfontein DC',
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial('ALCLB4949F3C'); });

    expect(validateSerialMock).toHaveBeenCalledTimes(1);
    expect(validateSerialBatchMock).not.toHaveBeenCalled();
    expect(lastChange(onChange)[0]!.groupId).toBeUndefined();
  });
});

/**
 * Overlapping scans — the lost-update regression.
 *
 * Validation is async. A storeman scanning a second carton while the first is
 * still validating must not lose either one. This models the real component
 * wiring: onChange feeds back into the hook's `scanned` prop, exactly as
 * IssueOrchestrator's setFlow does.
 */
describe('useScanSerial overlapping scans', () => {
  beforeEach(() => {
    validateSerialMock.mockReset();
    validateSerialBatchMock.mockReset();
  });

  it('keeps both cartons when a second box is scanned mid-validation', async () => {
    let releaseBoxA: (v: unknown) => void = () => {};
    const boxAPending = new Promise((resolve) => { releaseBoxA = resolve; });

    validateSerialBatchMock
      .mockImplementationOnce(async () => {
        await boxAPending;
        return {
          results: [
            { serialNumber: 'ALCLB49486FF', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
            { serialNumber: 'ALCLB4948758', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
          ],
        };
      })
      .mockImplementationOnce(async () => ({
        results: [
          { serialNumber: 'ALCLB4949DEF', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
          { serialNumber: 'ALCLB4949F2F', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        ],
      }));

    // Mirror the real component: onChange updates the prop the hook is re-rendered with.
    let current: PwaScannedSerial[] = [];
    const onChange = vi.fn((next: PwaScannedSerial[]) => { current = next; });

    const { result, rerender } = renderHook(
      ({ scanned }) => useScanSerial({ stockItem: STOCK_ITEM, scanned, onChange, sourceLocation: GARSTFONTEIN }),
      { initialProps: { scanned: current } },
    );

    // Box A starts validating and does not resolve yet.
    let boxAScan: Promise<void>;
    await act(async () => {
      boxAScan = result.current.handleRawSerial('ALCLB49486FF;ALCLB4948758');
    });
    rerender({ scanned: current });
    expect(current).toHaveLength(2);

    // Box B is scanned and completes while A is still in flight.
    await act(async () => { await result.current.handleRawSerial('ALCLB4949DEF;ALCLB4949F2F'); });
    rerender({ scanned: current });
    expect(current).toHaveLength(4);

    // Box A now resolves — it must not wipe box B.
    await act(async () => { releaseBoxA(null); await boxAScan!; });
    rerender({ scanned: current });

    expect(current).toHaveLength(4);
    expect(current.map((r) => r.serialNumber).sort()).toEqual(
      ['ALCLB49486FF', 'ALCLB4948758', 'ALCLB4949DEF', 'ALCLB4949F2F'],
    );
    expect(current.every((r) => r.state === 'valid')).toBe(true);
    // Two distinct cartons, still distinct.
    expect(new Set(current.map((r) => r.groupId)).size).toBe(2);
  });

  it('does not resurrect a row the storeman removed while it was validating', async () => {
    let release: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => { release = resolve; });
    validateSerialBatchMock.mockImplementationOnce(async () => {
      await pending;
      return {
        results: [
          { serialNumber: 'ALCLB49486FF', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
          { serialNumber: 'ALCLB4948758', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        ],
      };
    });

    let current: PwaScannedSerial[] = [];
    const onChange = vi.fn((next: PwaScannedSerial[]) => { current = next; });
    const { result, rerender } = renderHook(
      ({ scanned }) => useScanSerial({ stockItem: STOCK_ITEM, scanned, onChange, sourceLocation: GARSTFONTEIN }),
      { initialProps: { scanned: current } },
    );

    let scan: Promise<void>;
    await act(async () => { scan = result.current.handleRawSerial('ALCLB49486FF;ALCLB4948758'); });
    rerender({ scanned: current });

    act(() => { result.current.handleRemove('ALCLB4948758'); });
    rerender({ scanned: current });
    expect(current).toHaveLength(1);

    await act(async () => { release(null); await scan!; });
    rerender({ scanned: current });

    expect(current).toHaveLength(1);
    expect(current[0]!.serialNumber).toBe('ALCLB49486FF');
  });
});
