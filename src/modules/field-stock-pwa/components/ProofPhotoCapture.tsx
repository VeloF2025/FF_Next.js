'use client';

/**
 * ProofPhotoCapture — mandatory proof-photo block for NON-SERIAL issues in
 * SignAndSubmitStep. Live camera capture only (capture="environment", per
 * the PWA camera-only rule); compresses client-side before handing the Blob
 * up. Pure presentational: parent owns the Blob state.
 */

import { useCallback, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { compressFileToJpeg } from '@/modules/receipts/client/compressImage';

export interface ProofPhotoCaptureProps {
  /** Object URL preview of the captured photo, null when none yet. */
  preview: string | null;
  onCapture: (photo: Blob, previewUrl: string) => void;
}

export function ProofPhotoCapture({ preview, onCapture }: ProofPhotoCaptureProps) {
  const [busy, setBusy] = useState(false);

  const handlePick = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const compressed = await compressFileToJpeg(file); // 1280px default is plenty for proof
      onCapture(compressed, URL.createObjectURL(compressed));
    } finally {
      setBusy(false);
    }
  }, [onCapture]);

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-neutral-300">
        Photo of the stock being handed out <span className="text-rose-400">*</span>
      </p>
      {preview ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Proof of stock" className="w-full rounded-lg border border-neutral-700" />
          <label className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-neutral-900/90 border border-neutral-700 text-xs text-white cursor-pointer">
            Retake
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePick} disabled={busy} />
          </label>
        </div>
      ) : (
        <label className="w-full flex items-center justify-center gap-2 py-4 rounded-lg bg-neutral-900 border border-dashed border-neutral-600 text-neutral-300 text-sm font-medium cursor-pointer">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />} Take photo
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePick} disabled={busy} />
        </label>
      )}
    </div>
  );
}
