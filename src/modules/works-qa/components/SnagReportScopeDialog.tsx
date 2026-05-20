/**
 * SnagReportScopeDialog — 2-step modal for generating a scoped snag report.
 *
 * Step 1 (form): zone / PON / pole scope selection + date range + filters.
 * Step 2 (result): immutable panel with PDF link and Excel download.
 *
 * Zone + PON options fetched from GET /api/snags/zone-pon-options?projectId=<id>
 * (single call; PONs filtered client-side by selected zones).
 *
 * Poles use a comma-separated text input.
 * TODO(P3+): autocomplete poles via new endpoint once it exists.
 */
import { useEffect, useId, useState } from 'react';
import useSWR from 'swr';
import { useReportScopeForm } from '../hooks/useReportScopeForm';
import { ResultPanel, ScopeForm, type ReportResult } from './SnagReportPanels';
import { log } from '@/lib/logger';

interface Props {
  open: boolean;
  projectId: string;
  defaultCtx: { zone_no?: number; pon_no?: number; pole_id?: string };
  onClose: () => void;
}

interface ZonePonResponse {
  zones: { zone_no: number }[];
  pons: { zone_no: number; pon_no: number }[];
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  const b = await r.json();
  return (b.data ?? b) as T;
};

// 🟢 WORKING: SnagReportScopeDialog — orchestrator; panels in SnagReportPanels.tsx
export function SnagReportScopeDialog({ open, projectId, defaultCtx, onClose }: Props) {
  const titleId = useId();
  const form = useReportScopeForm(defaultCtx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [polesText, setPolesText] = useState<string>(defaultCtx.pole_id ?? '');

  // Sync projectId into hook state so toSubmitBody() includes it
  useEffect(() => { form.setProjectId(projectId); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape-to-close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, busy, onClose]);

  const { data: opts } = useSWR<ZonePonResponse>(
    open ? `/api/snags/zone-pon-options?projectId=${encodeURIComponent(projectId)}` : null,
    fetcher,
  );

  const allZones = opts?.zones.map(z => z.zone_no) ?? [];
  // Filter PONs to those belonging to any selected zone (or show all when no zones selected)
  const allPons =
    form.zones.length === 0
      ? (opts?.pons.map(p => p.pon_no) ?? [])
      : (opts?.pons.filter(p => form.zones.includes(p.zone_no)).map(p => p.pon_no) ?? []);

  if (!open) return null;

  async function submit() {
    setError(null);
    const polesArr = polesText.split(',').map(s => s.trim()).filter(Boolean);

    // Inline validation using prop projectId (avoids async state-update race with hook)
    if (!projectId) { setError('projectId is required'); return; }
    if (form.scope === 'pole' && polesArr.length === 0) { setError('poles[] required when scope=pole'); return; }
    if (form.scope === 'pon'  && form.pons.length  === 0) { setError('pons[] required when scope=pon'); return; }
    if (form.scope === 'zone' && form.zones.length === 0) { setError('zones[] required when scope=zone'); return; }
    if (form.fromDate > form.toDate) { setError('fromDate must be <= toDate'); return; }

    setBusy(true);
    try {
      const body = { ...form.toSubmitBody(), project_id: projectId, poles: polesArr };
      const res = await fetch('/api/snags/reports-scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      const data: ReportResult = payload.data ?? payload;
      setResult(data);
      log.info('snag-report-scope.created', { id: data.id, reportNumber: data.report_number });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-100">Generate snag report</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-200 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {result ? (
          <ResultPanel result={result} onClose={onClose} />
        ) : (
          <ScopeForm
            form={form}
            allZones={allZones}
            allPons={allPons}
            polesText={polesText}
            setPolesText={setPolesText}
            busy={busy}
            error={error}
            onClose={onClose}
            onSubmit={submit}
          />
        )}
      </div>
    </div>
  );
}
