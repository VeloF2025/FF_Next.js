import React from 'react';

import type {
  CombinedImportResponse as CombinedPreview,
} from '@/modules/payslips/types';

import { RowEntry } from './RowEntry';
import { formatRand } from './formatters';
import type { CasualDraft, ManualMapping, Resolution, SkipDraft } from './types';

export function CombinedPreviewPanel({
  preview,
  manualByPage,
  casualByPage,
  skipByPage,
  resolutionByPage,
  forceReimport,
  usedStaffIds,
  onSetMapping,
  onSetCasual,
  onToggleSkip,
}: {
  preview: CombinedPreview;
  manualByPage: Map<number, ManualMapping>;
  casualByPage: Map<number, CasualDraft>;
  skipByPage: Map<number, SkipDraft>;
  resolutionByPage: Map<number, Resolution>;
  forceReimport: boolean;
  usedStaffIds: Set<string>;
  onSetMapping: (page: number, staffId: string | null, savePayrollCode: boolean) => void;
  onSetCasual: (page: number, draft: CasualDraft | null) => void;
  onToggleSkip: (page: number) => void;
}) {
  const totalNet = preview.pages.reduce((acc, p) => acc + (p.nettPayCents ?? 0), 0);
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-950 px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h2 className="text-sm font-semibold text-neutral-100">
          Preview — {preview.numPages} pages
          {preview.period ? ` · period ${preview.period}` : ''}
        </h2>
        <span className="text-xs text-neutral-400">
          Total net: <span className="tabular-nums">{formatRand(totalNet)}</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="py-1.5 pr-3">Page</th>
              <th className="py-1.5 pr-3">Emp</th>
              <th className="py-1.5 pr-3">Name (PDF)</th>
              <th className="py-1.5 pr-3 text-right">Earnings</th>
              <th className="py-1.5 pr-3 text-right">Deductions</th>
              <th className="py-1.5 pr-3 text-right">Net</th>
              <th className="py-1.5 pr-3">Status</th>
              <th className="py-1.5 pr-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {preview.pages.map((row) => (
              <RowEntry
                key={row.page}
                row={row}
                manual={manualByPage.get(row.page)}
                casual={casualByPage.get(row.page)}
                skipped={skipByPage.has(row.page)}
                resolution={resolutionByPage.get(row.page) ?? null}
                forceReimport={forceReimport}
                staffOptions={preview.staffOptions}
                usedStaffIds={usedStaffIds}
                readOnly={preview.committed}
                onSetMapping={onSetMapping}
                onSetCasual={onSetCasual}
                onToggleSkip={onToggleSkip}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
