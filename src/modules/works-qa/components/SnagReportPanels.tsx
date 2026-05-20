/**
 * SnagReportPanels — sub-components for SnagReportScopeDialog.
 *
 * Split out to keep the dialog file under the 200-line hard limit.
 */
import { type ScopeKind, type useReportScopeForm } from '../hooks/useReportScopeForm';
import { ScopeChipPicker } from './ScopeChipPicker';

/** Shape of a successfully generated report. */
export interface ReportResult {
  id: string;
  report_number: string;
  pdf_url: string;
}

/** Immutable success panel shown after report generation completes. */
export function ResultPanel({ result, onClose }: { result: ReportResult; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="bg-emerald-950 border border-emerald-700 rounded p-4">
        <div className="text-emerald-300 font-medium">Report ready</div>
        <div className="text-slate-100 mt-1">{result.report_number}</div>
      </div>
      <div className="flex gap-3 flex-wrap">
        <a
          href={result.pdf_url}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700"
        >
          Open PDF
        </a>
        <a
          href={`/api/snags/reports-scope-xlsx?id=${result.id}`}
          className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600"
        >
          Download Excel
        </a>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 bg-slate-800 border border-slate-600 text-slate-200 rounded ml-auto"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** Props for the scope selection form. */
export interface ScopeFormProps {
  form: ReturnType<typeof useReportScopeForm>;
  allZones: number[];
  allPons: number[];
  polesText: string;
  setPolesText: (v: string) => void;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
}

/** Zone / PON / pole scope selection form with date range and filter chips. */
export function ScopeForm({
  form, allZones, allPons, polesText, setPolesText,
  busy, error, onClose, onSubmit,
}: ScopeFormProps) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium text-slate-200 mb-1">Scope</div>
        <div className="flex gap-3">
          {(['zone', 'pon', 'pole'] as ScopeKind[]).map(k => (
            <label key={k} className="flex items-center gap-1 text-sm text-slate-300 capitalize cursor-pointer">
              <input type="radio" name="scope" value={k} checked={form.scope === k}
                onChange={() => form.setScope(k)} disabled={busy} />
              {k}
            </label>
          ))}
        </div>
      </div>

      <ScopeChipPicker label="Zones" options={allZones} selected={form.zones}
        onChange={form.setZones} disabled={busy} />

      {(form.scope === 'pon' || form.scope === 'pole') && (
        <ScopeChipPicker label="PONs" options={allPons} selected={form.pons}
          onChange={form.setPons} disabled={busy} />
      )}

      {form.scope === 'pole' && (
        <div className="mb-3">
          <div className="text-sm font-medium text-slate-200 mb-1">Poles (comma-separated)</div>
          <input
            type="text" value={polesText} onChange={e => setPolesText(e.target.value)}
            placeholder="LAW.P.X001, LAW.P.X002" disabled={busy}
            className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-300">From
          <input type="date" value={form.fromDate} onChange={e => form.setFromDate(e.target.value)}
            disabled={busy}
            className="w-full mt-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100" />
        </label>
        <label className="text-sm text-slate-300">To
          <input type="date" value={form.toDate} onChange={e => form.setToDate(e.target.value)}
            disabled={busy}
            className="w-full mt-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100" />
        </label>
      </div>

      <ScopeChipPicker<string>
        label="Severity" options={['minor', 'major', 'critical']}
        selected={form.severities} onChange={form.setSeverities} disabled={busy}
      />
      <ScopeChipPicker<string>
        label="Category"
        options={['photo_quality', 'pole_quality', 'verification', 'other']}
        selected={form.categories} onChange={form.setCategories} disabled={busy}
      />

      {error && <div className="text-rose-400 text-sm" role="alert">{error}</div>}

      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onClose} disabled={busy}
          className="px-4 py-2 bg-slate-800 border border-slate-600 text-slate-200 rounded">
          Cancel
        </button>
        <button type="button" onClick={onSubmit} disabled={busy}
          className="px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-50">
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </div>
    </div>
  );
}
