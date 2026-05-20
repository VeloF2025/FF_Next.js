/**
 * WorksQAPageHeader — project-level header strip for WorksQAPage.
 *
 * Contains: back button, project name, zone/PON filter bar, snag-report
 * button, sync button, and an optional ZIP download link. Extracted to keep
 * WorksQAPage.tsx under the 200-line component limit.
 *
 * // 🟢 WORKING: T9 — header extract + SnagReportButton integration.
 */
import type { ReactNode } from 'react';
import { RefreshCw, ArrowLeft, Download } from 'lucide-react';
import { WorksQAFiltersBar } from './WorksQAFiltersBar';
import { SnagReportButton } from './SnagReportButton';
import type { WorksQAZoneSummary } from '../types/works-qa.types';

interface Props {
  /** Display name for the current project. */
  projectName: string;
  /** Project UUID — passed through to SnagReportButton and ZIP link. */
  projectId: string;
  zones: WorksQAZoneSummary[];
  zoneNo: number | null;
  ponNo: number | null;
  /** Currently-selected pole ID (drives the SnagReportButton label). */
  poleId: string | null;
  zonesLoading: boolean;
  syncing: boolean;
  onBack: () => void;
  onSync: () => void;
  onChange: (next: { zone_no?: number | null; pon_no?: number | null }) => void;
  /** Optional right-side slot for additional controls. */
  rightExtra?: ReactNode;
}

export function WorksQAPageHeader(p: Props) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      {/* Left: back arrow, project title, filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={p.onBack}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All projects
        </button>
        <h2 className="text-sm font-semibold text-zinc-100">{p.projectName}</h2>
        {p.zonesLoading ? (
          <span className="text-xs text-zinc-500">Loading zones…</span>
        ) : (
          <WorksQAFiltersBar
            zones={p.zones}
            zoneNo={p.zoneNo}
            ponNo={p.ponNo}
            onChange={p.onChange}
          />
        )}
      </div>

      {/* Right: snag-report button, sync, zip, optional slot */}
      <div className="flex items-center gap-2">
        <SnagReportButton
          projectId={p.projectId}
          ctx={{
            zone_no: p.zoneNo ?? undefined,
            pon_no: p.ponNo ?? undefined,
            pole_id: p.poleId ?? undefined,
          }}
        />
        <button
          type="button"
          onClick={p.onSync}
          disabled={p.syncing}
          className="inline-flex items-center gap-1.5 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-md font-medium transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${p.syncing ? 'animate-spin' : ''}`} />
          {p.syncing ? 'Syncing…' : 'Sync QField'}
        </button>
        {p.ponNo !== null && (
          <a
            href={`/api/works-qa/pon-zip?project_id=${encodeURIComponent(p.projectId)}&pon_no=${p.ponNo}`}
            className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs px-3 py-2 rounded-md font-medium transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            ZIP
          </a>
        )}
        {p.rightExtra}
      </div>
    </div>
  );
}
