import React from 'react';

import type { CombinedImportResponse as CombinedPreview } from '@/modules/payslips/types';

import type { PlanCounts } from './types';
import type { SkipDraft } from './types';

export function ImportUpload({
  pdfFile,
  preview,
  submitting,
  error,
  forceReimport,
  allResolved,
  unresolvedCount,
  counts,
  skipByPage,
  onPickFile,
  onSubmit,
  onForceReimportChange,
  onSkipAllUnmatched,
}: {
  pdfFile: File | null;
  preview: CombinedPreview | null;
  submitting: boolean;
  error: string | null;
  forceReimport: boolean;
  allResolved: boolean;
  unresolvedCount: number;
  counts: PlanCounts;
  skipByPage: Map<number, SkipDraft>;
  onPickFile: (file: File | null) => void;
  onSubmit: (commit: boolean) => Promise<void>;
  onForceReimportChange: (v: boolean) => void;
  onSkipAllUnmatched: () => void;
}) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 space-y-4">
      <div>
        <label className="block text-sm font-medium text-neutral-200 mb-1">
          Combined payslips PDF
        </label>
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-neutral-300 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-neutral-800 file:text-neutral-100 hover:file:bg-neutral-700"
        />
        <p className="mt-1 text-xs text-neutral-500">
          Drop only the VIP <code>Velocity-payslips.pdf</code> file (one page per
          employee). The other monthly PDFs (EMP201, UIF, leave, register, remuneration)
          are not used here.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button
          type="button"
          onClick={() => onSubmit(false)}
          disabled={!pdfFile || submitting}
          className="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 disabled:opacity-50"
        >
          {submitting ? 'Working…' : 'Preview'}
        </button>
        {preview && !preview.committed && (
          <button
            type="button"
            onClick={() => onSubmit(true)}
            disabled={submitting || !allResolved}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            title={!allResolved ? `${unresolvedCount} row(s) still need a decision` : undefined}
          >
            {submitting
              ? 'Importing…'
              : `Confirm — ${counts.newRows} new${
                  counts.willUpdate ? `, ${counts.willUpdate} updated` : ''
                }${counts.willNoop ? `, ${counts.willNoop} unchanged (skipped)` : ''}${
                  counts.willSkip ? `, ${counts.willSkip} manually skipped` : ''
                }`}
          </button>
        )}
        {preview && !preview.committed && counts.willSkip + unresolvedCount === 0 && (
          <span className="text-xs text-neutral-500">All resolved.</span>
        )}
      </div>

      {preview && !preview.committed && (
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <label className="flex items-center gap-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={forceReimport}
              onChange={(e) => onForceReimportChange(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Re-import everything (overwrite already-imported rows + replace PDFs)
          </label>
          {preview.pages.some(
            (p) => p.rowState === 'unmatched' && !skipByPage.has(p.page)
          ) && (
            <button
              type="button"
              onClick={onSkipAllUnmatched}
              className="text-xs rounded-md border border-neutral-700 hover:border-neutral-500 px-2 py-1 text-neutral-300"
            >
              Skip all unmatched
            </button>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </div>
      )}
    </section>
  );
}

export function CommitSummaryBanner({ preview }: { preview: CombinedPreview }) {
  if (!preview.committed) return null;
  return (
    <section className="rounded-2xl border border-emerald-800 bg-emerald-950/50 px-5 py-4 text-sm text-emerald-200 space-y-1">
      <div>
        Import complete — {preview.insertedCount} new
        {preview.updatedCount > 0 && `, ${preview.updatedCount} updated`}
        {preview.unchangedSkipped > 0 &&
          `, ${preview.unchangedSkipped} unchanged (skipped)`}
        {preview.manualSkippedCount > 0 &&
          `, ${preview.manualSkippedCount} manually skipped`}
        {preview.casualsCreated > 0 &&
          `, ${preview.casualsCreated} casual${preview.casualsCreated === 1 ? '' : 's'} created`}
        {preview.payrollCodesSaved > 0 &&
          `, ${preview.payrollCodesSaved} payroll-code mapping${
            preview.payrollCodesSaved === 1 ? '' : 's'
          } saved`}
        .
      </div>
    </section>
  );
}
