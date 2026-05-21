import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

export interface UploadChip {
  name: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

interface UseBulkUploadOptions {
  poleId: string;
  onUploaded: () => void | Promise<void>;
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
 * Shared upload state + handlers for the works-qa unassigned bucket. Both the
 * button-driven file picker AND the drag-drop region of UnassignedBucket route
 * through this hook so error feedback is identical. `done`-status chips
 * auto-clear after 2.5s via a timeout that's properly cleaned up on unmount;
 * errors stay visible until the next upload starts.
 */
export function useBulkUpload({ poleId, onUploaded }: UseBulkUploadOptions) {
  const [chips, setChips] = useState<UploadChip[]>([]);
  const [running, setRunning] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  }, []);

  const scheduleClearDone = useCallback(() => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      setChips(prev => prev.filter(c => c.status !== 'done'));
    }, 2500);
  }, []);

  const handleFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (!imageFiles.length) return;

    setRunning(true);
    // Reserve indices for these uploads by appending to whatever's already on
    // screen — concurrent drop+button calls don't clobber each other.
    let startIdx = 0;
    setChips(prev => {
      startIdx = prev.length;
      return [...prev, ...imageFiles.map(f => ({ name: f.name, status: 'uploading' as const }))];
    });

    await Promise.all(imageFiles.map(async (file, idx) => {
      const chipIdx = startIdx + idx;
      try {
        await uploadOne(poleId, file);
        setChips(prev => prev.map((c, i) => i === chipIdx ? { ...c, status: 'done' as const } : c));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('works-qa: bulk-upload failed', { error: msg, name: file.name });
        setChips(prev => prev.map((c, i) => i === chipIdx ? { ...c, status: 'error' as const, error: msg } : c));
      }
    }));

    setRunning(false);
    await onUploaded();
    scheduleClearDone();
  }, [poleId, onUploaded, scheduleClearDone]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    await handleFiles(files);
  }, [handleFiles]);

  return { chips, running, handleFiles, handleDrop };
}

interface BulkUploadButtonProps {
  running: boolean;
  disabled?: boolean;
  onFilesPicked: (files: File[]) => void | Promise<void>;
}

export function BulkUploadButton({ running, disabled, onFilesPicked }: BulkUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
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
          void onFilesPicked(files);
          // Reset so picking the same files again retriggers change.
          e.target.value = '';
        }}
      />
    </>
  );
}

interface UploadChipListProps {
  chips: UploadChip[];
}

export function UploadChipList({ chips }: UploadChipListProps) {
  if (!chips.length) return null;
  return (
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
  );
}
