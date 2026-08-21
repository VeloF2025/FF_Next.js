/**
 * LabelPhotoCapture — photograph one unit's label, as evidence for taking a
 * single unlisted unit into stock.
 *
 * Not a decoder. PhotoSerialFallback reads a serial OUT of a picture; this one
 * keeps the picture. A carton cross-checks itself — nine serials and a
 * declared count — but a lone unit carries nothing to check against, and a
 * Gizzu has no carton at all. The photograph is what a person can look at
 * afterwards to see the claim was real.
 */

import { useCallback, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { uploadIssueProof } from '@/modules/field-stock-pwa/api';

export interface LabelPhotoCaptureProps {
  /** The serial this photo is evidence for. */
  serialNumber: string;
  onCaptured: (photo: { photoKey: string; photoUrl: string }) => void;
  onCancel: () => void;
}

export function LabelPhotoCapture({ serialNumber, onCaptured, onCancel }: LabelPhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      onCaptured(await uploadIssueProof(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the photo');
    } finally {
      setBusy(false);
    }
  }, [onCaptured]);

  return (
    <div className="rounded-lg bg-amber-950/30 border border-amber-800 px-4 py-3 space-y-2">
      <p className="text-sm text-amber-200">
        <span className="font-mono">{serialNumber}</span> is not in the system.
      </p>
      <p className="text-xs text-amber-300/80">
        Photograph the label on the unit and it will be recorded and flagged. The photo is
        the record that this one was really here.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {error && <p className="text-xs text-red-300">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex-1 min-h-[44px] rounded-lg bg-amber-700 disabled:bg-neutral-800 text-white text-sm font-medium inline-flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? 'Uploading…' : 'Photograph the label'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 min-h-[44px] rounded-lg border border-neutral-700 text-neutral-300 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
