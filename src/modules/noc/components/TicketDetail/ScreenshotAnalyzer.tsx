'use client';

import { useCallback, useRef, useState } from 'react';
import { resizeImage } from '../TicketForm/sections/screenshotUtils';
import { useAnalyzeScreenshotNote } from '../../hooks/useTicketNotesWithMutations';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

const MAX_IMAGES = 4;

interface ScreenshotAnalyzerProps {
  ticketId: string;
  visibility: 'private' | 'public';
}

export function ScreenshotAnalyzer({ ticketId, visibility }: ScreenshotAnalyzerProps) {
  const [images, setImages] = useState<string[]>([]); // base64 data URLs
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyze = useAnalyzeScreenshotNote(ticketId);

  const addFiles = useCallback(async (files: File[]) => {
    setError(null);
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    try {
      const resized = await Promise.all(imageFiles.map((f) => resizeImage(f)));
      setImages((prev) => [...prev, ...resized].slice(0, MAX_IMAGES));
    } catch {
      setError('Could not read one of the images.');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

  const removeImage = (i: number) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const runAnalysis = () => {
    if (images.length === 0 || analyze.isPending) return;
    setError(null);
    analyze.mutate(
      { images, visibility },
      {
        onSuccess: () => setImages([]),
        onError: (e) => setError(e instanceof Error ? e.message : 'Analysis failed'),
      },
    );
  };

  return (
    <div className="mt-3 pt-3 border-t border-[var(--ff-border-light)]">
      <p className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
        AI screenshot analysis
      </p>

      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onPaste={handlePaste}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onDrop={handleDrop}
        className={`rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent-primary)] ${
          isDragging
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
        }`}
      >
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Drop, paste (Ctrl+V), or click to add 1map screenshots
        </p>
        <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
          Up to {MAX_IMAGES} images · the VLM reads them and posts a {visibility} note
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      </div>

      {images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt={`screenshot ${i + 1}`} className="h-20 w-20 object-cover rounded border border-[var(--ff-border-light)]" />
              <button
                onClick={() => removeImage(i)}
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center"
                title="Remove"
                type="button"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-3">
        <button
          type="button"
          onClick={runAnalysis}
          disabled={images.length === 0 || analyze.isPending}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
        >
          {analyze.isPending ? (
            <>
              <InlineSpinner size="sm" />
              Analyzing…
            </>
          ) : (
            `Analyze & post note${images.length ? ` (${images.length})` : ''}`
          )}
        </button>
      </div>
    </div>
  );
}

export default ScreenshotAnalyzer;
