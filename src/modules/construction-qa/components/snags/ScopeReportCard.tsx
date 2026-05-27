/**
 * ScopeReportCard — Card variant for snag_reports rows with source='scope'.
 *
 * Shows scope summary (Zones 24, 25 · PONs 265, 266 · Poles X,Y) + date range
 * + total findings + Open PDF / Excel action buttons. Matches the dark-theme
 * styling of existing TQR/Works-QA report cards.
 */

export interface ScopeReport {
  id: string;
  report_number: string;
  source: 'scope';
  scope: 'pole' | 'pon' | 'zone';
  scope_zone_nos: number[] | null;
  scope_pon_nos: number[] | null;
  scope_poles: string[] | null;
  scope_from_date: string;
  scope_to_date: string;
  pdf_url: string | null;
  project_name: string;
  total_findings: number;
  generated_at: string | null;
}

/** Build a human-readable scope summary line from the scope fields. */
function scopeSummary(r: ScopeReport): string {
  const parts: string[] = [];
  if (r.scope_zone_nos && r.scope_zone_nos.length > 0) {
    parts.push(`Zone${r.scope_zone_nos.length > 1 ? 's' : ''} ${r.scope_zone_nos.join(', ')}`);
  }
  if (r.scope_pon_nos && r.scope_pon_nos.length > 0) {
    parts.push(`PON${r.scope_pon_nos.length > 1 ? 's' : ''} ${r.scope_pon_nos.join(', ')}`);
  }
  if (r.scope_poles && r.scope_poles.length > 0) {
    parts.push(`Pole${r.scope_poles.length > 1 ? 's' : ''} ${r.scope_poles.join(', ')}`);
  }
  return parts.join(' · ') || 'Whole project';
}

export function ScopeReportCard({ report }: { report: ScopeReport }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="text-emerald-400 text-xs font-medium uppercase tracking-wide">
            Scoped report
          </div>
          <div className="text-slate-100 font-semibold mt-0.5 truncate">
            {report.report_number}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-slate-300 text-2xl font-semibold">{report.total_findings}</div>
          <div className="text-slate-500 text-xs">snags</div>
        </div>
      </div>

      <div className="text-sm text-slate-300 mb-1">{scopeSummary(report)}</div>
      <div className="text-xs text-slate-500 mb-3">
        {report.scope_from_date} → {report.scope_to_date}
      </div>

      <div className="flex gap-2">
        {report.pdf_url && (
          <a
            href={report.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-500"
          >
            Open PDF
          </a>
        )}
        <a
          href={`/api/snags/reports-scope-xlsx?id=${report.id}`}
          className="px-3 py-1.5 bg-slate-700 text-white rounded text-xs hover:bg-slate-600"
        >
          Excel
        </a>
      </div>
    </div>
  );
}
