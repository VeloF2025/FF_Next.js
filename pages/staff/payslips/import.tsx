/**
 * /staff/payslips/import — HR-only payslip importer.
 *
 * Two tabs:
 *   - Combined PDF (default, recommended): drop the VIP "Velocity-payslips.pdf"
 *     export, the server splits it per-employee, auto-matches to staff, and
 *     HR resolves any unmatched rows via inline dropdowns. PRD-040 Phase 4.
 *   - CSV + PDFs (legacy): the original Phase 3 flow. Still useful for
 *     custom Sage/ISAFlow exports that don't follow the VIP layout.
 */

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { staffConfig } from '@/modules/navigation';

type Tab = 'combined' | 'legacy';

export default function PayslipsImportPage() {
  const [tab, setTab] = React.useState<Tab>('combined');

  return (
    <AppLayout>
      <ModulePage config={staffConfig}>
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          <header>
            <h1 className="text-2xl font-bold">Import payslips</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Upload the monthly payslip export. Preview the result, then confirm.
            </p>
          </header>

          <div className="flex border-b border-neutral-800">
            <TabButton active={tab === 'combined'} onClick={() => setTab('combined')}>
              Combined PDF (recommended)
            </TabButton>
            <TabButton active={tab === 'legacy'} onClick={() => setTab('legacy')}>
              CSV + PDFs (legacy)
            </TabButton>
          </div>

          {tab === 'combined' ? <CombinedPdfTab /> : <LegacyCsvTab />}
        </div>
      </ModulePage>
    </AppLayout>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-blue-500 text-white'
          : 'border-transparent text-neutral-400 hover:text-neutral-200'
      }`}
    >
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────
// Combined-PDF tab
// ──────────────────────────────────────────────────────────────────

import type {
  PreviewRow,
  StaffOption,
  PeriodSkip,
  CombinedImportResponse as CombinedPreview,
  ManualMapping as ManualMappingApi,
} from '@/modules/payslips/types';

// Local UI variants of the API types where the page needs a tighter shape.
interface ManualMapping extends ManualMappingApi {
  savePayrollCode: boolean;
}

interface CasualDraft {
  page: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employmentType: 'casual' | 'permanent';
}

interface SkipDraft {
  page: number;
  reason: string;
}

function CombinedPdfTab() {
  const [pdfFile, setPdfFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<CombinedPreview | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /** Page → manual staff mapping (HR picked from dropdown). */
  const [manualByPage, setManualByPage] = React.useState<Map<number, ManualMapping>>(
    new Map()
  );
  /** Page → casual draft (HR opened inline create form). */
  const [casualByPage, setCasualByPage] = React.useState<Map<number, CasualDraft>>(
    new Map()
  );
  /** Page → skip flag with optional reason. */
  const [skipByPage, setSkipByPage] = React.useState<Map<number, SkipDraft>>(new Map());
  /** Re-import already-imported rows (overwrite + replace PDFs). */
  const [forceReimport, setForceReimport] = React.useState(false);

  /** Effective resolution per page: 'match' | 'casual' | 'skip' | null. */
  const resolutionByPage = React.useMemo(() => {
    const map = new Map<
      number,
      { kind: 'match'; staffId: string } | { kind: 'casual' } | { kind: 'skip' } | null
    >();
    if (!preview) return map;
    for (const row of preview.pages) {
      if (skipByPage.has(row.page)) {
        map.set(row.page, { kind: 'skip' });
      } else if (casualByPage.has(row.page)) {
        map.set(row.page, { kind: 'casual' });
      } else {
        const manual = manualByPage.get(row.page);
        const staffId = manual?.staffId ?? row.match.staffId;
        map.set(row.page, staffId ? { kind: 'match', staffId } : null);
      }
    }
    return map;
  }, [preview, manualByPage, casualByPage, skipByPage]);

  const allResolved = preview
    ? preview.pages.every((p) => resolutionByPage.get(p.page) !== null)
    : false;
  const unresolvedCount = preview
    ? preview.pages.filter((p) => resolutionByPage.get(p.page) === null).length
    : 0;

  // Counts that drive the submit-button label.
  const counts = React.useMemo(() => {
    if (!preview) return { newRows: 0, willUpdate: 0, willSkip: 0, willNoop: 0, willCreate: 0 };
    let newRows = 0;
    let willUpdate = 0;
    let willSkip = 0;
    let willNoop = 0;
    let willCreate = 0;
    for (const row of preview.pages) {
      const resolution = resolutionByPage.get(row.page);
      if (resolution?.kind === 'skip') {
        willSkip++;
        continue;
      }
      if (resolution?.kind === 'casual') {
        willCreate++;
        newRows++;
        continue;
      }
      if (!resolution) continue;
      if (forceReimport) {
        if (row.rowState === 'already_imported' || row.rowState === 'matched_changed') {
          willUpdate++;
        } else {
          newRows++;
        }
        continue;
      }
      if (row.rowState === 'already_imported') {
        willNoop++;
      } else if (row.rowState === 'matched_changed') {
        willUpdate++;
      } else {
        newRows++;
      }
    }
    return { newRows, willUpdate, willSkip, willNoop, willCreate };
  }, [preview, resolutionByPage, forceReimport]);

  const submit = async (commit: boolean) => {
    if (!pdfFile) {
      setError('Pick the combined payslips PDF first.');
      return;
    }
    if (commit && !allResolved) {
      setError(`${unresolvedCount} row(s) still need a decision (map, create, or skip).`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('pdf', pdfFile);
      formData.append('commit', commit ? 'true' : 'false');
      formData.append('forceReimport', forceReimport ? 'true' : 'false');
      if (commit && manualByPage.size > 0) {
        formData.append(
          'manualMappings',
          JSON.stringify(Array.from(manualByPage.values()))
        );
      }
      if (commit && casualByPage.size > 0) {
        formData.append('casualCreates', JSON.stringify(Array.from(casualByPage.values())));
      }
      if (commit && skipByPage.size > 0) {
        formData.append('skipPages', JSON.stringify(Array.from(skipByPage.values())));
      }
      const res = await fetch('/api/staff/payslips/import-combined', {
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
      setPreview(json.data as CombinedPreview);
      if (!commit) {
        setManualByPage(new Map());
        setCasualByPage(new Map());
        setSkipByPage(new Map());
      }
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setSubmitting(false);
    }
  };

  const setMapping = (page: number, staffId: string | null, savePayrollCode: boolean) => {
    setManualByPage((prev) => {
      const next = new Map(prev);
      if (!staffId) {
        next.delete(page);
      } else {
        next.set(page, { page, staffId, savePayrollCode });
      }
      return next;
    });
    // Picking a manual staff clears any pending casual/skip on the same row.
    setCasualByPage((prev) => {
      if (!prev.has(page)) return prev;
      const next = new Map(prev);
      next.delete(page);
      return next;
    });
    setSkipByPage((prev) => {
      if (!prev.has(page)) return prev;
      const next = new Map(prev);
      next.delete(page);
      return next;
    });
  };

  const setCasualDraft = (page: number, draft: CasualDraft | null) => {
    setCasualByPage((prev) => {
      const next = new Map(prev);
      if (!draft) next.delete(page);
      else next.set(page, draft);
      return next;
    });
    if (draft) {
      setManualByPage((prev) => {
        if (!prev.has(page)) return prev;
        const next = new Map(prev);
        next.delete(page);
        return next;
      });
      setSkipByPage((prev) => {
        if (!prev.has(page)) return prev;
        const next = new Map(prev);
        next.delete(page);
        return next;
      });
    }
  };

  const toggleSkip = (page: number, reason?: string) => {
    setSkipByPage((prev) => {
      const next = new Map(prev);
      if (next.has(page)) {
        next.delete(page);
      } else {
        next.set(page, { page, reason: reason ?? '' });
      }
      return next;
    });
  };

  const skipAllUnmatched = () => {
    if (!preview) return;
    setSkipByPage((prev) => {
      const next = new Map(prev);
      for (const row of preview.pages) {
        const resolution = resolutionByPage.get(row.page);
        if (resolution === null || row.rowState === 'unmatched') {
          if (!next.has(row.page)) {
            next.set(row.page, { page: row.page, reason: 'Bulk-skipped on import' });
          }
        }
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-200 mb-1">
            Combined payslips PDF
          </label>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setPdfFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setManualByPage(new Map());
              setCasualByPage(new Map());
              setSkipByPage(new Map());
              setForceReimport(false);
            }}
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
            onClick={() => submit(false)}
            disabled={!pdfFile || submitting}
            className="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 disabled:opacity-50"
          >
            {submitting ? 'Working…' : 'Preview'}
          </button>
          {preview && !preview.committed && (
            <button
              type="button"
              onClick={() => submit(true)}
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
                onChange={(e) => setForceReimport(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Re-import everything (overwrite already-imported rows + replace PDFs)
            </label>
            {preview.pages.some(
              (p) => p.rowState === 'unmatched' && !skipByPage.has(p.page)
            ) && (
              <button
                type="button"
                onClick={skipAllUnmatched}
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

      {preview?.committed && (
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
      )}

      {preview && preview.periodSkips.filter((s) => s.resolvedAt === null).length > 0 && (
        <PeriodSkipsPanel skips={preview.periodSkips} />
      )}

      {preview && (
        <CombinedPreviewPanel
          preview={preview}
          manualByPage={manualByPage}
          casualByPage={casualByPage}
          skipByPage={skipByPage}
          resolutionByPage={resolutionByPage}
          forceReimport={forceReimport}
          onSetMapping={setMapping}
          onSetCasual={setCasualDraft}
          onToggleSkip={toggleSkip}
        />
      )}
    </div>
  );
}

function PeriodSkipsPanel({ skips }: { skips: PeriodSkip[] }) {
  const unresolved = skips.filter((s) => s.resolvedAt === null);
  return (
    <section className="rounded-2xl border border-amber-800 bg-amber-950/40 px-5 py-4 space-y-2">
      <h2 className="text-sm font-semibold text-amber-100">
        Skipped this period ({unresolved.length})
      </h2>
      <p className="text-xs text-amber-200/80">
        These empCodes were skipped on a previous import for this period.
        They&apos;ll clear automatically when the matching staff record exists
        and you re-run the import.
      </p>
      <ul className="text-xs text-amber-100 space-y-1">
        {unresolved.map((s) => (
          <li key={s.id} className="flex flex-wrap gap-x-3">
            <code className="font-mono">{s.empCode}</code>
            <span>{s.empName ?? '—'}</span>
            <span className="text-amber-300/70">
              {s.reason ?? 'no reason given'}
            </span>
            <span className="text-amber-400/60">
              {new Date(s.skippedAt).toLocaleDateString('en-ZA')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CombinedPreviewPanel({
  preview,
  manualByPage,
  casualByPage,
  skipByPage,
  resolutionByPage,
  forceReimport,
  onSetMapping,
  onSetCasual,
  onToggleSkip,
}: {
  preview: CombinedPreview;
  manualByPage: Map<number, ManualMapping>;
  casualByPage: Map<number, CasualDraft>;
  skipByPage: Map<number, SkipDraft>;
  resolutionByPage: Map<
    number,
    { kind: 'match'; staffId: string } | { kind: 'casual' } | { kind: 'skip' } | null
  >;
  forceReimport: boolean;
  onSetMapping: (page: number, staffId: string | null, savePayrollCode: boolean) => void;
  onSetCasual: (page: number, draft: CasualDraft | null) => void;
  onToggleSkip: (page: number) => void;
}) {
  const totalNet = preview.pages.reduce((acc, p) => acc + (p.nettPayCents ?? 0), 0);
  // Staff IDs already claimed by another page (auto-match or manual map). The
  // dropdown filters these out so HR doesn't accidentally double-assign one
  // staff to two payslips. Casual drafts don't have an id yet, so they
  // can't shadow anyone. Selected-for-this-row is always kept visible.
  const usedStaffIds = React.useMemo(() => {
    const used = new Set<string>();
    for (const row of preview.pages) {
      const manual = manualByPage.get(row.page);
      const id = manual?.staffId ?? row.match.staffId;
      if (id) used.add(id);
    }
    return used;
  }, [preview, manualByPage]);
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-950 px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h2 className="text-sm font-semibold text-neutral-100">
          Preview — {preview.numPages} pages
          {preview.period ? ` · period ${preview.period}` : ''}
        </h2>
        <span className="text-xs text-neutral-400">
          Total net: <span className="tabular-nums">{rand(totalNet)}</span>
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

function RowEntry({
  row,
  manual,
  casual,
  skipped,
  resolution,
  forceReimport,
  staffOptions,
  usedStaffIds,
  readOnly,
  onSetMapping,
  onSetCasual,
  onToggleSkip,
}: {
  row: PreviewRow;
  manual: ManualMapping | undefined;
  casual: CasualDraft | undefined;
  skipped: boolean;
  resolution:
    | { kind: 'match'; staffId: string }
    | { kind: 'casual' }
    | { kind: 'skip' }
    | null;
  forceReimport: boolean;
  staffOptions: StaffOption[];
  usedStaffIds: Set<string>;
  readOnly: boolean;
  onSetMapping: (page: number, staffId: string | null, savePayrollCode: boolean) => void;
  onSetCasual: (page: number, draft: CasualDraft | null) => void;
  onToggleSkip: (page: number) => void;
}) {
  // Decide row tint from resolution.
  let rowClass = 'text-neutral-200';
  if (resolution?.kind === 'skip') rowClass += ' bg-neutral-900/40 opacity-60';
  else if (!resolution) rowClass += ' bg-red-950/30';
  else if (resolution.kind === 'casual') rowClass += ' bg-blue-950/30';

  return (
    <tr className={rowClass}>
      <td className="py-1.5 pr-3 text-xs text-neutral-500">{row.page}</td>
      <td className="py-1.5 pr-3 font-mono text-xs">{row.empCode ?? '—'}</td>
      <td className="py-1.5 pr-3 text-xs">{row.empName ?? '—'}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">
        {row.totalEarningsCents !== null ? rand(row.totalEarningsCents) : '—'}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums">
        {row.totalDeductionsCents !== null ? rand(row.totalDeductionsCents) : '—'}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums font-semibold">
        {row.nettPayCents !== null ? rand(row.nettPayCents) : '—'}
      </td>
      <td className="py-1.5 pr-3">
        <StatusBadge row={row} forceReimport={forceReimport} skipped={skipped} casual={Boolean(casual)} />
      </td>
      <td className="py-1.5 pr-3 align-top">
        <ActionCell
          row={row}
          manual={manual}
          casual={casual}
          skipped={skipped}
          staffOptions={staffOptions}
          usedStaffIds={usedStaffIds}
          readOnly={readOnly}
          onSetMapping={onSetMapping}
          onSetCasual={onSetCasual}
          onToggleSkip={onToggleSkip}
        />
      </td>
    </tr>
  );
}

function StatusBadge({
  row,
  forceReimport,
  skipped,
  casual,
}: {
  row: PreviewRow;
  forceReimport: boolean;
  skipped: boolean;
  casual: boolean;
}) {
  if (skipped) return <Badge tone="neutral">Skipped</Badge>;
  if (casual) return <Badge tone="blue">Will create casual</Badge>;
  if (forceReimport && (row.rowState === 'already_imported' || row.rowState === 'matched_changed')) {
    return <Badge tone="amber">Will overwrite</Badge>;
  }
  switch (row.rowState) {
    case 'new':
      return <Badge tone="green">New</Badge>;
    case 'already_imported':
      return (
        <Badge tone="neutral" title={row.existingPayslip?.importedAt}>
          Already imported
        </Badge>
      );
    case 'matched_changed':
      return <Badge tone="amber">Amounts changed</Badge>;
    case 'previously_skipped':
      return <Badge tone="amber">Previously skipped</Badge>;
    case 'unmatched':
    default:
      return <Badge tone="red">Unmatched</Badge>;
  }
}

function Badge({
  tone,
  children,
  title,
}: {
  tone: 'green' | 'amber' | 'red' | 'neutral' | 'blue';
  children: React.ReactNode;
  title?: string;
}) {
  const tones = {
    green: 'bg-emerald-900/50 text-emerald-200 border-emerald-700',
    amber: 'bg-amber-900/50 text-amber-100 border-amber-700',
    red: 'bg-red-900/50 text-red-100 border-red-700',
    neutral: 'bg-neutral-800 text-neutral-300 border-neutral-700',
    blue: 'bg-blue-900/50 text-blue-100 border-blue-700',
  } as const;
  return (
    <span
      className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tones[tone]}`}
      title={title}
    >
      {children}
    </span>
  );
}

function ActionCell({
  row,
  manual,
  casual,
  skipped,
  staffOptions,
  usedStaffIds,
  readOnly,
  onSetMapping,
  onSetCasual,
  onToggleSkip,
}: {
  row: PreviewRow;
  manual: ManualMapping | undefined;
  casual: CasualDraft | undefined;
  skipped: boolean;
  staffOptions: StaffOption[];
  usedStaffIds: Set<string>;
  readOnly: boolean;
  onSetMapping: (page: number, staffId: string | null, savePayrollCode: boolean) => void;
  onSetCasual: (page: number, draft: CasualDraft | null) => void;
  onToggleSkip: (page: number) => void;
}) {
  const autoMatched = row.match.staffId !== null && row.match.method !== 'unmatched';

  if (readOnly) {
    if (skipped) return <span className="text-xs text-neutral-400">Skipped</span>;
    if (casual)
      return (
        <span className="text-xs text-blue-200">
          Created {casual.firstName} {casual.lastName}
        </span>
      );
    if (manual)
      return (
        <span className="text-xs text-emerald-300">
          {staffOptions.find((s) => s.id === manual.staffId)?.fullName ?? '—'}
        </span>
      );
    return <span className="text-xs text-emerald-300">{row.match.staffName ?? '—'}</span>;
  }

  if (skipped) {
    return (
      <button
        type="button"
        onClick={() => onToggleSkip(row.page)}
        className="text-xs rounded-md border border-neutral-700 px-2 py-1 text-neutral-300 hover:border-neutral-500"
      >
        Undo skip
      </button>
    );
  }

  if (casual) {
    return (
      <CasualForm
        empCode={row.empCode}
        empName={row.empName}
        draft={casual}
        onChange={(draft) => onSetCasual(row.page, draft)}
        onCancel={() => onSetCasual(row.page, null)}
      />
    );
  }

  // Auto-matched and HR hasn't overridden — show the match + a subtle "change/skip" affordance.
  if (autoMatched && !manual) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-emerald-300">{row.match.staffName}</span>
          <span className="text-[10px] text-neutral-500">
            {row.match.method.replace('_', ' ')}
            {row.match.method === 'name_fuzzy' &&
              ` · ${(row.match.confidence * 100).toFixed(0)}%`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onToggleSkip(row.page)}
          title="Skip this row"
          className="text-[10px] text-neutral-500 hover:text-neutral-300"
        >
          skip
        </button>
      </div>
    );
  }

  // Unmatched / manually-mapped — show the searchable dropdown + create-casual + skip.
  // Hide already-used staff from the options, but always keep this row's
  // current selection visible so HR can see what they have set.
  const hideIds = new Set(usedStaffIds);
  if (manual?.staffId) hideIds.delete(manual.staffId);
  return (
    <div className="flex flex-col gap-1.5">
      <SearchableStaffSelect
        value={manual?.staffId ?? null}
        options={staffOptions}
        excludeIds={hideIds}
        onChange={(staffId) =>
          onSetMapping(row.page, staffId, manual?.savePayrollCode ?? true)
        }
      />
      <div className="flex items-center gap-2 text-[10px]">
        {manual && row.empCode && (
          <label className="flex items-center gap-1 text-neutral-400">
            <input
              type="checkbox"
              checked={manual.savePayrollCode}
              onChange={(e) =>
                onSetMapping(row.page, manual.staffId, e.target.checked)
              }
              className="h-3 w-3"
            />
            Remember <code className="text-neutral-300">{row.empCode}</code>
          </label>
        )}
        {!manual && (
          <button
            type="button"
            onClick={() =>
              onSetCasual(row.page, {
                page: row.page,
                firstName: guessFirstName(row.empName) ?? '',
                lastName: guessLastName(row.empName) ?? '',
                email: '',
                phone: '',
                employmentType: 'casual',
              })
            }
            className="text-blue-400 hover:text-blue-300"
          >
            + create casual
          </button>
        )}
        <button
          type="button"
          onClick={() => onToggleSkip(row.page)}
          className="text-neutral-500 hover:text-neutral-300"
        >
          skip
        </button>
      </div>
    </div>
  );
}

/**
 * Searchable single-select for the staff list. Native <select> can't filter
 * by typing, which is unworkable once the org has 80+ staff plus casuals.
 *
 * - Type to filter (matches against fullName + email, case-insensitive).
 * - Arrow keys to navigate, Enter to pick, Esc to close.
 * - List is already sorted alphabetically by the server (last_name ASC,
 *   first_name ASC) — we keep that order rather than re-sorting client-side.
 */
function SearchableStaffSelect({
  value,
  options,
  excludeIds,
  onChange,
}: {
  value: string | null;
  options: StaffOption[];
  /** Staff already mapped to other rows in this import — hidden from the list. */
  excludeIds?: Set<string>;
  onChange: (staffId: string | null) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlightIdx, setHighlightIdx] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selected = value ? options.find((o) => o.id === value) ?? null : null;

  const visibleOptions = React.useMemo(() => {
    if (!excludeIds || excludeIds.size === 0) return options;
    return options.filter((o) => !excludeIds.has(o.id));
  }, [options, excludeIds]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleOptions;
    return visibleOptions.filter(
      (o) =>
        o.fullName.toLowerCase().includes(q) ||
        o.email.toLowerCase().includes(q)
    );
  }, [visibleOptions, query]);

  // Close on click outside.
  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Reset highlight when filter changes.
  React.useEffect(() => {
    setHighlightIdx(0);
  }, [query, open]);

  const commit = (staffId: string | null) => {
    onChange(staffId);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[highlightIdx];
      if (pick) commit(pick.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="w-full rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1 text-left flex items-center justify-between gap-2"
      >
        <span className={selected ? '' : 'text-neutral-500'}>
          {selected
            ? `${selected.fullName}${
                selected.employmentType === 'casual' ? ' (casual)' : ''
              }`
            : '— pick staff —'}
        </span>
        <span className="text-neutral-500">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-md border border-neutral-700 bg-neutral-900 shadow-lg max-h-64 overflow-hidden flex flex-col">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full bg-neutral-800 border-b border-neutral-700 text-xs text-neutral-100 px-2 py-1.5 outline-none"
          />
          <ul className="overflow-y-auto" role="listbox">
            {selected && (
              <li
                role="option"
                aria-selected="false"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(null);
                }}
                className="px-2 py-1 text-[10px] text-red-300 hover:bg-neutral-800 cursor-pointer border-b border-neutral-800"
              >
                Clear selection
              </li>
            )}
            {filtered.length === 0 && (
              <li className="px-2 py-1.5 text-[10px] text-neutral-500">
                {visibleOptions.length === 0
                  ? 'Every staff is already mapped to another row.'
                  : 'No matches.'}
              </li>
            )}
            {filtered.map((s, idx) => (
              <li
                key={s.id}
                role="option"
                aria-selected={s.id === value}
                onMouseEnter={() => setHighlightIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(s.id);
                }}
                className={`px-2 py-1 text-xs cursor-pointer ${
                  idx === highlightIdx ? 'bg-blue-900/50' : 'hover:bg-neutral-800'
                } ${s.id === value ? 'text-emerald-300' : 'text-neutral-100'}`}
              >
                <div>
                  {s.fullName}
                  {s.employmentType === 'casual' && (
                    <span className="ml-1 text-[10px] text-neutral-500">(casual)</span>
                  )}
                </div>
                <div className="text-[10px] text-neutral-500">{s.email}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CasualForm({
  empCode,
  empName,
  draft,
  onChange,
  onCancel,
}: {
  empCode: string | null;
  empName: string | null;
  draft: CasualDraft;
  onChange: (draft: CasualDraft) => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-blue-800 bg-blue-950/30 p-2 space-y-1.5">
      <div className="text-[10px] text-blue-300">
        Create from {empCode ?? 'PDF'} ({empName ?? '—'})
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <input
          type="text"
          placeholder="First name"
          value={draft.firstName}
          onChange={(e) => onChange({ ...draft, firstName: e.target.value })}
          className="rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1"
        />
        <input
          type="text"
          placeholder="Last name"
          value={draft.lastName}
          onChange={(e) => onChange({ ...draft, lastName: e.target.value })}
          className="rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1"
        />
        <input
          type="email"
          placeholder="email@example.com"
          value={draft.email}
          onChange={(e) => onChange({ ...draft, email: e.target.value })}
          className="rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1 col-span-2"
        />
        <input
          type="tel"
          placeholder="0XX XXX XXXX"
          value={draft.phone}
          onChange={(e) => onChange({ ...draft, phone: e.target.value })}
          className="rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1"
        />
        <select
          value={draft.employmentType}
          onChange={(e) =>
            onChange({
              ...draft,
              employmentType: e.target.value as 'casual' | 'permanent',
            })
          }
          className="rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1"
        >
          <option value="casual">Casual</option>
          <option value="permanent">Permanent</option>
        </select>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-neutral-400 hover:text-neutral-200"
        >
          cancel
        </button>
      </div>
    </div>
  );
}

function guessFirstName(empName: string | null): string | null {
  if (!empName) return null;
  // VIP renders names like "Mr B Viviers" or "Ms J George" — the second
  // token is just an initial; we leave it blank (HR types the full first
  // name). For names like "Mrs C Cordier" we still take the initial as a
  // hint by capitalising it.
  const tokens = empName.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').trim().split(/\s+/);
  if (tokens.length === 0) return null;
  const first = tokens[0]!;
  return first.length === 1 ? first.toUpperCase() : first;
}

function guessLastName(empName: string | null): string | null {
  if (!empName) return null;
  const tokens = empName.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').trim().split(/\s+/);
  if (tokens.length < 2) return null;
  return tokens[tokens.length - 1] ?? null;
}

// ──────────────────────────────────────────────────────────────────
// Legacy CSV + PDFs tab (unchanged behaviour from PR3)
// ──────────────────────────────────────────────────────────────────

interface LegacyPreviewItem {
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

interface LegacyImportResponse {
  ready: LegacyPreviewItem[];
  rowsWithoutPdf: LegacyPreviewItem[];
  unmatchedPdfs: { filename: string }[];
  parseErrors: { rowIndex: number; field: string; message: string }[];
  committed: boolean;
  insertedCount: number;
  updatedCount: number;
}

function LegacyCsvTab() {
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

      {preview && <LegacyPreviewPanel preview={preview} />}
    </div>
  );
}

function LegacyPreviewPanel({ preview }: { preview: LegacyImportResponse }) {
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

function LegacyRowTable({ rows }: { rows: LegacyPreviewItem[] }) {
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
              <td className="py-1.5 pr-3 text-right tabular-nums">{rand(r.grossCents)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {rand(r.deductionsCents)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums font-semibold">
                {rand(r.netCents)}
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
