# EOD Multi-Sheet Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-file EOD upload flow with a multi-file/folder queue that processes sheets through VLM sequentially, lets the admin review each one, and on save writes confirmed DR↔ONT matches back to `dr_photo_unified_reviews` and `serial_change_history`.

**Architecture:** Three new/modified UI components (`EodUploadTab` drop zone → `EodBatchQueue` state machine → `EodSheetReviewer` review pane) backed by a write-back loop added to `createSheet()` that calls the existing `logSerialChange()` for each confirmed DR↔ONT pair. No schema changes needed.

**Tech Stack:** Next.js (Pages Router), React, TypeScript, Neon serverless SQL, `logSerialChange` from `@/modules/activate/services/activity-log/serialHistory`

**Worktree:** `/home/hein/Workspace/FF_Next.js-eod-multi-upload` on branch `feat/eod-multi-sheet-upload`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/modules/activate/services/activity-log/_shared.ts` | Modify line 78 | Add `'eod_sheet'` to `SerialChangeSource` union |
| `src/modules/data-sync/components/groups/eod/EodSheetReviewer.tsx` | **Create** | Pure review pane — receives extraction, emits save/skip |
| `src/modules/data-sync/components/groups/eod/EodBatchQueue.tsx` | **Create** | Queue state machine, pipeline extraction, progress chips |
| `src/modules/data-sync/components/groups/eod/EodUploadTab.tsx` | Rewrite | Multi-file drop zone + folder drop; composes `EodBatchQueue` |
| `src/modules/data-sync/services/eodSheetService.ts` | Modify | Add DR write-back loop inside `createSheet()` |
| `pages/api/eod/sheets.ts` | Modify | Return `matched_count` + `logged_count` in POST response |

---

## Task 1: Add `'eod_sheet'` to SerialChangeSource

**Files:**
- Modify: `src/modules/activate/services/activity-log/_shared.ts:72-78`

- [ ] **Step 1: Add the new source value**

In `_shared.ts`, find the `SerialChangeSource` union (line 72) and add `'eod_sheet'`:

```typescript
export type SerialChangeSource =
  | 'onemap_sync'
  | 'manual_edit'
  | 'vlm_extraction'
  | 'wa_photo_vlm'
  | 'swap_correction'
  | 'migration'
  | 'eod_sheet';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/hein/Workspace/FF_Next.js-eod-multi-upload
npx tsc --noEmit 2>&1 | grep "_shared\|SerialChange" | head -20
```

Expected: no errors referencing `_shared.ts` or `SerialChangeSource`.

- [ ] **Step 3: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-eod-multi-upload
git add src/modules/activate/services/activity-log/_shared.ts
git commit -m "feat(eod): add eod_sheet to SerialChangeSource"
```

---

## Task 2: Create EodSheetReviewer component

**Files:**
- Create: `src/modules/data-sync/components/groups/eod/EodSheetReviewer.tsx`

This is the existing single-sheet review UI extracted from `EodUploadTab` (lines 249-312), promoted to its own component with clear props.

- [ ] **Step 1: Create the file**

```typescript
// src/modules/data-sync/components/groups/eod/EodSheetReviewer.tsx
'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { EodEntryTable } from './EodEntryTable';
import type { EodVlmExtraction, EodVlmEntry } from '../../../types';

interface SavePayload {
  sheetDate: string;
  technicianName: string | null;
  technicianId: string | null;
  entries: EodVlmEntry[];
}

interface EodSheetReviewerProps {
  extraction: EodVlmExtraction;
  sheetIndex: number;
  totalSheets: number;
  saving: boolean;
  error: string | null;
  onSave: (payload: SavePayload) => Promise<void>;
  onSkip: () => void;
}

export function EodSheetReviewer({
  extraction,
  sheetIndex,
  totalSheets,
  saving,
  error,
  onSave,
  onSkip,
}: EodSheetReviewerProps) {
  const [entries, setEntries] = useState<EodVlmEntry[]>(extraction.entries);
  const [sheetDate, setSheetDate] = useState(extraction.date ?? '');
  const [techName, setTechName] = useState(extraction.technician_name ?? '');
  const [techId, setTechId] = useState(extraction.technician_id ?? '');

  const handleSave = async () => {
    await onSave({
      sheetDate,
      technicianName: techName || null,
      technicianId: techId || null,
      entries,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          Review Sheet {sheetIndex + 1} of {totalSheets}
        </h3>
        <span className="text-xs text-[var(--ff-text-tertiary)]">
          Confidence: {Math.round(extraction.overall_confidence * 100)}%
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-xs text-[var(--ff-text-secondary)] mb-1 block">Date</label>
          <input
            type="date"
            value={sheetDate}
            onChange={(e) => setSheetDate(e.target.value)}
            className="w-full bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-[var(--ff-accent)]"
          />
        </div>
        <div>
          <label className="text-xs text-[var(--ff-text-secondary)] mb-1 block">Technician Name</label>
          <input
            value={techName}
            onChange={(e) => setTechName(e.target.value)}
            className="w-full bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-[var(--ff-accent)]"
          />
        </div>
        <div>
          <label className="text-xs text-[var(--ff-text-secondary)] mb-1 block">Technician ID</label>
          <input
            value={techId}
            onChange={(e) => setTechId(e.target.value)}
            className="w-full bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-[var(--ff-accent)]"
          />
        </div>
      </div>

      <EodEntryTable entries={entries} editable onChange={setEntries} />

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          variant="primary"
          onClick={() => { void handleSave(); }}
          disabled={saving || !sheetDate || entries.length === 0}
          loading={saving}
          className="flex-1"
        >
          <CheckCircle className="w-5 h-5" />
          {totalSheets > 1 ? `Save & Next (${entries.length} entries)` : `Save Sheet (${entries.length} entries)`}
        </Button>
        <Button variant="secondary" onClick={onSkip} disabled={saving}>
          <SkipForward className="w-4 h-4" />
          Skip
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/hein/Workspace/FF_Next.js-eod-multi-upload
npx tsc --noEmit 2>&1 | grep "EodSheetReviewer" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/data-sync/components/groups/eod/EodSheetReviewer.tsx
git commit -m "feat(eod): add EodSheetReviewer component"
```

---

## Task 3: Create EodBatchQueue component

**Files:**
- Create: `src/modules/data-sync/components/groups/eod/EodBatchQueue.tsx`

This owns the queue state machine. A `useEffect` keeps exactly one slot extracting at a time (pipeline depth 1). The reviewer is shown for the first `ready` slot at or after the current position.

- [ ] **Step 1: Create the file**

```typescript
// src/modules/data-sync/components/groups/eod/EodBatchQueue.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { EodSheetReviewer } from './EodSheetReviewer';
import type { EodVlmExtraction, EodVlmEntry } from '../../../types';

type SlotStatus = 'pending' | 'extracting' | 'ready' | 'saving' | 'saved' | 'failed' | 'skipped';

interface SheetSlot {
  file: File;
  status: SlotStatus;
  extraction: EodVlmExtraction | null;
  error: string | null;
}

interface SavePayload {
  sheetDate: string;
  technicianName: string | null;
  technicianId: string | null;
  entries: EodVlmEntry[];
}

interface EodBatchQueueProps {
  files: File[];
  onAllDone: () => void;
}

async function extractFile(file: File): Promise<EodVlmExtraction> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1]!);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const res = await fetch('/api/eod/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  const json = await res.json() as { success: boolean; data: EodVlmExtraction; message?: string };
  if (!json.success) throw new Error(json.message ?? 'Extraction failed');
  return json.data;
}

async function saveSheet(payload: SavePayload): Promise<{ matched_count: number }> {
  const res = await fetch('/api/eod/sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sheetDate: payload.sheetDate,
      technicianName: payload.technicianName,
      technicianId: payload.technicianId,
      entries: payload.entries.map((e) => ({
        row_number: e.row_number,
        ont_serial: e.ont_serial,
        gizzu_serial: e.gizzu_serial,
        dr_number: e.dr_number,
        pon_number: e.pon_number,
        address: e.address,
      })),
    }),
  });
  const json = await res.json() as { success: boolean; data: { matched_count: number }; message?: string };
  if (!json.success) throw new Error(json.message ?? 'Save failed');
  return json.data;
}

const STATUS_COLORS: Record<SlotStatus, string> = {
  pending: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]',
  extracting: 'bg-blue-500/20 text-blue-400',
  ready: 'bg-amber-500/20 text-amber-400',
  saving: 'bg-blue-500/20 text-blue-400',
  saved: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  skipped: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] line-through',
};

export function EodBatchQueue({ files, onAllDone }: EodBatchQueueProps) {
  const [slots, setSlots] = useState<SheetSlot[]>(() =>
    files.map((file) => ({ file, status: 'pending', extraction: null, error: null }))
  );
  const [reviewIndex, setReviewIndex] = useState(0);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [matchedTotal, setMatchedTotal] = useState(0);

  // Pipeline: keep exactly one slot extracting at a time
  useEffect(() => {
    const hasExtracting = slots.some((s) => s.status === 'extracting');
    if (hasExtracting) return;

    const nextPending = slots.findIndex((s) => s.status === 'pending');
    if (nextPending === -1) return;

    setSlots((prev) =>
      prev.map((s, i) => (i === nextPending ? { ...s, status: 'extracting' } : s))
    );

    extractFile(slots[nextPending]!.file)
      .then((extraction) => {
        setSlots((prev) =>
          prev.map((s, i) =>
            i === nextPending ? { ...s, status: 'ready', extraction } : s
          )
        );
      })
      .catch((err: unknown) => {
        setSlots((prev) =>
          prev.map((s, i) =>
            i === nextPending
              ? { ...s, status: 'failed', error: err instanceof Error ? err.message : 'Extraction failed' }
              : s
          )
        );
      });
  }, [slots]);

  // Check if all done
  useEffect(() => {
    const allSettled = slots.every((s) =>
      s.status === 'saved' || s.status === 'skipped' || s.status === 'failed'
    );
    if (allSettled && slots.length > 0) onAllDone();
  }, [slots, onAllDone]);

  const advanceReview = useCallback(() => {
    setReviewIndex((prev) => {
      // Find next non-terminal slot after prev
      const next = slots.findIndex(
        (s, i) => i > prev && s.status !== 'saved' && s.status !== 'skipped'
      );
      return next === -1 ? prev + 1 : next;
    });
    setSaveError(null);
  }, [slots]);

  const handleSave = useCallback(
    async (payload: SavePayload) => {
      setSavingIndex(reviewIndex);
      setSaveError(null);
      try {
        const result = await saveSheet(payload);
        setMatchedTotal((t) => t + (result.matched_count ?? 0));
        setSlots((prev) =>
          prev.map((s, i) => (i === reviewIndex ? { ...s, status: 'saved' } : s))
        );
        advanceReview();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Save failed');
      } finally {
        setSavingIndex(null);
      }
    },
    [reviewIndex, advanceReview]
  );

  const handleSkip = useCallback(() => {
    setSlots((prev) =>
      prev.map((s, i) => (i === reviewIndex ? { ...s, status: 'skipped' } : s))
    );
    advanceReview();
    setSaveError(null);
  }, [reviewIndex, advanceReview]);

  const handleRetry = useCallback((index: number) => {
    setSlots((prev) =>
      prev.map((s, i) => (i === index ? { ...s, status: 'pending', error: null } : s))
    );
  }, []);

  const currentSlot = slots[reviewIndex];
  const savedCount = slots.filter((s) => s.status === 'saved').length;
  const totalNonSkipped = slots.filter((s) => s.status !== 'skipped').length;

  return (
    <div className="space-y-6">
      {/* Progress chips */}
      <div className="flex flex-wrap gap-2">
        {slots.map((slot, i) => (
          <div
            key={i}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${STATUS_COLORS[slot.status]} ${i === reviewIndex ? 'ring-1 ring-[var(--ff-accent)]' : ''}`}
          >
            {slot.status === 'extracting' && <InlineSpinner size="xs" />}
            {slot.status === 'saved' && <CheckCircle className="w-3 h-3" />}
            {slot.status === 'failed' && <AlertCircle className="w-3 h-3" />}
            <span>{slot.file.name.replace(/\.[^.]+$/, '').slice(0, 20)}</span>
            {slot.status === 'failed' && (
              <button
                onClick={() => handleRetry(i)}
                className="ml-1 hover:text-white"
                title="Retry extraction"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Matched count banner */}
      {matchedTotal > 0 && (
        <div className="px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-400">
          {matchedTotal} DR↔ONT {matchedTotal === 1 ? 'match' : 'matches'} written to records
        </div>
      )}

      {/* Current sheet review */}
      {currentSlot?.status === 'ready' && currentSlot.extraction && (
        <EodSheetReviewer
          extraction={currentSlot.extraction}
          sheetIndex={reviewIndex}
          totalSheets={slots.length}
          saving={savingIndex === reviewIndex}
          error={saveError}
          onSave={handleSave}
          onSkip={handleSkip}
        />
      )}

      {currentSlot?.status === 'extracting' && (
        <div className="flex items-center gap-3 py-8 justify-center text-[var(--ff-text-secondary)]">
          <InlineSpinner size="sm" />
          <span>Extracting sheet {reviewIndex + 1} of {slots.length}…</span>
        </div>
      )}

      {currentSlot?.status === 'failed' && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-red-400 font-medium">Extraction failed for {currentSlot.file.name}</p>
            {currentSlot.error && <p className="text-xs text-[var(--ff-text-secondary)] mt-1">{currentSlot.error}</p>}
          </div>
          <button
            onClick={() => handleRetry(reviewIndex)}
            className="text-xs text-red-400 border border-red-500/30 px-3 py-1.5 rounded hover:bg-red-500/10"
          >
            Retry
          </button>
          <button
            onClick={handleSkip}
            className="text-xs text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] px-3 py-1.5 rounded hover:bg-[var(--ff-bg-secondary)]"
          >
            Skip
          </button>
        </div>
      )}

      {/* All done */}
      {slots.every((s) => ['saved', 'skipped', 'failed'].includes(s.status)) && (
        <div className="text-center py-4">
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {savedCount} of {totalNonSkipped} sheets saved.
            {matchedTotal > 0 && ` ${matchedTotal} DR↔ONT matches recorded.`}
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            Check the Reconciliation tab to compare with WA DRs and OES.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/hein/Workspace/FF_Next.js-eod-multi-upload
npx tsc --noEmit 2>&1 | grep "EodBatchQueue" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/data-sync/components/groups/eod/EodBatchQueue.tsx
git commit -m "feat(eod): add EodBatchQueue sequential queue component"
```

---

## Task 4: Rewrite EodUploadTab with multi-file + folder drop

**Files:**
- Modify: `src/modules/data-sync/components/groups/eod/EodUploadTab.tsx` (full rewrite — current 315 lines → ~150 lines)

The tab now only owns: the drop zone, the queue of files, and the post-queue success state. All extraction and review state moves to `EodBatchQueue`.

- [ ] **Step 1: Rewrite the file**

```typescript
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
  const folderRef = useRef<HTMLInputElement>(null);

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

          {/* Folder pick — webkitdirectory not in React types, set via ref callback */}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInput}
            ref={(el) => {
              (folderRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
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
```

Note on `folderRef`: React doesn't support `webkitdirectory` as a JSX prop, so it's set via `setAttribute` in the `ref` callback. The `ref` callback pattern means we can't use `useRef` directly for the folder input — the inline ref handles both the `folderRef` assignment and the attribute set.

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/hein/Workspace/FF_Next.js-eod-multi-upload
npx tsc --noEmit 2>&1 | grep "EodUploadTab\|EodBatch" | head -20
```

Expected: no errors.

- [ ] **Step 3: Quick lint check**

```bash
cd /home/hein/Workspace/FF_Next.js-eod-multi-upload
npm run lint -- --quiet 2>&1 | grep "eod/" | head -20
```

Expected: no new errors in the eod/ directory.

- [ ] **Step 4: Commit**

```bash
git add src/modules/data-sync/components/groups/eod/EodUploadTab.tsx
git commit -m "feat(eod): multi-file and folder drop upload zone"
```

---

## Task 5: Add DR write-back to eodSheetService.createSheet()

**Files:**
- Modify: `src/modules/data-sync/services/eodSheetService.ts`

After all entries are inserted, loop through entries with both `dr_number` and `ont_serial`. For each: query `dr_photo_unified_reviews`, update if null, call `logSerialChange` with source `'eod_sheet'`.

- [ ] **Step 1: Add the import for logSerialChange**

At the top of `eodSheetService.ts`, after the existing imports, add:

```typescript
import { logSerialChange } from '@/modules/activate/services/activity-log/serialHistory';
```

- [ ] **Step 2: Add the write-back function**

Add this private function before `createSheet`:

```typescript
interface WriteBackResult {
  matched_count: number;
  logged_count: number;
}

async function writeBackDrSerials(
  entries: CreateSheetInput['entries'],
  sheetId: string,
  uploadedBy: string
): Promise<WriteBackResult> {
  let matched_count = 0;
  let logged_count = 0;

  const candidates = entries.filter((e) => e.drNumber && e.ontSerial);

  for (const entry of candidates) {
    const drNumber = entry.drNumber!;
    const eodOnt = entry.ontSerial!;

    // Look up current serial in dr_photo_unified_reviews
    const rows = await sql`
      SELECT ont_serial_scanned
      FROM dr_photo_unified_reviews
      WHERE drop_number = ${drNumber}
      LIMIT 1
    `;

    if (rows.length === 0) {
      log.warn('[EOD-WriteBack] DR not found in dr_photo_unified_reviews', { drNumber });
      continue;
    }

    const currentOnt = (rows[0] as { ont_serial_scanned: string | null }).ont_serial_scanned ?? null;

    // Fill null serials only — never overwrite an existing serial
    if (currentOnt === null) {
      await sql`
        UPDATE dr_photo_unified_reviews
        SET ont_serial_scanned = ${eodOnt}
        WHERE drop_number = ${drNumber}
      `;
      matched_count++;
    }

    // Log to serial_change_history + dr_activity_log regardless of whether we updated
    try {
      await logSerialChange(
        drNumber,
        'ont_serial',
        currentOnt,
        eodOnt,
        'eod_sheet',
        uploadedBy,
        'technician_update',
        { eod_sheet_id: sheetId, eod_entry_row: entry.rowNumber }
      );
      logged_count++;
    } catch (err) {
      log.warn('[EOD-WriteBack] logSerialChange failed', { drNumber, error: err });
    }
  }

  return { matched_count, logged_count };
}
```

- [ ] **Step 3: Call writeBackDrSerials inside createSheet()**

Change `createSheet` to return `matched_count` and `logged_count` alongside the sheet. Find the end of `createSheet` where it currently does `log.info` and `return sheet`. Replace:

```typescript
  log.info('[EOD] Sheet created', {
    id: sheet.id,
    date: input.sheetDate,
    entries: input.entries.length,
  });

  return sheet as EodInstallSheet;
```

With:

```typescript
  const writeBack = await writeBackDrSerials(input.entries, sheet.id as string, input.uploadedBy);

  log.info('[EOD] Sheet created', {
    id: sheet.id,
    date: input.sheetDate,
    entries: input.entries.length,
    matched_count: writeBack.matched_count,
    logged_count: writeBack.logged_count,
  });

  return { ...(sheet as EodInstallSheet), ...writeBack };
```

- [ ] **Step 4: Update the return type of createSheet**

Change the function signature from:

```typescript
export async function createSheet(input: CreateSheetInput): Promise<EodInstallSheet> {
```

To:

```typescript
export async function createSheet(input: CreateSheetInput): Promise<EodInstallSheet & { matched_count: number; logged_count: number }> {
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd /home/hein/Workspace/FF_Next.js-eod-multi-upload
npx tsc --noEmit 2>&1 | grep "eodSheetService\|writeBack\|createSheet" | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/data-sync/services/eodSheetService.ts
git commit -m "feat(eod): write back DR↔ONT matches on sheet save"
```

---

## Task 6: Return matched_count + logged_count from the API

**Files:**
- Modify: `pages/api/eod/sheets.ts:46-72` (the `handlePost` function)

The `createSheet` result now includes `matched_count` and `logged_count`. Surface them in the API response.

- [ ] **Step 1: Update handlePost to pass through counts**

In `pages/api/eod/sheets.ts`, find `handlePost`. The current response is:

```typescript
    return apiResponse.created(res, sheet);
```

Replace with:

```typescript
    return apiResponse.created(res, {
      ...sheet,
      matched_count: sheet.matched_count,
      logged_count: sheet.logged_count,
    });
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/hein/Workspace/FF_Next.js-eod-multi-upload
npx tsc --noEmit 2>&1 | grep "sheets.ts\|handlePost" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add pages/api/eod/sheets.ts
git commit -m "feat(eod): return matched_count and logged_count from POST /api/eod/sheets"
```

---

## Task 7: Full CI check + PR

- [ ] **Step 1: Run CI quick**

```bash
cd /home/hein/Workspace/FF_Next.js-eod-multi-upload
npm run ci:quick 2>&1 | tail -30
```

Expected: lint errors ≤ 77, warnings ≤ ~1833, catches ≤ 94, build succeeds.

- [ ] **Step 2: Create PR**

```bash
cd /home/hein/Workspace/FF_Next.js-eod-multi-upload
gh pr create \
  --title "feat(eod): multi-sheet upload with DR↔ONT write-back" \
  --body "$(cat <<'EOF'
## Summary
- Replaces single-file EOD upload with multi-file select + folder drag-and-drop
- Sequential queue (EodBatchQueue): VLM extracts N+1 in background while admin reviews N
- On save, confirmed DR↔ONT pairs are written back to \`dr_photo_unified_reviews\` (fills nulls only) and logged to \`serial_change_history\` / \`dr_activity_log\` with \`change_source = 'eod_sheet'\`
- Pre-provisioning and DR activation history pick up EOD-sourced serials automatically — no schema changes

## Test plan
- [ ] Drop a single image → existing single-sheet flow still works
- [ ] Ctrl+click 3 images → all 3 appear as chips, extract sequentially, review one-by-one
- [ ] Drag a folder of images → all images found recursively, queued correctly
- [ ] Duplicate files (same name+size) not added twice
- [ ] Failed extraction chip shows Retry; skipped chip shows strikethrough
- [ ] After save, check \`serial_change_history\` for rows with \`change_source = 'eod_sheet'\`
- [ ] Check \`dr_photo_unified_reviews\` — DRs with null serial now populated; existing serials unchanged

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Note the PR URL**

Copy the PR URL from the output and share with reviewer.
