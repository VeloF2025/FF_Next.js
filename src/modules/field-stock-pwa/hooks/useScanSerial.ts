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
import type { PwaScannedSerial } from '@/modules/field-stock-pwa/types';

interface UseScanSerialOptions {
  stockItem: { id: string; name: string };
  scanned: PwaScannedSerial[];
  onChange: (next: PwaScannedSerial[]) => void;
}

export function useScanSerial({ stockItem, scanned, onChange }: UseScanSerialOptions) {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const scannedSet = new Set(scanned.map((s) => s.serialNumber.toUpperCase()));

  const handleRawSerial = useCallback(
    async (rawSerial: string) => {
      const serial = rawSerial.trim().toUpperCase();
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

      let resolved: PwaScannedSerial;
      if (!result.valid) {
        resolved = { ...optimistic, state: 'invalid', errorMessage: result.errorMessage ?? 'Serial is not available' };
      } else if (result.stockItemId && result.stockItemId !== stockItem.id) {
        resolved = {
          ...optimistic,
          stockItemId: result.stockItemId,
          stockItemName: result.stockItemName ?? '',
          state: 'invalid',
          errorMessage: `Wrong stock item — scanned ${result.stockItemName ?? result.stockItemId}, expected ${stockItem.name}`,
        };
      } else {
        resolved = {
          ...optimistic,
          stockItemId: result.stockItemId ?? stockItem.id,
          stockItemName: result.stockItemName ?? stockItem.name,
          state: 'valid',
        };
      }

      onChange(
        scanned
          .filter((s) => !(s.serialNumber === serial && s.state === 'pending-validation'))
          .concat(resolved)
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scanned, scannedSet, stockItem, onChange]
  );

  const handleRemove = useCallback(
    (serialNumber: string) => onChange(scanned.filter((s) => s.serialNumber !== serialNumber)),
    [scanned, onChange]
  );

  return { handleRawSerial, handleRemove };
}
