import { AlertTriangle } from 'lucide-react';

import type { ReportColumn } from '@/services/attendance/reports/types';
import { ReportTable } from './ReportTable';

export type ScopeNote =
  | { kind: 'orgwide' }
  | { kind: 'scoped'; staffCount: number }
  | { kind: 'no_scope'; reason: string };

interface Props {
  /** Report slug — becomes the POPIA audit context for any selfie viewed here. */
  slug: string;
  columns: ReadonlyArray<ReportColumn>;
  rows: Array<Record<string, unknown>>;
  notes: string[];
  scopeNote?: ScopeNote;
  loading: boolean;
  error: string | null;
}

export function ReportResultPanel({ slug, columns, rows, notes, scopeNote, loading, error }: Props) {
  return (
    <>
      {error && (
        <div role="alert" className="mt-4 rounded border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <div>{error}</div>
        </div>
      )}
      {notes.length > 0 && (
        <div className="mt-3 rounded border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 space-y-1">
          {notes.map((note, index) => <div key={index}>• {note}</div>)}
        </div>
      )}
      <div className="mt-4">
        <ReportTable columns={columns} rows={rows} loading={loading} auditContext={slug} />
      </div>
      {scopeNote && (
        <div className="mt-3 text-xs text-neutral-500">
          {scopeNote.kind === 'orgwide' && 'Scope: org-wide.'}
          {scopeNote.kind === 'scoped' && `Scope: ${scopeNote.staffCount.toLocaleString('en-ZA')} staff in your supervisor chain.`}
          {scopeNote.kind === 'no_scope' && scopeNote.reason}
        </div>
      )}
    </>
  );
}
