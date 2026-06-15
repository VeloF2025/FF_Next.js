import type { PoleSummary, SlotState } from '../types/works-qa.types';
import { ApproveReadyButton } from './ApproveReadyButton';

interface PoleListTableProps {
  poles: PoleSummary[];
  selectedPoleId: string | null;
  onSelect: (id: string) => void;
  onSnagPole: (pole: PoleSummary) => void;
  onApproved: () => void;
}

// Dot colours for the per-slot review state (see SlotState in works-qa.types).
const SLOT_COLOR: Record<SlotState, string> = {
  approved: 'bg-green-500',       // strong green — a person approved this photo
  pass:     'bg-green-500/30',    // faint green  — VLM-passed, not yet approved
  fail:     'bg-red-500/60',      // red          — snagged or un-overridden VLM fail
  empty:    'bg-zinc-800',        // grey         — no photo
};

function PixelStrip({ states }: { states: SlotState[] }) {
  return (
    <div className="flex gap-[2px] items-center">
      {states.map((s, i) => (
        <div key={i} className={`h-[10px] w-[10px] rounded-[2px] ${SLOT_COLOR[s]}`} />
      ))}
    </div>
  );
}

function DotLegend() {
  const items: [SlotState, string][] = [
    ['approved', 'Approved'],
    ['pass', 'VLM-passed'],
    ['fail', 'Snag / VLM fail'],
    ['empty', 'No photo'],
  ];
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500 mb-2">
      {items.map(([state, label]) => (
        <span key={state} className="flex items-center gap-1">
          <span className={`h-[10px] w-[10px] rounded-[2px] ${SLOT_COLOR[state]}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

const STATUS_BADGE: Record<PoleSummary['status'], string> = {
  empty:       'bg-zinc-800 text-zinc-500',
  in_progress: 'bg-amber-500/20 text-amber-400',
  ready:       'bg-blue-500/20 text-blue-400',
  snagged:     'bg-red-500/20 text-red-400',
  approved:    'bg-green-500/20 text-green-400',
};

const STATUS_LABEL: Record<PoleSummary['status'], string> = {
  empty:       'Empty',
  in_progress: 'In Progress',
  ready:       'Ready ▶',
  snagged:     'Snagged',
  approved:    '✓ Approved',
};

function VerifyFlag({ pole, onClick }: { pole: PoleSummary; onClick: (e: React.MouseEvent) => void }) {
  let icon = '🚩';
  let cls = 'text-zinc-500 hover:text-zinc-300';
  let title = 'Confirm pole planted';
  if (pole.has_open_verification_snag) { icon = '⚠'; cls = 'text-red-400 hover:text-red-300'; title = 'Reported NOT planted — click to revisit'; }
  else if (pole.has_verified_planted) { icon = '✓'; cls = 'text-green-400 hover:text-green-300'; title = 'Confirmed planted — click to revisit'; }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-base ${cls} px-1`}
      title={title}
      aria-label={title}
    >
      {icon}
    </button>
  );
}

export function PoleListTable({ poles, selectedPoleId, onSelect, onSnagPole, onApproved }: PoleListTableProps) {
  if (poles.length === 0) {
    return (
      <div className="text-sm text-zinc-500 text-center py-12">
        No poles found. Select a PON or run QField sync.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <DotLegend />
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-24">Pole</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Civil</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Dome</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Main Joint + Trays</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-16">Photos</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-20">Snags</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-36">Status</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-12">Verify</th>
          </tr>
        </thead>
        <tbody>
          {poles.map(pole => (
            <tr
              key={pole.id}
              onClick={() => onSelect(pole.id)}
              className={`border-b border-zinc-900 cursor-pointer transition-colors hover:bg-zinc-800/50 ${
                selectedPoleId === pole.id ? 'bg-zinc-800/70' : ''
              } ${pole.status === 'approved' ? 'bg-green-500/5' : ''} ${pole.has_open_verification_snag ? 'ring-1 ring-red-500/30' : ''}`}
            >
              <td className="py-2 px-3 font-semibold text-zinc-100">{pole.pole_label}</td>
              <td className="py-2 px-3">
                <PixelStrip states={pole.civil_slots} />
              </td>
              <td className="py-2 px-3">
                <PixelStrip states={pole.dome_slots} />
              </td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <PixelStrip states={pole.joint_slots} />
                  {(pole.tray_count ?? 0) > 0 && (
                    <span className="text-xs text-zinc-500">+{pole.tray_count}t</span>
                  )}
                </div>
              </td>
              <td className="py-2 px-3">
                <span className={pole.total_photos > 0 ? 'text-xs text-zinc-300' : 'text-xs text-zinc-600'}>
                  {pole.total_photos}
                </span>
                {pole.unassigned_count > 0 && (
                  <span className="text-[10px] text-amber-400 ml-1" title={`${pole.unassigned_count} unassigned photo(s) — already included in the total`}>
                    ({pole.unassigned_count})
                  </span>
                )}
              </td>
              <td className="py-2 px-3">
                {pole.outstanding_snag_count > 0 ? (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-500/20 text-red-400">
                    {pole.outstanding_snag_count}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-600">—</span>
                )}
              </td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[pole.status]}`}>
                    {STATUS_LABEL[pole.status]}
                  </span>
                  {pole.status === 'ready' && (
                    <ApproveReadyButton
                      poleId={pole.id}
                      onApproved={onApproved}
                      onNeedsDetail={() => onSelect(pole.id)}
                    />
                  )}
                </div>
              </td>
              <td className="py-2 px-3">
                <VerifyFlag pole={pole} onClick={(e) => { e.stopPropagation(); onSnagPole(pole); }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
