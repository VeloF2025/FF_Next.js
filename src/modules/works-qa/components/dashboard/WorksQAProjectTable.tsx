import type { WorksQADashboardRow } from '../../types/dashboard.types';

interface WorksQAProjectTableProps {
  projects: WorksQADashboardRow[];
  onSelect: (projectId: string) => void;
}

// Pretty slot name lookup — kept inline so the column stays under 25 chars.
const SLOT_LABEL: Record<string, string> = {
  civil_step_01_key: 'Before', civil_step_02_key: 'During', civil_step_03_key: 'Depth',
  civil_step_04_key: 'End Plates', civil_step_05_key: 'Compaction',
  civil_step_06_key: 'Level', civil_step_07_key: 'After',
  civil_step_08_key: 'Pole Label',
  optical_dome_01_key: 'Dome', optical_dome_02_key: 'Dome Label',
  optical_dome_03_key: 'Open Dome', optical_dome_04_key: 'Splice Prot',
  optical_dome_05_key: 'Slack', optical_dome_06_key: 'Strength',
  optical_dome_07_key: 'Seals', optical_dome_08_key: 'Pole ID',
  main_joint_11_key: 'Cable Entries', main_joint_12_key: 'Strength',
  main_joint_13_key: 'Tube Routing', main_joint_14_key: 'Tray Entries',
  main_joint_15_key: 'Coiling', main_joint_16_key: 'Labels',
};

function pct(n: number, d: number): string {
  if (!d) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

export function WorksQAProjectTable({ projects, onSelect }: WorksQAProjectTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          {/* Multi-level header: 4 groups + project anchor */}
          <tr className="bg-zinc-900/80 text-[10px] uppercase tracking-wide text-zinc-500">
            <th className="px-3 py-1.5 text-left font-medium" rowSpan={2}>Project</th>
            <th className="px-2 py-1.5 text-right font-medium" rowSpan={2}>Poles</th>
            <th className="px-2 py-1.5 text-right font-medium" rowSpan={2}>QA %</th>
            <th className="px-2 py-1.5 text-center font-medium border-l border-zinc-800" colSpan={3}>Disciplines</th>
            <th className="px-2 py-1.5 text-center font-medium border-l border-zinc-800" colSpan={3}>Photo Slots</th>
            <th className="px-2 py-1.5 text-center font-medium border-l border-zinc-800" colSpan={3}>Works-QA</th>
            <th className="px-2 py-1.5 text-center font-medium border-l border-zinc-800" colSpan={4}>Meta</th>
          </tr>
          <tr className="bg-zinc-900/80 text-[10px] uppercase tracking-wide text-zinc-500">
            <th className="px-2 py-1.5 text-right font-medium border-l border-zinc-800">Civil</th>
            <th className="px-2 py-1.5 text-right font-medium">Dome</th>
            <th className="px-2 py-1.5 text-right font-medium">Joint</th>
            <th className="px-2 py-1.5 text-right font-medium border-l border-zinc-800">22/22</th>
            <th className="px-2 py-1.5 text-right font-medium">Partial</th>
            <th className="px-2 py-1.5 text-right font-medium">Most missing</th>
            <th className="px-2 py-1.5 text-right font-medium border-l border-zinc-800">Unassigned</th>
            <th className="px-2 py-1.5 text-right font-medium">Overrides</th>
            <th className="px-2 py-1.5 text-right font-medium">Snags</th>
            <th className="px-2 py-1.5 text-right font-medium border-l border-zinc-800">Zones</th>
            <th className="px-2 py-1.5 text-right font-medium">PONs</th>
            <th className="px-2 py-1.5 text-right font-medium">Photos</th>
            <th className="px-2 py-1.5 text-right font-medium">Last Activity</th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => {
            const partial = p.photo_completeness.partial_high + p.photo_completeness.partial_mid + p.photo_completeness.partial_low;
            const civilPct = pct(p.civil.approved, p.civil.approved + p.civil.in_progress + p.civil.empty);
            const domePct  = pct(p.dome.approved,  p.dome.approved  + p.dome.in_progress  + p.dome.empty);
            const jointPct = pct(p.main_joint.approved, p.main_joint.approved + p.main_joint.in_progress + p.main_joint.empty);
            const mm = p.photo_completeness.most_missing_slot;
            const mmLabel = mm ? (SLOT_LABEL[mm] ?? mm.replace(/_key$/, '')) : '—';

            return (
              <tr
                key={p.project_id}
                onClick={() => onSelect(p.project_id)}
                className="border-t border-zinc-800 hover:bg-zinc-900/60 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2 text-left">
                  <div className="text-zinc-100 font-medium truncate max-w-[160px]" title={p.project_name}>{p.project_name}</div>
                  {p.project_code && <div className="text-[10px] text-zinc-600">{p.project_code}</div>}
                </td>
                <td className="px-2 py-2 text-right text-zinc-200">{p.total_poles.toLocaleString()}</td>
                <td className="px-2 py-2 text-right">
                  <span className={p.qa_progress_pct >= 80 ? 'text-green-400 font-medium' : p.qa_progress_pct >= 40 ? 'text-yellow-400' : 'text-zinc-400'}>
                    {p.qa_progress_pct}%
                  </span>
                </td>
                <td className="px-2 py-2 text-right text-zinc-300 border-l border-zinc-800" title={`${p.civil.approved} / ${p.civil.approved + p.civil.in_progress + p.civil.empty}`}>{civilPct}</td>
                <td className="px-2 py-2 text-right text-zinc-300" title={`${p.dome.approved} / ${p.dome.approved + p.dome.in_progress + p.dome.empty}`}>{domePct}</td>
                <td className="px-2 py-2 text-right text-zinc-300" title={`${p.main_joint.approved} / ${p.main_joint.approved + p.main_joint.in_progress + p.main_joint.empty}`}>{jointPct}</td>
                <td className="px-2 py-2 text-right text-green-400 border-l border-zinc-800">{p.photo_completeness.complete_full.toLocaleString()}</td>
                <td className="px-2 py-2 text-right text-yellow-400">{partial.toLocaleString()}</td>
                <td className="px-2 py-2 text-right text-zinc-300" title={mm ?? ''}>{mmLabel}{p.photo_completeness.most_missing_count > 0 && ` (${p.photo_completeness.most_missing_count})`}</td>
                <td className="px-2 py-2 text-right border-l border-zinc-800">
                  <span className={p.unassigned_total > 0 ? 'text-amber-400' : 'text-zinc-500'}>{p.unassigned_total.toLocaleString()}</span>
                </td>
                <td className="px-2 py-2 text-right">
                  <span className={p.override_count > 0 ? 'text-amber-400' : 'text-zinc-500'}>{p.override_count}</span>
                </td>
                <td className="px-2 py-2 text-right">
                  <span className={p.open_snags > 0 ? 'text-red-400' : 'text-zinc-500'}>{p.open_snags}</span>
                </td>
                <td className="px-2 py-2 text-right text-zinc-300 border-l border-zinc-800">{p.zone_count}</td>
                <td className="px-2 py-2 text-right text-zinc-300">{p.pon_count}</td>
                <td className="px-2 py-2 text-right text-zinc-300">{p.photo_count.toLocaleString()}</td>
                <td className="px-2 py-2 text-right text-zinc-500">
                  {p.last_synced_at ? new Date(p.last_synced_at).toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' }) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
