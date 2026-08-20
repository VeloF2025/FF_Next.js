'use client';

/**
 * PhotoSerialFallback — "Take a photo instead" for ScanSerialsStep.
 * Captures a still (live camera only), compresses to 1920px (barcode
 * density must survive the server zxing pass), POSTs to the extract
 * endpoint, and hands the candidate serial up. The parent PRE-FILLS the
 * manual-entry field — the user always confirms before validation.
 */

import { useCallback, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import { compressFileToJpeg } from '@/modules/receipts/client/compressImage';
import { extractSerialFromPhoto } from '@/modules/field-stock-pwa/api';
import { log } from '@/lib/logger';

export interface PhotoSerialFallbackProps {
  /** Candidate serial extracted — parent pre-fills the manual field. */
  onSerial: (serial: string) => void;
  /**
   * Called instead of onSerial when the photo caught a whole carton label —
   * the box DataMatrix carries every serial in the box, so the camera failing
   * on a dense square does not cost the storeman the batch.
   */
  onSerials?: (serials: string[]) => void;
  /** Nothing readable — parent opens the manual field with a hint. */
  onNoSerial: (message: string) => void;
}

export function PhotoSerialFallback({ onSerial, onSerials, onNoSerial }: PhotoSerialFallbackProps) {
  const [extracting, setExtracting] = useState(false);

  const handlePick = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setExtracting(true);
      try {
        const compressed = await compressFileToJpeg(file, { maxDim: 1920, quality: 0.9 });
        const result = await extractSerialFromPhoto(compressed);
        if (result.serials && result.serials.length > 1 && onSerials) {
          onSerials(result.serials);
        } else if (result.serial) {
          onSerial(result.serial);
        } else {
          onNoSerial("Couldn't read the label — type the serial below.");
        }
      } catch (err) {
        log.warn('photo serial fallback failed', { err }, 'PhotoSerialFallback');
        onNoSerial('Photo upload failed — check your signal and try again, or type the serial.');
      } finally {
        setExtracting(false);
      }
    },
    [onSerial, onSerials, onNoSerial]
  );

  return (
    <label className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-300 text-sm font-medium cursor-pointer hover:bg-neutral-800">
      {extracting ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" /> Reading label…
        </>
      ) : (
        <>
          <ImageIcon className="w-4 h-4" /> Take a photo instead
        </>
      )}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePick}
        disabled={extracting}
      />
    </label>
  );
}
