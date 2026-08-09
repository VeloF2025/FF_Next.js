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
import { SubmitPonButton } from '@/modules/construction-qa/zone-delivery/components/SubmitPonButton';
import { ZoneHandoverButton } from '@/modules/construction-qa/zone-delivery/components/ZoneHandoverButton';
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

      {/* Right: delivery controls, snag-report button, sync, zip, optional slot */}
      <div className="flex items-center gap-2">
        {/* Johan's two controls, on the screen where the work happens. They
            branch on the same zone/PON context the filter bar already carries:
            a PON is selected, or a zone with All PONs. */}
        {p.zoneNo !== null && p.ponNo !== null && (
          <SubmitPonButton
            projectId={p.projectId}
            zoneNo={p.zoneNo}
            ponNo={p.ponNo}
          />
        )}
        {p.zoneNo !== null && p.ponNo === null && (
          <ZoneHandoverButton projectId={p.projectId} zoneNo={p.zoneNo} />
        )}
        {p.zoneNo !== null && (
          <a
            href="/field-ops/tracker"
            className="text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
            title="See submitted PONs and zone handovers by site"
          >
            Tracker
          </a>
        )}
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
          <>
            <a
              href={`/api/works-qa/pon-zip?project_id=${encodeURIComponent(p.projectId)}&pon_no=${p.ponNo}`}
              className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs px-3 py-2 rounded-md font-medium transition-colors"
              title="Download approved poles only"
              aria-label={`Download ZIP of approved poles in PON ${p.ponNo}`}
            >
              <Download className="h-3.5 w-3.5" />
              ZIP
            </a>
            <a
              href={`/api/works-qa/pon-zip?project_id=${encodeURIComponent(p.projectId)}&pon_no=${p.ponNo}&include_unapproved=true`}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
              title="Download every pole in this PON (including in-progress) plus their unassigned photos"
              aria-label={`Download ZIP of all poles in PON ${p.ponNo} including in-progress and unassigned photos`}
            >
              + in-progress
            </a>
          </>
        )}
        {p.zoneNo !== null && p.ponNo === null && (
          <>
            <a
              href={`/api/works-qa/zone-zip?project_id=${encodeURIComponent(p.projectId)}&zone_no=${p.zoneNo}`}
              className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs px-3 py-2 rounded-md font-medium transition-colors"
              title="Download all approved poles in this zone as one ZIP (Zone → PON → Pole). Large zones can be several GB — keep this tab open until it finishes."
              aria-label={`Download ZIP of approved poles in zone ${p.zoneNo}`}
            >
              <Download className="h-3.5 w-3.5" />
              Zone ZIP
            </a>
            <a
              href={`/api/works-qa/zone-zip?project_id=${encodeURIComponent(p.projectId)}&zone_no=${p.zoneNo}&include_unapproved=true`}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
              title="Download every pole in this zone (including in-progress) plus unassigned photos"
              aria-label={`Download ZIP of all poles in zone ${p.zoneNo} including in-progress`}
            >
              + in-progress
            </a>
          </>
        )}
        {p.rightExtra}
      </div>
    </div>
  );
}
