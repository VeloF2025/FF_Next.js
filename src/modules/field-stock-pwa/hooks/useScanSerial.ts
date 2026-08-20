'use client';

/**
 * useScanSerial — scan-and-validate logic for ScanSerialsStep.
 *
 * Handles:
 *  - De-dup (silent if already in list, with haptic feedback)
 *  - Optimistic pending row append
 *  - validateSerial() API call with error surfacing
 *  - Cross-check: serial's stockItemId vs expected stockItemId
 *  - Row remove helper
 */

import { useCallback, useRef, useEffect } from 'react';
import { validateSerial } from '@/modules/field-stock-pwa/api';
import { extractScannedSerial } from '@/modules/field-stock-pwa/lib/scannedSerial';
import { verdictForSerial } from '@/modules/field-stock-pwa/lib/serialVerdict';
import type { PwaScannedSerial } from '@/modules/field-stock-pwa/types';

interface UseScanSerialOptions {
  stockItem: { id: string; name: string };
  scanned: PwaScannedSerial[];
  onChange: (next: PwaScannedSerial[]) => void;
  /**
   * Selected source warehouse. When set, a serial registered at a different
   * location is rejected at scan time — otherwise the mismatch only surfaces
   * as a process-step failure after the technician has already signed.
   * A serial with no recorded location is allowed (missing data is not a
   * contradiction; the process-step stock check still guards quantities).
   */
  sourceLocation?: { id: string; name: string } | null;
}

export function useScanSerial({ stockItem, scanned, onChange, sourceLocation }: UseScanSerialOptions) {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const scannedSet = new Set(scanned.map((s) => s.serialNumber.toUpperCase()));

  const handleRawSerial = useCallback(
    async (rawSerial: string) => {
      // DataMatrix labels (e.g. Nokia GPON ONT) wrap the serial in an ISO 15434
      // envelope; extract the bare serial before validating. Bare 1D/manual
      // input passes through unchanged.
      const serial = extractScannedSerial(rawSerial).toUpperCase();
      if (!serial) return;

      if (scannedSet.has(serial)) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(50);

      const optimistic: PwaScannedSerial = {
        serialNumber: serial,
        stockItemId: '',
        stockItemName: '',
        scannedAt: Date.now(),
        state: 'pending-validation',
      };
      onChange([...scanned, optimistic]);

      let result: Awaited<ReturnType<typeof validateSerial>>;
      try {
        result = await validateSerial(serial);
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : 'Validation request failed';
        onChange(scanned.concat({ ...optimistic, state: 'invalid', errorMessage: msg }));
        return;
      }

      if (!mountedRef.current) return;

      const verdict = verdictForSerial(
        result.valid
          ? {
              serialNumber: serial,
              stockItemId: result.stockItemId ?? stockItem.id,
              stockItemName: result.stockItemName ?? null,
              status: 'in_stock', // validateSerial already applied the status gate
              currentLocationId: result.currentLocationId ?? null,
              currentLocationName: result.currentLocationName ?? null,
            }
          : null,
        {
          expectedItemId: stockItem.id,
          expectedItemName: stockItem.name,
          sourceLocation: sourceLocation ?? null,
        },
      );

      const resolved: PwaScannedSerial = verdict.valid
        ? {
            ...optimistic,
            stockItemId: verdict.stockItemId,
            stockItemName: verdict.stockItemName,
            state: 'valid',
          }
        : {
            ...optimistic,
            stockItemId: verdict.stockItemId ?? '',
            stockItemName: verdict.stockItemName ?? '',
            state: 'invalid',
            // validateSerial's own message (404, bad status) is more specific
            // than the generic not-found the verdict produces from a null record.
            errorMessage: result.valid
              ? verdict.errorMessage
              : (result.errorMessage ?? verdict.errorMessage),
          };

      onChange(
        scanned
          .filter((s) => !(s.serialNumber === serial && s.state === 'pending-validation'))
          .concat(resolved)
      );
    },
    [scanned, scannedSet, stockItem, onChange, sourceLocation]
  );

  const handleRemove = useCallback(
    (serialNumber: string) => onChange(scanned.filter((s) => s.serialNumber !== serialNumber)),
    [scanned, onChange]
  );

  return { handleRawSerial, handleRemove };
}
