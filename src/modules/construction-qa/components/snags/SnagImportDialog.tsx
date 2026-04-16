/**
 * SnagImportDialog — Zero-touch TQR PDF import.
 *
 * Flow:
 *   1. Upload PDF → auto-preview (no DB writes)
 *   2. Review summary → one-click import
 *   3. Done → auto-close after 2 s
 *
 * Sub-components (UploadZone, SummaryRow) live in SnagImportParts.tsx.
 * Status: WORKING
 */

'use client';

import { useState, useCallback } from 'react';
import {
  X,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UploadZone, SummaryRow } from './SnagImportParts';
import { previewPdf, importPdf, type PdfPreviewResult } from '../../services/snagService';
import { log } from '@/lib/logger';

// ============================================================
// Types
// ============================================================

interface SnagImportDialogProps {
  onClose: () => void;
  onImported: (reportId: string) => void;
}

type DialogPhase = 'upload' | 'preview' | 'importing' | 'done';

// ============================================================
// Main Dialog
// ============================================================

/** 🟢 WORKING: Zero-touch TQR PDF import dialog */
export function SnagImportDialog({ onClose, onImported }: SnagImportDialogProps) {
  const [phase, setPhase]         = useState<DialogPhase>('upload');
  const [file, setFile]           = useState<File | null>(null);
  const [preview, setPreview]     = useState<PdfPreviewResult | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [error, setError]         = useState<string | null>(null);
  const [showFindings, setShowFindings] = useState(false);
  const [result, setResult]       = useState<{ snagCount: number; photoCount: number } | null>(null);

  // ── Analyse on file select ────────────────────────────────
  const handleFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setPhase('upload'); // keep zone + spinner visible while loading

    try {
      const data = await previewPdf(selectedFile);
      setPreview(data);
      if (data.project) setProjectId(data.project.id);
      else if (data.projectCandidates[0]) setProjectId(data.projectCandidates[0].id);
      setPhase('preview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Preview failed';
      log.error('SnagImportDialog: preview error', { err });
      setError(msg);
      setPhase('upload');
    }
  }, []);

  // ── Commit import ─────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (!file || !projectId || !preview) return;
    setPhase('importing');
    setError(null);

    try {
      const data = await importPdf(file, projectId);
      setResult({ snagCount: data.snagCount, photoCount: data.photoCount });
      setPhase('done');
      log.info('SnagImportDialog: import complete', { reportId: data.reportId });
      setTimeout(() => { onImported(data.reportId); }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      log.error('SnagImportDialog: import error', { err });
      setError(msg);
      setPhase('preview');
    }
  }, [file, projectId, preview, onImported]);

  const isImportDisabled =
    !projectId || phase === 'importing' || (preview?.isDuplicate ?? false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-100">Import Snag Report</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Upload / analysing phase */}
          {phase === 'upload' && (
            <>
              <UploadZone
                onFile={(f) => { void handleFile(f); }}
                loading={Boolean(file && !error)}
              />
              {error && <ErrorBanner message={error} />}
            </>
          )}

          {/* Preview / importing phase */}
          {(phase === 'preview' || phase === 'importing') && preview && (
            <>
              {preview.isDuplicate && (
                <WarningBanner>
                  <strong>Duplicate:</strong> {preview.metadata.reportNumber} has already been
                  imported{preview.duplicateReportId ? ` (id: ${preview.duplicateReportId})` : ''}.
                  Import is blocked.
                </WarningBanner>
              )}
              {error && <ErrorBanner message={error} />}

              <PreviewCard
                preview={preview}
                projectId={projectId}
                onProjectChange={setProjectId}
                disabled={phase === 'importing'}
              />

              {preview.findings.length > 0 && (
                <FindingsToggle
                  findings={preview.findings}
                  open={showFindings}
                  onToggle={() => setShowFindings((v) => !v)}
                />
              )}
            </>
          )}

          {/* Done phase */}
          {phase === 'done' && result && (
            <DonePanel snagCount={result.snagCount} photoCount={result.photoCount} />
          )}
        </div>

        {/* Footer — only visible during review */}
        {(phase === 'preview' || phase === 'importing') && (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-zinc-800 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={phase === 'importing'}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => { void handleImport(); }}
              disabled={isImportDisabled}
              loading={phase === 'importing'}
            >
              {phase === 'importing' ? 'Importing...' : 'Import Now'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Inline helpers (stateless, small)
// ============================================================

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-lg p-3">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      {message}
    </div>
  );
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-amber-400 text-xs bg-amber-900/20 border border-amber-700 rounded-lg p-3">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

interface PreviewCardProps {
  preview: PdfPreviewResult;
  projectId: string;
  onProjectChange: (id: string) => void;
  disabled: boolean;
}

function PreviewCard({ preview, projectId, onProjectChange, disabled }: PreviewCardProps) {
  return (
    <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-4 space-y-0.5">
      <div className="flex items-center gap-2 mb-2">
        {preview.format === 'field_report' ? (
          <span className="inline-flex items-center rounded-full bg-orange-900/40 border border-orange-700 px-2 py-0.5 text-[10px] font-medium text-orange-300">
            Field Report
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-blue-900/40 border border-blue-700 px-2 py-0.5 text-[10px] font-medium text-blue-300">
            TQR Audit
          </span>
        )}
        <p className="text-xs font-semibold text-zinc-100">
          {preview.metadata.reportNumber} — Ready to Import
        </p>
      </div>

      {/* Project row */}
      <div className="flex items-start gap-2 py-1.5 border-b border-zinc-800">
        <span className="w-28 shrink-0 text-xs text-zinc-500">Project</span>
        <span className="text-xs text-zinc-200 flex-1 flex items-center gap-1.5">
          {preview.project ? (
            <>
              <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
              {preview.project.name}
              <span className="text-zinc-500">(auto-detected)</span>
            </>
          ) : (
            <select
              value={projectId}
              onChange={(e) => onProjectChange(e.target.value)}
              className="bg-zinc-700 border border-zinc-600 rounded text-xs text-zinc-200 px-2 py-1 w-full"
              disabled={disabled}
            >
              <option value="">Select project…</option>
              {preview.projectCandidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </span>
      </div>

      <SummaryRow label="Report No"  value={preview.metadata.reportNumber} />
      <SummaryRow label="Audit Date" value={preview.metadata.auditDate} />
      <SummaryRow label="Site"       value={preview.metadata.siteName ?? '—'} />
      <SummaryRow label="Category"   value={preview.metadata.category} />
      <SummaryRow label="Findings"   value={String(preview.findings.length)} />
      <SummaryRow label="Photos"     value={String(preview.photoCount)} />
      {preview.format !== 'field_report' && (
        <SummaryRow label="Auditor"    value={preview.metadata.auditor ?? '—'} />
      )}
    </div>
  );
}

interface FindingsToggleProps {
  findings: Array<{ number: number; description: string; category: string }>;
  open: boolean;
  onToggle: () => void;
}

function FindingsToggle({ findings, open, onToggle }: FindingsToggleProps) {
  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-4 py-2.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
      >
        <span>View {findings.length} findings</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <ul className="divide-y divide-zinc-800 max-h-40 overflow-y-auto">
          {findings.map((f) => (
            <li key={f.number} className="flex gap-3 px-4 py-2 text-xs">
              <span className="text-zinc-500 shrink-0 w-6 text-right">{f.number}.</span>
              <span className="text-zinc-300">{f.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DonePanel({ snagCount, photoCount }: { snagCount: number; photoCount: number }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <CheckCircle className="h-12 w-12 text-green-400" />
      <p className="text-sm font-semibold text-zinc-100">Import Complete</p>
      <p className="text-xs text-zinc-400">
        Imported {snagCount} findings with {photoCount} photos
      </p>
      <p className="text-xs text-zinc-600 mt-2">Closing in a moment...</p>
    </div>
  );
}
