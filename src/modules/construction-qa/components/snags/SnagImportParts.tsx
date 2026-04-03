/**
 * SnagImportParts — Sub-components for the zero-touch TQR import dialog.
 * Kept separate to keep SnagImportDialog.tsx under 200 lines.
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, Loader2 } from 'lucide-react';

// ============================================================
// UploadZone
// ============================================================

interface UploadZoneProps {
  onFile: (file: File) => void;
  loading: boolean;
}

/** Drag-and-drop / click-to-browse PDF upload zone. */
export function UploadZone({ onFile, loading }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.type === 'application/pdf') onFile(file);
    },
    [onFile]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !loading && inputRef.current?.click()}
      className={[
        'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed',
        'cursor-pointer select-none transition-colors py-14 px-6',
        dragging
          ? 'border-blue-500 bg-blue-900/20'
          : 'border-zinc-600 bg-zinc-800/50 hover:border-zinc-400',
        loading ? 'pointer-events-none opacity-60' : '',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      {loading ? (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
          <p className="text-sm text-zinc-300">Analysing PDF...</p>
        </>
      ) : (
        <>
          <Upload className="h-8 w-8 text-zinc-400" />
          <p className="text-sm text-zinc-300 font-medium">Drop PDF here or click to browse</p>
          <p className="text-xs text-zinc-500">TQR report PDF only — everything is auto-detected</p>
        </>
      )}
    </div>
  );
}

// ============================================================
// SummaryRow
// ============================================================

/** Single label/value row in the import summary card. */
export function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-zinc-800 last:border-0">
      <span className="w-28 shrink-0 text-xs text-zinc-500">{label}</span>
      <span className="text-xs text-zinc-200 flex-1">{value}</span>
    </div>
  );
}
