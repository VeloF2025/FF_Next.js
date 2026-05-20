/**
 * LegacySnagReportCard — Table-row render for a single resolved snag in the
 * resolution-report viewer. Extracted from SnagReportsPage to honour the
 * 300-line file limit while adding the reports-library section.
 */

interface ReportRowPhoto {
  id: string;
  phase: string;
  photo_url: string;
  thumbnail_url: string | null;
}

interface ReportRowNote {
  content: string;
  note_type: string;
  created_by_name: string | null;
  created_at: string;
}

export interface ReportRow {
  id: string;
  project_name: string;
  report_number: string;
  description: string;
  pole_reference: string | null;
  zone_no: number | null;
  pon_no: number | null;
  category: string;
  severity: string;
  status: string;
  snag_number: number;
  opened_date: string;
  resolved_date: string | null;
  assigned_to_name: string | null;
  noc_ticket_uid: string | null;
  photos: ReportRowPhoto[];
  notes: ReportRowNote[];
}

function fmt(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case 'pending_qa': return 'bg-orange-900/60 text-orange-300';
    case 'resolved':   return 'bg-blue-900/60 text-blue-300';
    case 'verified':   return 'bg-green-900/60 text-green-300';
    case 'closed':     return 'bg-green-900/80 text-green-200';
    case 'open':
    case 'reopened':   return 'bg-red-900/60 text-red-300';
    default:           return 'bg-zinc-700 text-zinc-300';
  }
}

export function statusLabel(s: string): string {
  return s === 'pending_qa' ? 'Pending QA' : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Single table-row for the resolution-report viewer. */
export function LegacySnagReportRow({ row, index }: { row: ReportRow; index: number }) {
  return (
    <tr className="hover:bg-zinc-800/40 transition-colors">
      <td className="px-3 py-2.5 text-xs text-zinc-500 tabular-nums">{index + 1}</td>
      <td className="px-3 py-2.5 text-xs text-zinc-300 whitespace-nowrap">{row.project_name}</td>
      <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap font-mono">{row.report_number}</td>
      <td className="px-3 py-2.5 text-xs text-zinc-400 tabular-nums text-right">{row.snag_number}</td>
      <td className="px-3 py-2.5 text-xs">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-700 text-zinc-300 capitalize">{row.category}</span>
      </td>
      <td className="px-3 py-2.5 text-xs">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-700 text-zinc-300 capitalize">{row.severity}</span>
      </td>
      <td className="px-3 py-2.5 text-xs text-zinc-300 max-w-xs">
        <span className="line-clamp-2">{row.description}</span>
      </td>
      <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap font-mono">{row.pole_reference ?? '—'}</td>
      <td className="px-3 py-2.5 text-xs text-zinc-400 tabular-nums">{row.zone_no ?? '—'}</td>
      <td className="px-3 py-2.5 text-xs text-zinc-400 tabular-nums">{row.pon_no ?? '—'}</td>
      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClass(row.status)}`}>
          {statusLabel(row.status)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmt(row.opened_date)}</td>
      <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmt(row.resolved_date)}</td>
      <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{row.assigned_to_name ?? '—'}</td>
      <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
        {row.photos.length > 0 ? (
          <span className="flex items-center gap-1">
            {row.photos.filter(p => p.phase === 'before').length > 0 && (
              <span className="px-1 py-0.5 rounded text-[10px] bg-zinc-700 text-zinc-300">
                {row.photos.filter(p => p.phase === 'before').length}B
              </span>
            )}
            {row.photos.filter(p => p.phase === 'after').length > 0 && (
              <span className="px-1 py-0.5 rounded text-[10px] bg-blue-900/60 text-blue-300">
                {row.photos.filter(p => p.phase === 'after').length}A
              </span>
            )}
          </span>
        ) : <span className="text-zinc-600">—</span>}
      </td>
      <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
        {row.notes.length > 0
          ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-700 text-zinc-300">{row.notes.length}</span>
          : <span className="text-zinc-600">—</span>}
      </td>
    </tr>
  );
}
