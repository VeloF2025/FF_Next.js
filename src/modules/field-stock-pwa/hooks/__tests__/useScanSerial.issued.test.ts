/**
 * useScanSerial — an ALREADY-ISSUED serial must never be offered as new stock.
 *
 * Field report 2026-08-21: scanning ALCLB465A813 showed a green tick and
 * "Not on the stock sheet yet — recorded from the carton and flagged". The
 * serial was in the system all along: status 'issued', provenance 'sheet',
 * already in another technician's hands.
 *
 * Cause: the hook passed `result.valid ? {...} : null` to verdictForSerial, so
 * EVERY failure — already issued, wrong item, genuinely absent — arrived as
 * "no such serial". For a machine read that meant "take it into stock as new".
 * The check was being made and then discarded.
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
const TEMBISA = { id: 'loc-tem1', name: 'Tembisa 1' };
const ISSUED_SERIAL = 'ALCLB465A813';

function lastChange(onChange: ReturnType<typeof vi.fn>): PwaScannedSerial[] {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]![0] as PwaScannedSerial[];
}

function renderScan(onChange: ReturnType<typeof vi.fn>) {
  return renderHook(() =>
    useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: TEMBISA }),
  );
}

beforeEach(() => { validateSerialMock.mockReset(); });

describe('a serial that exists but is not issuable', () => {
  it('REFUSES an already-issued serial scanned by camera', async () => {
    // Exactly what the endpoint returns for ALCLB465A813.
    validateSerialMock.mockResolvedValueOnce({
      valid: false,
      stockItemId: 'item-ont',
      stockItemName: 'FT-ONT',
      currentLocationId: null,
      currentLocationName: null,
      status: 'issued',
      errorMessage: 'Serial is not available (status: issued)',
    });
    const onChange = vi.fn();
    const { result } = renderScan(onChange);

    await act(async () => { await result.current.handleRawSerial(ISSUED_SERIAL, 'machine'); });

    const [row] = lastChange(onChange);
    expect(row!.state).toBe('invalid');
    expect(row!.errorMessage).toContain('issued');
    // The row must carry the serial's REAL item. Collapsing the response to
    // `null` loses it: verdictForSerial then has no record to read, so the row
    // falls back to ''. This is the observable trace of the bug — the
    // user-facing message comes from validateSerial either way, so the message
    // alone cannot tell the two apart.
    expect(row!.stockItemId).toBe('item-ont');
    expect(row!.stockItemName).toBe('FT-ONT');
  });

  it('does NOT offer to take an already-issued serial into stock', async () => {
    // The specific regression: a green tick plus "not on the stock sheet yet"
    // for an ONT that is on the sheet AND already in someone's hands.
    validateSerialMock.mockResolvedValueOnce({
      valid: false,
      stockItemId: 'item-ont',
      stockItemName: 'FT-ONT',
      status: 'issued',
      errorMessage: 'Serial is not available (status: issued)',
    });
    const onChange = vi.fn();
    const { result } = renderScan(onChange);

    await act(async () => { await result.current.handleRawSerial(ISSUED_SERIAL, 'machine'); });

    const [row] = lastChange(onChange);
    expect(row!.state).not.toBe('valid');
    expect(row!.warning ?? '').not.toMatch(/not on the stock sheet/i);
  });

  it('refuses an installed serial too, not just an issued one', async () => {
    validateSerialMock.mockResolvedValueOnce({
      valid: false, stockItemId: 'item-ont', stockItemName: 'FT-ONT',
      status: 'installed', errorMessage: 'Serial is not available (status: installed)',
    });
    const onChange = vi.fn();
    const { result } = renderScan(onChange);

    await act(async () => { await result.current.handleRawSerial('ALCLB4940344', 'machine'); });

    expect(lastChange(onChange)[0]!.state).toBe('invalid');
  });
});

describe('a single scanned code corroborates nothing', () => {
  it('refuses an unknown serial scanned one at a time', async () => {
    // The server requires a carton payload before taking stock in; a lone code
    // never qualifies. The client must agree, or the storeman gets a tick and
    // a failure at submit.
    validateSerialMock.mockResolvedValueOnce({
      valid: false, errorMessage: 'Serial number not found',
    });
    const onChange = vi.fn();
    const { result } = renderScan(onChange);

    await act(async () => { await result.current.handleRawSerial('ALCLB4900000', 'machine'); });

    const [row] = lastChange(onChange);
    expect(row!.state).toBe('invalid');
    expect(row!.errorMessage).toBe('Serial number not found');
  });

  it('still ACCEPTS a genuinely available serial', async () => {
    // The fix must not refuse ordinary stock.
    validateSerialMock.mockResolvedValueOnce({
      valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT',
      currentLocationId: 'loc-tem1', currentLocationName: 'Tembisa 1',
      status: 'in_stock',
    });
    const onChange = vi.fn();
    const { result } = renderScan(onChange);

    await act(async () => { await result.current.handleRawSerial('ALCLB4948601', 'machine'); });

    expect(lastChange(onChange)[0]!.state).toBe('valid');
  });

  it('accepts an available serial even when the endpoint omits status', async () => {
    // Backwards compatible with a response that predates the status field.
    validateSerialMock.mockResolvedValueOnce({
      valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT',
    });
    const onChange = vi.fn();
    const { result } = renderScan(onChange);

    await act(async () => { await result.current.handleRawSerial('ALCLB4948602', 'machine'); });

    expect(lastChange(onChange)[0]!.state).toBe('valid');
  });
});
