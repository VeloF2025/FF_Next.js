import { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

interface BulkUnassignedUploadProps {
  poleId: string;
  onUploaded: () => void | Promise<void>;
  disabled?: boolean;
}

interface UploadChip {
  name: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

async function uploadOne(poleId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('pole_id', poleId);
  form.append('slot', 'unassigned');
  form.append('photo', file);
  form.append('source', 'bulk-upload');
  const res = await fetch('/api/works-qa/pole-assign', { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * Bulk-upload manual photos into a pole's unassigned bucket. Multi-select via
 * file picker (no folder picker — browsers don't expose paths reliably). Each
 * upload runs the standard VLM validation pipeline server-side.
 */
export function BulkUnassignedUpload({ poleId, onUploaded, disabled }: BulkUnassignedUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [chips, setChips] = useState<UploadChip[]>([]);
  const [running, setRunning] = useState(false);

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (!imageFiles.length) return;

    setRunning(true);
    setChips(imageFiles.map(f => ({ name: f.name, status: 'uploading' })));

    await Promise.all(imageFiles.map(async (file, idx) => {
      try {
        await uploadOne(poleId, file);
        setChips(prev => prev.map((c, i) => i === idx ? { ...c, status: 'done' } : c));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('works-qa: bulk-upload failed', { error: msg, name: file.name });
        setChips(prev => prev.map((c, i) => i === idx ? { ...c, status: 'error', error: msg } : c));
      }
    }));

    await onUploaded();
    setRunning(false);
    // Clear chips after a short delay so the user sees the green ticks
    setTimeout(() => setChips([]), 2500);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || running}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Bulk upload photos to unassigned bucket"
      >
        {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
        {running ? 'Uploading…' : '+ Bulk upload'}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          void handleFiles(files);
          // Reset so picking the same files again retriggers change.
          e.target.value = '';
        }}
      />

      {chips.length > 0 && (
        <ul role="status" aria-live="polite" className="flex flex-wrap gap-1">
          {chips.map((chip, i) => (
            <li
              key={i}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                chip.status === 'uploading' ? 'bg-zinc-800 border-zinc-700 text-zinc-400'
                : chip.status === 'done' ? 'bg-green-900/40 border-green-700/50 text-green-300'
                : 'bg-red-900/40 border-red-700/50 text-red-300'
              }`}
              title={chip.error}
            >
              {chip.status === 'uploading' ? '…' : chip.status === 'done' ? '✓' : '×'} {chip.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Sibling helper: wires onDrop on an existing element. Use from
 * UnassignedBucket so dragging files onto the bucket also uploads.
 */
export async function handleBulkDrop(
  poleId: string,
  e: React.DragEvent,
  onUploaded: () => void | Promise<void>,
): Promise<void> {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;

  await Promise.all(files.map(async file => {
    try {
      await uploadOne(poleId, file);
    } catch (err: unknown) {
      log.error('works-qa: bulk-drop upload failed', {
        error: err instanceof Error ? err.message : String(err),
        name: file.name,
      });
    }
  }));
  await onUploaded();
}
