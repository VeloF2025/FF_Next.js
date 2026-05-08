// src/modules/data-sync/components/groups/eod/EodUploadTab.tsx
'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, Camera, FolderOpen, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EodBatchQueue } from './EodBatchQueue';

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

async function readDirectoryFiles(entry: FileSystemDirectoryEntry): Promise<File[]> {
  return new Promise((resolve) => {
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
            const file = await new Promise<File>((res) => (e as FileSystemFileEntry).file(res));
            if (isImageFile(file)) collected.push(file);
          } else if (e.isDirectory) {
            const sub = await readDirectoryFiles(e as FileSystemDirectoryEntry);
            collected.push(...sub);
          }
        }
        readBatch();
      });
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
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);

  const addFiles = useCallback((incoming: File[]) => {
    const images = incoming.filter(isImageFile);
    if (images.length === 0) return;
    setFiles((prev) => deduplicateFiles(prev, images));
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
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
      if (entry.isFile) {
        const file = await new Promise<File>((res) => (entry as FileSystemFileEntry).file(res));
        if (isImageFile(file)) collected.push(file);
      } else if (entry.isDirectory) {
        const sub = await readDirectoryFiles(entry as FileSystemDirectoryEntry);
        collected.push(...sub);
      }
    }

    addFiles(collected);
  };

  const reset = () => {
    setFiles([]);
    setDone(false);
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <CheckCircle className="w-16 h-16 text-green-400 mb-4" />
        <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">All Sheets Processed</h3>
        <p className="text-[var(--ff-text-secondary)] mb-6">
          Check the Reconciliation tab to compare EOD entries with WA DRs and OES activations.
        </p>
        <Button variant="primary" onClick={reset}>Upload More Sheets</Button>
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
        <EodBatchQueue files={files} onAllDone={() => setDone(true)} />
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
          JPG, PNG — VLM extracts all fields automatically
        </p>

        <div className="flex justify-center gap-3">
          {/* Multi-file pick */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 text-sm border border-[var(--ff-border-medium)] rounded-lg text-[var(--ff-text-secondary)] hover:border-[var(--ff-accent)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            Select files
          </button>

          {/* Folder pick — webkitdirectory is not in React types, set via ref callback */}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInput}
            ref={(el) => {
              folderRef.current = el;
              if (el) el.setAttribute('webkitdirectory', '');
            }}
          />
          <button
            onClick={() => folderRef.current?.click()}
            className="px-4 py-2 text-sm border border-[var(--ff-border-medium)] rounded-lg text-[var(--ff-text-secondary)] hover:border-[var(--ff-accent)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            Select folder
          </button>
        </div>
      </div>
    </div>
  );
}
