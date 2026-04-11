/**
 * BillingUploadTab
 *
 * Bulk weekly billing upload: drop a whole WE<date>/ folder (or multi-select
 * files) and the system auto-routes them per project. Handles:
 *   - FT payment summary PDF (<Project> WE<code>.pdf)
 *   - Deduction notes XLSX (<Project> WE<code> notes.xlsx) [optional]
 *   - Zone uptake PDF (<Project>_installation uptake per zone_<code>.pdf)
 *   - Zone+PON uptake PDF (<Project>_installation uptake per zone per pon_<code>.pdf)
 *
 * Flow: drop → Preview → review per-project cards → Import. All four projects
 * in one pass; each row shows detected project, file count, week ending,
 * ONT count, reconcile status, and invoice total.
 */

'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  Upload,
  FileText,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';

// ─── Types mirroring upload-weekly-bundle.ts response shape ────────────────

interface ResolvedProject {
  matched: boolean;
  projectId: string | null;
  projectName: string | null;
  candidates: { id: string; name: string }[];
}

interface BundleSummary {
  weekEnding: string;
  site: string | null;
  contractor: string | null;
  areaManager: string | null;
  totalOnts: number;
  claimable: number;
  note1Count: number;
  note2Count: number;
  note3Count: number;
  note4Count: number;
  note5Count: number;
  preProvisionsCount: number;
  totalClaimableForPayment: number;
  lowerThanLinkBudgetCount: number;
}

interface ReconcileResult {
  ftTotalOnts: number;
  uptakeInstalled: number;
  delta: number;
  ok: boolean;
}

interface ProjectBundlePreview {
  projectHint: string;
  resolved: ResolvedProject;
  files: { name: string; kind: string }[];
  summary: BundleSummary | null;
  deductionCount: number;
  zoneRowCount: number;
  ponRowCount: number;
  reconcile: ReconcileResult | null;
  parseWarnings: string[];
  fatalError: string | null;
}

interface ProjectBundleImport extends ProjectBundlePreview {
  billingWeekId: string | null;
  pricePerDrop: number | null;
  invoiceSubtotal: number | null;
  invoiceTotal: number | null;
  status: 'imported' | 'skipped' | 'error';
  statusReason: string | null;
}

type UploadState = 'idle' | 'previewing' | 'previewed' | 'importing' | 'imported';

// ─── Component ─────────────────────────────────────────────────────────────

export function BillingUploadTab() {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [previewRows, setPreviewRows] = useState<ProjectBundlePreview[]>([]);
  const [importRows, setImportRows] = useState<ProjectBundleImport[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);

  const isLoading = uploadState === 'previewing' || uploadState === 'importing';
  const isLocked = uploadState === 'imported';

  // ── File handling ────────────────────────────────────────────────────────

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    setFiles((existing) => {
      const merged = [...existing];
      for (const f of arr) {
        // Dedupe by name
        if (!merged.some((m) => m.name === f.name && m.size === f.size)) {
          merged.push(f);
        }
      }
      return merged;
    });
    setPreviewRows([]);
    setImportRows([]);
    setError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      // Try to walk directories when a folder is dropped
      const collected: File[] = [];
      const promises: Promise<void>[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i]!.webkitGetAsEntry?.();
        if (entry) promises.push(walkEntry(entry, collected));
        else {
          const f = items[i]!.getAsFile();
          if (f) collected.push(f);
        }
      }
      void Promise.all(promises).then(() => {
        if (collected.length > 0) addFiles(collected);
      });
    } else if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
  };

  const removeFile = (name: string) => {
    setFiles((existing) => existing.filter((f) => f.name !== name));
    setPreviewRows([]);
    setImportRows([]);
  };

  const handleReset = () => {
    setFiles([]);
    setPreviewRows([]);
    setImportRows([]);
    setUploadState('idle');
    setError(null);
  };

  // ── Preview ──────────────────────────────────────────────────────────────

  const handlePreview = async () => {
    if (files.length === 0) {
      setError('Drop at least one file first');
      return;
    }
    setUploadState('previewing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('action', 'preview');
      for (const f of files) formData.append('files', f);

      const res = await fetch('/api/billing/upload-weekly-bundle', {
        method: 'POST',
        body: formData,
      });
      const data: Record<string, unknown> = await res.json();

      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Preview failed');
      }

      const projects = data.projects as ProjectBundlePreview[] | undefined;
      if (!Array.isArray(projects)) {
        log.error('bundle preview: unexpected shape', { data });
        throw new Error('Unexpected response from server');
      }

      setPreviewRows(projects);
      setUploadState('previewed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setUploadState('idle');
    }
  };

  // ── Import ───────────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (files.length === 0 || previewRows.length === 0) return;
    setUploadState('importing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('action', 'import');
      for (const f of files) formData.append('files', f);

      const res = await fetch('/api/billing/upload-weekly-bundle', {
        method: 'POST',
        body: formData,
      });
      const data: Record<string, unknown> = await res.json();

      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Import failed');
      }

      const projects = data.projects as ProjectBundleImport[] | undefined;
      if (!Array.isArray(projects)) {
        throw new Error('Unexpected response from server');
      }

      setImportRows(projects);
      setUploadState('imported');

      const importedCount = projects.filter((p) => p.status === 'imported').length;
      const skippedCount = projects.filter((p) => p.status === 'skipped').length;
      const errorCount = projects.filter((p) => p.status === 'error').length;

      if (errorCount === 0 && skippedCount === 0) {
        toast.success(`Imported ${importedCount} project(s) successfully`);
      } else {
        toast(
          `Imported ${importedCount} · skipped ${skippedCount} · errors ${errorCount}`,
          { icon: errorCount > 0 ? '⚠️' : 'ℹ️' },
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setUploadState('previewed');
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const readyRows = useMemo(
    () => previewRows.filter((r) => r.resolved.matched && r.summary && !r.fatalError),
    [previewRows],
  );
  const blockedRows = useMemo(
    () => previewRows.filter((r) => !(r.resolved.matched && r.summary && !r.fatalError)),
    [previewRows],
  );
  const canImport =
    uploadState === 'previewed' && readyRows.length > 0;

  const displayRows: (ProjectBundlePreview | ProjectBundleImport)[] =
    importRows.length > 0 ? importRows : previewRows;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      {!isLocked && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => document.getElementById('billing-bundle-input')?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-[var(--ff-accent)] bg-[var(--ff-accent)]/5'
              : 'border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
          }`}
        >
          <input
            id="billing-bundle-input"
            type="file"
            multiple
            accept=".pdf,.xlsx,.xls"
            onChange={handleSelect}
            className="hidden"
          />
          <Upload className="w-12 h-12 mx-auto text-[var(--ff-text-tertiary)] mb-3" />
          <p className="text-[var(--ff-text-secondary)]">
            Drop the whole <span className="font-mono">WE&lt;date&gt;/</span> folder
            — or select multiple files
          </p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            Payment PDFs, notes XLSX, and zone uptake PDFs are all routed automatically
          </p>
        </div>
      )}

      {/* Selected files list */}
      {files.length > 0 && !isLocked && (
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <p className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
            Selected files ({files.length})
          </p>
          <ul className="space-y-1 max-h-48 overflow-auto">
            {files.map((f) => (
              <li key={f.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-[var(--ff-text-primary)] truncate">
                  {f.name.endsWith('.pdf') ? (
                    <FileText className="w-4 h-4 text-red-400 flex-shrink-0" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-green-400 flex-shrink-0" />
                  )}
                  <span className="truncate">{f.name}</span>
                  <span className="text-[var(--ff-text-tertiary)] flex-shrink-0">
                    ({(f.size / 1024).toFixed(0)} KB)
                  </span>
                </span>
                {uploadState === 'idle' && (
                  <button
                    type="button"
                    onClick={() => removeFile(f.name)}
                    className="text-[var(--ff-text-tertiary)] hover:text-red-400 ml-2 flex-shrink-0"
                    aria-label={`Remove ${f.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-400">Error</p>
            <p className="text-sm text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Preview button */}
      {uploadState === 'idle' && files.length > 0 && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="primary"
            onClick={() => { void handlePreview(); }}
          >
            <Upload className="w-4 h-4" />
            Preview {files.length} file{files.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center gap-3 py-4">
          <InlineSpinner size="sm" />
          <span className="text-[var(--ff-text-secondary)]">
            {uploadState === 'previewing' && 'Parsing bundle…'}
            {uploadState === 'importing' && 'Importing…'}
          </span>
        </div>
      )}

      {/* Per-project result cards */}
      {displayRows.length > 0 && (
        <div className="space-y-3">
          {displayRows.map((row, idx) => (
            <ProjectResultCard key={`${row.projectHint}-${idx}`} row={row} />
          ))}
        </div>
      )}

      {/* Import / reset actions */}
      {uploadState === 'previewed' && (
        <div className="flex flex-col items-end gap-2">
          {blockedRows.length > 0 && (
            <div className="text-xs text-amber-400 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>
                {blockedRows.length} blocked:{' '}
                {blockedRows
                  .map((r) => r.resolved.projectName ?? r.projectHint ?? '(unnamed)')
                  .join(', ')}
                {' '}— will be skipped
              </span>
            </div>
          )}
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={handleReset}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => { void handleImport(); }}
              disabled={!canImport}
              title={canImport ? undefined : 'No projects ready to import'}
            >
              <Upload className="w-4 h-4" />
              Import {readyRows.length} ready
              {blockedRows.length > 0 ? ` · skip ${blockedRows.length}` : ''}
            </Button>
          </div>
        </div>
      )}

      {isLocked && (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={handleReset}>
            <RefreshCw className="w-4 h-4" />
            Upload another week
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Per-project card ─────────────────────────────────────────────────────

function ProjectResultCard({
  row,
}: {
  row: ProjectBundlePreview | ProjectBundleImport;
}) {
  const isImport = 'status' in row;
  const importRow = isImport ? (row as ProjectBundleImport) : null;

  const headerColour =
    importRow?.status === 'imported'
      ? 'border-green-500/30 bg-green-500/5'
      : importRow?.status === 'error'
        ? 'border-red-500/30 bg-red-500/5'
        : importRow?.status === 'skipped'
          ? 'border-amber-500/30 bg-amber-500/5'
          : row.resolved.matched
            ? 'border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]'
            : 'border-amber-500/30 bg-amber-500/5';

  return (
    <div className={`rounded-lg p-4 border space-y-3 ${headerColour}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            {row.resolved.matched ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-400" />
            )}
            <span className="font-semibold text-[var(--ff-text-primary)]">
              {row.resolved.projectName ?? row.projectHint}
            </span>
            {!row.resolved.matched && (
              <span className="text-xs text-amber-400">
                (could not resolve — parsed &quot;{row.projectHint}&quot;)
              </span>
            )}
          </div>
          {row.summary && (
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">
              Week ending {row.summary.weekEnding}
              {row.summary.areaManager && ` · ${row.summary.areaManager}`}
            </p>
          )}
        </div>
        {importRow && (
          <StatusBadge status={importRow.status} />
        )}
      </div>

      {/* Files detected */}
      <div className="flex flex-wrap gap-1.5">
        {row.files.map((f) => (
          <FileKindBadge key={f.name} kind={f.kind} />
        ))}
      </div>

      {/* Metrics */}
      {row.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Metric label="Total ONTs" value={row.summary.totalOnts.toLocaleString()} />
          <Metric label="Claimable" value={row.summary.totalClaimableForPayment.toLocaleString()} />
          <Metric label="Deductions" value={String(row.deductionCount)} />
          <Metric label="Zones / PONs" value={`${row.zoneRowCount} / ${row.ponRowCount}`} />
        </div>
      )}

      {/* Invoice total (only after import) */}
      {importRow?.invoiceTotal != null && (
        <div className="text-sm text-[var(--ff-text-secondary)] border-t border-[var(--ff-border-light)] pt-2">
          Invoice total:{' '}
          <span className="font-semibold text-[var(--ff-text-primary)]">
            R {importRow.invoiceTotal.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
          </span>
        </div>
      )}

      {/* Reconcile */}
      {row.reconcile && (
        <div className={`text-xs flex items-center gap-2 ${row.reconcile.ok ? 'text-green-400' : 'text-amber-400'}`}>
          {row.reconcile.ok ? (
            <CheckCircle className="w-3.5 h-3.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5" />
          )}
          Reconcile: FT ONTs {row.reconcile.ftTotalOnts} vs zone installed{' '}
          {row.reconcile.uptakeInstalled}
          {row.reconcile.delta !== 0 && ` (Δ${row.reconcile.delta})`}
        </div>
      )}

      {/* Fatal error */}
      {row.fatalError && (
        <div className="text-xs text-red-400 flex items-start gap-2">
          <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{row.fatalError}</span>
        </div>
      )}

      {/* Status reason (skip/error) */}
      {importRow?.statusReason && (
        <div className="text-xs text-amber-400 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{importRow.statusReason}</span>
        </div>
      )}

      {/* Parse warnings */}
      {row.parseWarnings.length > 0 && (
        <details className="text-xs">
          <summary className="text-[var(--ff-text-tertiary)] cursor-pointer hover:text-[var(--ff-text-secondary)]">
            {row.parseWarnings.length} parse warning(s)
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {row.parseWarnings.map((w, i) => (
              <li key={i} className="text-[var(--ff-text-tertiary)]">{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded p-2 text-center">
      <p className="text-base font-bold text-[var(--ff-text-primary)]">{value}</p>
      <p className="text-[var(--ff-text-tertiary)]">{label}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: ProjectBundleImport['status'] }) {
  const styles: Record<typeof status, string> = {
    imported: 'bg-green-500/10 text-green-400 border-green-500/30',
    skipped: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    error: 'bg-red-500/10 text-red-400 border-red-500/30',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium border ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function FileKindBadge({ kind }: { kind: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    'ft-payment-pdf': { label: 'Payment PDF', cls: 'text-red-300 bg-red-500/10' },
    'notes-xlsx': { label: 'Notes XLSX', cls: 'text-green-300 bg-green-500/10' },
    'zone-uptake-pdf': { label: 'Zone uptake', cls: 'text-blue-300 bg-blue-500/10' },
    'zone-pon-uptake-pdf': { label: 'Zone+PON uptake', cls: 'text-purple-300 bg-purple-500/10' },
    unknown: { label: 'Unknown', cls: 'text-amber-300 bg-amber-500/10' },
  };
  const entry = map[kind] ?? map['unknown']!;
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${entry.cls}`}>
      {entry.label}
    </span>
  );
}

// ─── webkit directory walker ──────────────────────────────────────────────
// Browsers expose `DataTransferItem.webkitGetAsEntry()` which lets us walk
// dropped directories. This walker collects every regular file into `out`.

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  file?: (cb: (f: File) => void, err?: (e: Error) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: FileSystemEntryLike[]) => void) => void;
  };
}

async function walkEntry(
  entry: FileSystemEntryLike,
  out: File[],
): Promise<void> {
  if (entry.isFile && entry.file) {
    return new Promise<void>((resolve) => {
      entry.file!((f) => {
        out.push(f);
        resolve();
      });
    });
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    return new Promise<void>((resolve) => {
      reader.readEntries(async (entries) => {
        for (const e of entries) await walkEntry(e, out);
        resolve();
      });
    });
  }
}
