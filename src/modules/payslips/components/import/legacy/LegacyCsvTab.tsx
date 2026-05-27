/**
 * Legacy CSV + PDFs tab on /staff/payslips/import.
 *
 * Pre-Phase-4 flow: HR uploads a Sage/ISAFlow CSV summary plus an optional
 * bag of PDFs. Server matches PDFs to rows by filename. Kept around for
 * non-VIP exports that don't follow the combined-PDF layout.
 */

import React from 'react';

import { LegacyPanels } from './LegacyPanels';

export interface LegacyPreviewItem {
  rowIndex: number;
  email: string;
  staffId: string | null;
  staffName: string | null;
  payPeriodStart: string;
  payPeriodEnd: string;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  pdfFilename: string | null;
  status: 'ready' | 'no_staff' | 'parse_error';
  errors: string[];
}

export interface LegacyImportResponse {
  ready: LegacyPreviewItem[];
  rowsWithoutPdf: LegacyPreviewItem[];
  unmatchedPdfs: { filename: string }[];
  parseErrors: { rowIndex: number; field: string; message: string }[];
  committed: boolean;
  insertedCount: number;
  updatedCount: number;
}

export function LegacyCsvTab() {
  const [csvFile, setCsvFile] = React.useState<File | null>(null);
  const [pdfFiles, setPdfFiles] = React.useState<File[]>([]);
  const [preview, setPreview] = React.useState<LegacyImportResponse | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (commit: boolean) => {
    if (!csvFile) {
      setError('Pick a CSV file first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('csv', csvFile);
      pdfFiles.forEach((f) => formData.append('pdfs', f));
      formData.append('commit', commit ? 'true' : 'false');

      const res = await fetch('/api/staff/payslips/import', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message ?? `Server returned HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      setPreview(json.data as LegacyImportResponse);
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-200 mb-1">
            CSV summary
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-neutral-300 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-neutral-800 file:text-neutral-100 hover:file:bg-neutral-700"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Required columns:{' '}
            <code>email, pay_period_start, pay_period_end, gross, deductions, net</code>.
            Optional: <code>first_name, last_name</code> + any line-item columns
            (preserved as raw_data).
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-200 mb-1">
            Payslip PDFs (optional)
          </label>
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => setPdfFiles(Array.from(e.target.files ?? []))}
            className="block w-full text-sm text-neutral-300 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-neutral-800 file:text-neutral-100 hover:file:bg-neutral-700"
          />
          <p className="mt-1 text-xs text-neutral-500">
            {pdfFiles.length === 0
              ? 'No PDFs selected — rows will import without an attached PDF.'
              : `${pdfFiles.length} PDF${pdfFiles.length === 1 ? '' : 's'} selected.`}{' '}
            Filenames must include the staff email (or local-part / first.last) AND the
            period (YYYY-MM).
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={!csvFile || submitting}
            className="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 disabled:opacity-50"
          >
            {submitting ? 'Working…' : 'Preview'}
          </button>
          {preview &&
            !preview.committed &&
            preview.parseErrors.length === 0 &&
            (() => {
              const importable =
                preview.ready.filter((r) => r.status === 'ready').length +
                preview.rowsWithoutPdf.filter((r) => r.status === 'ready').length;
              if (importable === 0) return null;
              return (
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={submitting}
                  className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {submitting ? 'Importing…' : `Confirm import (${importable} rows)`}
                </button>
              );
            })()}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </div>
        )}
      </section>

      {preview?.committed && (
        <section className="rounded-2xl border border-emerald-800 bg-emerald-950/50 px-5 py-4 text-sm text-emerald-200">
          Imported successfully — {preview.insertedCount} new, {preview.updatedCount}{' '}
          updated.
        </section>
      )}

      {preview && <LegacyPanels preview={preview} />}
    </div>
  );
}

