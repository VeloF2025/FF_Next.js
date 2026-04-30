/**
 * Presentational sub-panels for the legacy CSV+PDFs tab.
 * Split out of LegacyCsvTab to keep both files under the 300-line cap.
 */

import React from 'react';

import { formatRand } from '../formatters';
import type { LegacyImportResponse, LegacyPreviewItem } from './LegacyCsvTab';

export function LegacyPanels({ preview }: { preview: LegacyImportResponse }) {
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
          <LegacyRowTable rows={preview.ready} />
        </Panel>
      )}

      {preview.rowsWithoutPdf.length > 0 && (
        <Panel
          title={`No PDF attached (${preview.rowsWithoutPdf.length})`}
          tone="amber"
        >
          <LegacyRowTable rows={preview.rowsWithoutPdf} />
        </Panel>
      )}

      {preview.unmatchedPdfs.length > 0 && (
        <Panel title={`Unmatched PDFs (${preview.unmatchedPdfs.length})`} tone="amber">
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

export function LegacyRowTable({ rows }: { rows: LegacyPreviewItem[] }) {
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
                <div>
                  {r.staffName ?? <span className="text-red-300">{r.email}</span>}
                </div>
                {r.staffName && (
                  <div className="text-xs text-neutral-500">{r.email}</div>
                )}
              </td>
              <td className="py-1.5 pr-3 whitespace-nowrap">
                {r.payPeriodStart} → {r.payPeriodEnd}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {formatRand(r.grossCents)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {formatRand(r.deductionsCents)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums font-semibold">
                {formatRand(r.netCents)}
              </td>
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
                  <span
                    className="text-xs text-red-300"
                    title={r.errors.join('; ')}
                  >
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
