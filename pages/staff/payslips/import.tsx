/**
 * /staff/payslips/import — HR-only admin page (PRD-040 Phase 3 / PR3).
 *
 * Two-phase upload UX:
 *   1. HR picks one CSV summary + N PDF files, taps "Preview".
 *   2. Server parses + matches; UI renders ready/unmatched lists.
 *   3. HR taps "Confirm import" — same files re-submit with commit=true,
 *      server uploads PDFs to VF Storage and upserts payslip rows.
 *
 * Files stay in the form's FileList between phases — no re-pick.
 */

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';

interface PreviewItem {
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

interface ImportResponse {
  ready: PreviewItem[];
  rowsWithoutPdf: PreviewItem[];
  unmatchedPdfs: { filename: string }[];
  parseErrors: { rowIndex: number; field: string; message: string }[];
  committed: boolean;
  insertedCount: number;
  updatedCount: number;
}

export default function PayslipsImportPage() {
  const [csvFile, setCsvFile] = React.useState<File | null>(null);
  const [pdfFiles, setPdfFiles] = React.useState<File[]>([]);
  const [preview, setPreview] = React.useState<ImportResponse | null>(null);
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
      setPreview(json.data as ImportResponse);
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Import payslips</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Upload the monthly CSV summary and per-staff PDFs. Preview the result, then confirm.
          </p>
        </header>

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
              Required columns: <code>email, pay_period_start, pay_period_end, gross, deductions, net</code>.
              Optional: <code>first_name, last_name</code> + any line-item columns (preserved as raw_data).
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
                : `${pdfFiles.length} PDF${pdfFiles.length === 1 ? '' : 's'} selected.`}
              {' '}Filenames must include the staff email (or local-part / first.last) AND the period (YYYY-MM).
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
            {preview && !preview.committed && preview.parseErrors.length === 0 && (() => {
              const importable = preview.ready.filter((r) => r.status === 'ready').length
                + preview.rowsWithoutPdf.filter((r) => r.status === 'ready').length;
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
            <div role="alert" className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
        </section>

        {preview?.committed && (
          <section className="rounded-2xl border border-emerald-800 bg-emerald-950/50 px-5 py-4 text-sm text-emerald-200">
            Imported successfully — {preview.insertedCount} new, {preview.updatedCount} updated.
          </section>
        )}

        {preview && (
          <PreviewPanel preview={preview} />
        )}
      </div>
    </AppLayout>
  );
}

function PreviewPanel({ preview }: { preview: ImportResponse }) {
  return (
    <div className="space-y-4">
      {preview.parseErrors.length > 0 && (
        <Panel title={`CSV errors (${preview.parseErrors.length})`} tone="red">
          <ul className="text-sm text-red-200 space-y-1">
            {preview.parseErrors.map((e, i) => (
              <li key={i}>
                Row {e.rowIndex + 1}, <code>{e.field}</code>: {e.message}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {preview.ready.length > 0 && (
        <Panel title={`Ready to import (${preview.ready.length} with PDF)`} tone="emerald">
          <RowTable rows={preview.ready} />
        </Panel>
      )}

      {preview.rowsWithoutPdf.length > 0 && (
        <Panel
          title={`No PDF attached (${preview.rowsWithoutPdf.length})`}
          tone="amber"
        >
          <RowTable rows={preview.rowsWithoutPdf} />
        </Panel>
      )}

      {preview.unmatchedPdfs.length > 0 && (
        <Panel
          title={`Unmatched PDFs (${preview.unmatchedPdfs.length})`}
          tone="amber"
        >
          <ul className="text-sm text-amber-200 space-y-1">
            {preview.unmatchedPdfs.map((p, i) => (
              <li key={i}>
                <code>{p.filename}</code> — no CSV row matched.
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Panel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'red' | 'amber' | 'emerald' | 'neutral';
  children: React.ReactNode;
}) {
  const toneClass = {
    red: 'border-red-800 bg-red-950/40',
    amber: 'border-amber-800 bg-amber-950/40',
    emerald: 'border-emerald-800 bg-emerald-950/40',
    neutral: 'border-neutral-800 bg-neutral-900',
  }[tone];
  return (
    <section className={`rounded-2xl border ${toneClass} px-5 py-4`}>
      <h2 className="text-sm font-semibold text-neutral-100 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function RowTable({ rows }: { rows: PreviewItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
          <tr>
            <th className="py-1.5 pr-3">Staff</th>
            <th className="py-1.5 pr-3">Period</th>
            <th className="py-1.5 pr-3 text-right">Gross</th>
            <th className="py-1.5 pr-3 text-right">Deductions</th>
            <th className="py-1.5 pr-3 text-right">Net</th>
            <th className="py-1.5 pr-3">PDF</th>
            <th className="py-1.5">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((r) => (
            <tr key={r.rowIndex} className="text-neutral-200">
              <td className="py-1.5 pr-3">
                <div>{r.staffName ?? <span className="text-red-300">{r.email}</span>}</div>
                {r.staffName && <div className="text-xs text-neutral-500">{r.email}</div>}
              </td>
              <td className="py-1.5 pr-3 whitespace-nowrap">
                {r.payPeriodStart} → {r.payPeriodEnd}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{rand(r.grossCents)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{rand(r.deductionsCents)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums font-semibold">{rand(r.netCents)}</td>
              <td className="py-1.5 pr-3">
                {r.pdfFilename ? (
                  <span className="text-xs text-emerald-300">{r.pdfFilename}</span>
                ) : (
                  <span className="text-xs text-neutral-500">—</span>
                )}
              </td>
              <td className="py-1.5">
                {r.status === 'ready' ? (
                  <span className="text-xs text-emerald-300">Ready</span>
                ) : (
                  <span className="text-xs text-red-300" title={r.errors.join('; ')}>
                    {r.status}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function rand(cents: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export const getServerSideProps = async () => {
  return { props: {} };
};
