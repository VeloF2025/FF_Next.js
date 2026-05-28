import { Camera, AlertTriangle, ShieldAlert, Flag, MapPin, Network, ImageIcon, Clock } from 'lucide-react';
import type { WorksQADashboardRow, DisciplineStats } from '../../types/dashboard.types';

interface WorksQAProjectCardRichProps {
  project: WorksQADashboardRow;
  onClick: () => void;
}

// Pretty slot name lookup — keep in sync with slot-keys.ts labels.
const SLOT_LABEL: Record<string, string> = {
  civil_step_01_key: 'Before Photo', civil_step_02_key: 'During Photo',
  civil_step_03_key: 'Depth Photo',  civil_step_04_key: 'End Plates',
  civil_step_05_key: 'Compaction',   civil_step_06_key: 'Level Check',
  civil_step_07_key: 'After Photo',  civil_step_08_key: 'Pole Label',
  optical_dome_01_key: 'Dome on Pole', optical_dome_02_key: 'Dome Label',
  optical_dome_03_key: 'Open Dome',    optical_dome_04_key: 'Splice Protectors',
  optical_dome_05_key: 'Slack Mgmt',   optical_dome_06_key: 'Strength Members',
  optical_dome_07_key: 'Seals & Caps', optical_dome_08_key: 'Pole ID',
  main_joint_11_key: 'Cable Entries',  main_joint_12_key: 'Strength Members',
  main_joint_13_key: 'Tube Routing',   main_joint_14_key: 'Tray Entries',
  main_joint_15_key: 'Coiling',        main_joint_16_key: 'Readable Labels',
};

function DisciplineTile({ label, stats }: { label: string; stats: DisciplineStats }) {
  const total = stats.approved + stats.in_progress + stats.empty;
  const pct = total > 0 ? Math.round((stats.approved / total) * 100) : 0;
  return (
    <div className="rounded bg-zinc-900 border border-zinc-800 p-2 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
        <span className="text-[10px] text-zinc-400">{stats.capacity} slots</span>
      </div>
      <div className="text-sm text-zinc-100 font-semibold leading-tight">
        {stats.approved.toLocaleString()}<span className="text-zinc-500 text-xs"> / {total.toLocaleString()}</span>
      </div>
      <div className="h-1 bg-zinc-800 rounded overflow-hidden">
        <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>{pct}% approved</span>
        {stats.vlm_failed > 0 && <span className="text-red-400">⚠ {stats.vlm_failed} VLM fail</span>}
      </div>
    </div>
  );
}

function PhotoCompletenessBar({ project }: { project: WorksQADashboardRow }) {
  const c = project.photo_completeness;
  const total = c.complete_21 + c.partial_high + c.partial_mid + c.partial_low + c.no_photos;
  if (total === 0) return null;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">Photo Slots (21 max)</span>
        <span className="text-zinc-500">{c.complete_21.toLocaleString()} / {total.toLocaleString()} complete</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded overflow-hidden flex">
        <div className="bg-green-500"  style={{ width: seg(c.complete_21)  }} title={`Complete (21/21): ${c.complete_21}`} />
        <div className="bg-lime-500"   style={{ width: seg(c.partial_high) }} title={`High (14–20): ${c.partial_high}`} />
        <div className="bg-yellow-500" style={{ width: seg(c.partial_mid)  }} title={`Mid (7–13): ${c.partial_mid}`} />
        <div className="bg-orange-500" style={{ width: seg(c.partial_low)  }} title={`Low (1–6): ${c.partial_low}`} />
        <div className="bg-red-500"    style={{ width: seg(c.no_photos)    }} title={`None: ${c.no_photos}`} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>
          <span className="text-green-400">{c.complete_21}</span> full ·{' '}
          <span className="text-lime-400">{c.partial_high}</span> high ·{' '}
          <span className="text-yellow-400">{c.partial_mid}</span> mid ·{' '}
          <span className="text-orange-400">{c.partial_low}</span> low ·{' '}
          <span className="text-red-400">{c.no_photos}</span> none
        </span>
        {c.most_missing_slot && (
          <span title={c.most_missing_slot}>
            Most missing: <span className="text-zinc-300">{SLOT_LABEL[c.most_missing_slot] ?? c.most_missing_slot}</span> ({c.most_missing_count})
          </span>
        )}
      </div>
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function WorksQAProjectCardRich({ project, onClick }: WorksQAProjectCardRichProps) {
  const overallPct = project.qa_progress_pct;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900 hover:border-zinc-700 transition-colors p-3 flex flex-col gap-2.5"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Camera className="h-4 w-4 text-teal-400 shrink-0" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-zinc-100 truncate">{project.project_name}</h3>
        </div>
        <span className="text-xs text-zinc-500 shrink-0">{project.total_poles.toLocaleString()} poles</span>
      </div>

      {/* QA Progress */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">QA Progress (all 3 disciplines)</span>
          <span className={overallPct >= 80 ? 'text-green-400' : overallPct >= 40 ? 'text-yellow-400' : 'text-zinc-400'}>{overallPct}%</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded overflow-hidden">
          <div className="h-full bg-green-500" style={{ width: `${overallPct}%` }} />
        </div>
        <div className="text-[10px] text-zinc-500">
          <span className="text-green-400">{project.fully_approved.toLocaleString()}</span> approved ·{' '}
          <span className="text-yellow-400">{project.in_progress.toLocaleString()}</span> in progress ·{' '}
          <span className="text-zinc-500">{project.empty.toLocaleString()}</span> empty
        </div>
      </div>

      {/* Discipline tiles */}
      <div className="grid grid-cols-3 gap-1.5">
        <DisciplineTile label="Civil"      stats={project.civil} />
        <DisciplineTile label="Dome"       stats={project.dome} />
        <DisciplineTile label="Main Joint" stats={project.main_joint} />
      </div>

      {/* Photo completeness */}
      <PhotoCompletenessBar project={project} />

      {/* Works-QA extras row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] pt-1 border-t border-zinc-800">
        <span className="flex items-center gap-1 text-zinc-400" title="Photos in per-pole unassigned bucket awaiting manual slot assignment">
          <AlertTriangle className="h-3 w-3 text-amber-400" aria-hidden="true" />
          <span className="text-zinc-200">{project.unassigned_total.toLocaleString()}</span> unassigned
          {project.unassigned_poles > 0 && <span className="text-zinc-500">({project.unassigned_poles} poles)</span>}
        </span>
        <span className="flex items-center gap-1 text-zinc-400" title="Poles approved via force-approve override">
          <ShieldAlert className={`h-3 w-3 ${project.override_count > 0 ? 'text-amber-400' : 'text-zinc-600'}`} aria-hidden="true" />
          <span className="text-zinc-200">{project.override_count}</span> overrides
        </span>
        <span className="flex items-center gap-1 text-zinc-400" title="Open Works-QA snags">
          <Flag className={`h-3 w-3 ${project.open_snags > 0 ? 'text-red-400' : 'text-zinc-600'}`} aria-hidden="true" />
          <span className="text-zinc-200">{project.open_snags}</span> open snags
        </span>
      </div>

      {/* Meta footer */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{project.zone_count} zones</span>
        <span className="flex items-center gap-1"><Network className="h-3 w-3" aria-hidden="true" />{project.pon_count} PONs</span>
        <span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" aria-hidden="true" />{project.photo_count.toLocaleString()} photos</span>
        <span className="flex items-center gap-1 ml-auto"><Clock className="h-3 w-3" aria-hidden="true" />Last activity {formatRelative(project.last_synced_at)}</span>
      </div>
    </button>
  );
}
