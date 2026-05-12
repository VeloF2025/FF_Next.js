import type { PoleSummary } from '../types/works-qa.types';

interface PoleListTableProps {
  poles: PoleSummary[];
  selectedPoleId: string | null;
  onSelect: (id: string) => void;
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

export function PoleListTable({ poles, selectedPoleId, onSelect }: PoleListTableProps) {
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
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Joint + Trays</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-28">Status</th>
          </tr>
        </thead>
        <tbody>
          {poles.map(pole => (
            <tr
              key={pole.id}
              onClick={() => onSelect(pole.id)}
              className={`border-b border-zinc-900 cursor-pointer transition-colors hover:bg-zinc-800/50 ${
                selectedPoleId === pole.id ? 'bg-zinc-800/70' : ''
              } ${pole.status === 'approved' ? 'bg-green-500/5' : ''}`}
            >
              <td className="py-2 px-3 font-semibold text-zinc-100">{pole.pole_label}</td>
              <td className="py-2 px-3">
                <PixelStrip filled={pole.civil_filled} total={7} hasFailures={pole.status !== 'approved' && pole.vlm_failures > 0} />
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
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[pole.status]}`}>
                  {STATUS_LABEL[pole.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
