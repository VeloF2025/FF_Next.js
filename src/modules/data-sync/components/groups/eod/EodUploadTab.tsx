// src/modules/data-sync/components/groups/eod/EodUploadTab.tsx
'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, Camera, FolderOpen, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/logger';
import { EodBatchQueue } from './EodBatchQueue';
import { EodEntryTable } from './EodEntryTable';
import { expandPdfToFiles } from '../../../services/eodBatchService';
import type { EodSheetSlot } from '../../../types';

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

async function readDirectoryFiles(entry: FileSystemDirectoryEntry): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader();
    const collected: File[] = [];

    const readBatch = () => {
      reader.readEntries(async (entries) => {
        if (entries.length === 0) {
          resolve(collected);
          return;
        }
        for (const e of entries) {
          if (e.isFile) {
            const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
            if (isImageFile(file) || isPdfFile(file)) collected.push(file);
          } else if (e.isDirectory) {
            const sub = await readDirectoryFiles(e as FileSystemDirectoryEntry);
            collected.push(...sub);
          }
        }
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

function deduplicateFiles(existing: File[], incoming: File[]): File[] {
  const keys = new Set(existing.map((f) => `${f.name}|${f.size}`));
  return [...existing, ...incoming.filter((f) => !keys.has(`${f.name}|${f.size}`))];
}

export function EodUploadTab() {
  const [files, setFiles] = useState<File[]>([]);
  const [savedSlots, setSavedSlots] = useState<EodSheetSlot[]>([]);
  const [expanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);

  const addFiles = useCallback(async (incoming: File[]) => {
    const images = incoming.filter(isImageFile);
    const pdfs = incoming.filter(isPdfFile);

    if (images.length === 0 && pdfs.length === 0) return;

    let allImages = images;

    if (pdfs.length > 0) {
      setExpanding(true);
      setExpandError(null);
      try {
        const expanded = await Promise.all(pdfs.map(expandPdfToFiles));
        allImages = [...images, ...expanded.flat()];
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'PDF conversion failed';
        log.warn('[EOD] PDF expansion failed', { error: err });
        setExpandError(msg);
      } finally {
        setExpanding(false);
      }
    }

    if (allImages.length > 0) {
      setFiles((prev) => deduplicateFiles(prev, allImages));
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-[var(--ff-accent)]');

    const items = Array.from(e.dataTransfer.items);
    const collected: File[] = [];

    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (!entry) continue;
      try {
        if (entry.isFile) {
          const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
          if (isImageFile(file) || isPdfFile(file)) collected.push(file);
        } else if (entry.isDirectory) {
          const sub = await readDirectoryFiles(entry as FileSystemDirectoryEntry);
          collected.push(...sub);
        }
      } catch (err) {
        log.warn('[EOD] Failed to read dropped entry', { name: entry.name, error: err });
      }
    }

    void addFiles(collected);
  };

  const reset = () => {
    setFiles([]);
    setSavedSlots([]);
  };

  // Post-upload summary — show saved sheets read-only
  if (savedSlots.length > 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
            <div>
              <h3 className="text-base font-semibold text-[var(--ff-text-primary)]">
                {savedSlots.length} sheet{savedSlots.length !== 1 ? 's' : ''} saved
              </h3>
              <p className="text-xs text-[var(--ff-text-secondary)]">
                Check Reconciliation tab to compare with WA DRs and OES activations.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={reset}>Upload More</Button>
        </div>

        {savedSlots.map((slot) => (
          <div key={slot.file.name} className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                {slot.file.name}
              </span>
              {slot.extraction && (
                <span className="text-xs text-[var(--ff-text-tertiary)]">
                  {slot.extraction.entries.length} entries
                  {slot.extraction.technician_name ? ` · ${slot.extraction.technician_name}` : ''}
                  {slot.extraction.date ? ` · ${slot.extraction.date}` : ''}
                </span>
              )}
            </div>
            {slot.extraction && slot.extraction.entries.length > 0 ? (
              <div className="px-4 py-2">
                <EodEntryTable entries={slot.extraction.entries} editable={false} />
              </div>
            ) : (
              <p className="px-4 py-3 text-sm text-[var(--ff-text-tertiary)]">No entries</p>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (files.length > 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {files.length} sheet{files.length !== 1 ? 's' : ''} queued
          </p>
          <button onClick={reset} className="text-xs text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]">
            Clear all
          </button>
        </div>
        <EodBatchQueue files={files} onAllDone={(slots) => { setFiles([]); setSavedSlots(slots); }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-[var(--ff-accent)]'); }}
        onDragLeave={(e) => { e.currentTarget.classList.remove('border-[var(--ff-accent)]'); }}
        onDrop={(e) => { void handleDrop(e); }}
        className="border-2 border-dashed border-[var(--ff-border-medium)] rounded-lg p-10 text-center hover:border-[var(--ff-accent)] transition-colors"
      >
        <div className="flex justify-center gap-4 mb-4">
          <Camera className="w-10 h-10 text-[var(--ff-text-tertiary)]" />
          <Upload className="w-10 h-10 text-[var(--ff-text-tertiary)]" />
          <FolderOpen className="w-10 h-10 text-[var(--ff-text-tertiary)]" />
        </div>
        <p className="text-[var(--ff-text-secondary)] mb-1">
          Drag & drop EOD sheets or a folder here
        </p>
        <p className="text-xs text-[var(--ff-text-tertiary)] mb-6">
          JPG, PNG, PDF — VLM extracts all fields automatically
        </p>

        <div className="flex justify-center gap-3">
          {/* Multi-file pick */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 text-sm border border-[var(--ff-border-medium)] rounded-lg text-[var(--ff-text-secondary)] hover:border-[var(--ff-accent)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            Select files
          </button>

          {/* Folder pick — webkitdirectory is not in React types, set via ref callback */}
          <input
            type="file"
            accept="image/*,.pdf"
            multiple
            className="hidden"
            onChange={handleFileInput}
            ref={(el) => {
              folderRef.current = el;
              if (el) el.setAttribute('webkitdirectory', '');
            }}
          />
          <button
            type="button"
            onClick={() => folderRef.current?.click()}
            className="px-4 py-2 text-sm border border-[var(--ff-border-medium)] rounded-lg text-[var(--ff-text-secondary)] hover:border-[var(--ff-accent)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            Select folder
          </button>
        </div>
      </div>

      {expanding && (
        <p className="text-sm text-center text-[var(--ff-text-secondary)] animate-pulse">
          Converting PDF pages…
        </p>
      )}
      {expandError && (
        <p className="text-sm text-center text-red-400">{expandError}</p>
      )}
    </div>
  );
}
