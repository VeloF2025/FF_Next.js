import type { PoleSummary } from '../types/works-qa.types';

interface PoleListTableProps {
  poles: PoleSummary[];
  selectedPoleId: string | null;
  onSelect: (id: string) => void;
  onSnagPole: (pole: PoleSummary) => void;
}

function PixelStrip({ filled, total, hasFailures }: { filled: number; total: number; hasFailures: boolean }) {
  return (
    <div className="flex gap-[2px] items-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-[10px] w-[10px] rounded-[2px] ${
            i < filled
              ? hasFailures
                ? 'bg-red-500/50'
                : 'bg-green-500/30'
              : 'bg-zinc-800'
          }`}
        />
      ))}
    </div>
  );
}

const STATUS_BADGE: Record<PoleSummary['status'], string> = {
  empty:       'bg-zinc-800 text-zinc-500',
  in_progress: 'bg-amber-500/20 text-amber-400',
  ready:       'bg-blue-500/20 text-blue-400',
  approved:    'bg-green-500/20 text-green-400',
};

const STATUS_LABEL: Record<PoleSummary['status'], string> = {
  empty:       'Empty',
  in_progress: 'In Progress',
  ready:       'Ready ▶',
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

export function PoleListTable({ poles, selectedPoleId, onSelect, onSnagPole }: PoleListTableProps) {
  if (poles.length === 0) {
    return (
      <div className="text-sm text-zinc-500 text-center py-12">
        No poles found. Select a PON or run QField sync.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-24">Pole</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Civil</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Dome</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Main Joint + Trays</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-20">Snags</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-28">Status</th>
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
                <PixelStrip filled={pole.civil_filled} total={8} hasFailures={pole.status !== 'approved' && pole.vlm_failures > 0} />
              </td>
              <td className="py-2 px-3">
                <PixelStrip filled={pole.dome_filled} total={8} hasFailures={pole.status !== 'approved' && pole.vlm_failures > 0} />
              </td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <PixelStrip filled={pole.joint_filled} total={6} hasFailures={false} />
                  {(pole.tray_count ?? 0) > 0 && (
                    <span className="text-xs text-zinc-500">+{pole.tray_count}t</span>
                  )}
                </div>
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
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[pole.status]}`}>
                  {STATUS_LABEL[pole.status]}
                </span>
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
