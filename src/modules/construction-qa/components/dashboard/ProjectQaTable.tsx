/**
 * Project QA Table
 *
 * Compact table/grid view of project QA data as an alternative to cards.
 * Grouped columns: Poles (Total/Planted/QA'd), Joints (Total/QA'd), Spans (Total/QA'd).
 * Each row is clickable and navigates to the project detail page.
 */

'use client';

import { useRouter } from 'next/router';
import type { ProjectDashboardRow, InfraStats } from '../../types/dashboard.types';

interface ProjectQaTableProps {
  projects: ProjectDashboardRow[];
}

function QaCell({ stats }: { stats: InfraStats }) {
  if (stats.qa_total === 0) return <span className="text-gray-600">-</span>;
  const pct = stats.total > 0 ? Math.round((stats.qa_approved / stats.total) * 100) : 0;
  return (
    <span className="text-green-400">
      {stats.qa_approved} <span className="text-gray-500">({pct}%)</span>
    </span>
  );
}

const dash = <span className="text-gray-600">-</span>;

export function ProjectQaTable({ projects }: ProjectQaTableProps) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto border border-[var(--border-color)] rounded-lg">
      <table className="w-full text-sm">
        <thead>
          {/* Group header row */}
          <tr className="bg-gray-800/80 text-gray-500 text-[10px] uppercase tracking-widest">
            <th colSpan={3} />
            <th colSpan={2} className="text-center px-2 py-1.5 border-l border-[var(--border-color)]">Disciplines</th>
            <th colSpan={3} className="text-center px-2 py-1.5 border-l border-[var(--border-color)]">Poles</th>
            <th colSpan={2} className="text-center px-2 py-1.5 border-l border-[var(--border-color)]">Joints</th>
            <th colSpan={2} className="text-center px-2 py-1.5 border-l border-[var(--border-color)]">Spans</th>
            <th colSpan={4} className="text-center px-2 py-1.5 border-l border-[var(--border-color)]">Meta</th>
          </tr>
          {/* Sub-header row */}
          <tr className="bg-gray-800/60 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-4 py-2 font-medium">Project</th>
            <th className="text-right px-2 py-2 font-medium">Feat</th>
            <th className="text-right px-2 py-2 font-medium">QA %</th>
            {/* Disciplines */}
            <th className="text-right px-2 py-2 font-medium border-l border-[var(--border-color)]">Civil</th>
            <th className="text-right px-2 py-2 font-medium">Optical</th>
            {/* Poles */}
            <th className="text-right px-2 py-2 font-medium border-l border-[var(--border-color)]">Total</th>
            <th className="text-right px-2 py-2 font-medium">Planted</th>
            <th className="text-right px-2 py-2 font-medium">QA&apos;d</th>
            {/* Joints */}
            <th className="text-right px-2 py-2 font-medium border-l border-[var(--border-color)]">Total</th>
            <th className="text-right px-2 py-2 font-medium">QA&apos;d</th>
            {/* Spans */}
            <th className="text-right px-2 py-2 font-medium border-l border-[var(--border-color)]">Total</th>
            <th className="text-right px-2 py-2 font-medium">QA&apos;d</th>
            {/* Meta */}
            <th className="text-right px-2 py-2 font-medium border-l border-[var(--border-color)]">Zones</th>
            <th className="text-right px-2 py-2 font-medium">PONs</th>
            <th className="text-right px-2 py-2 font-medium">Photos</th>
            <th className="text-right px-2 py-2 font-medium">OTDR</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-color)]">
          {projects.map(p => {
            const approved = p.civil.approved + p.optical.approved;
            const pct = p.total_features > 0 ? Math.round((approved / p.total_features) * 100) : 0;
            const { poles, joints, cable_spans } = p.infrastructure;

            return (
              <tr
                key={p.project_id}
                onClick={() => router.push(`/field-ops/project/${p.project_id}`)}
                className="bg-[var(--card-bg)] hover:bg-[var(--hover-bg)] cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{p.project_name}</div>
                  <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden flex mt-1">
                    {p.total_features > 0 && (
                      <>
                        <div className="h-full bg-green-500" style={{ width: `${(approved / p.total_features) * 100}%` }} />
                        <div className="h-full bg-yellow-500" style={{ width: `${((p.civil.pending + p.optical.pending) / p.total_features) * 100}%` }} />
                      </>
                    )}
                  </div>
                </td>
                <td className="text-right px-2 py-3 text-gray-300 font-mono">{p.total_features.toLocaleString()}</td>
                <td className="text-right px-2 py-3 font-mono">
                  <span className={pct > 0 ? 'text-green-400' : 'text-gray-500'}>{pct}%</span>
                </td>
                {/* Disciplines */}
                <td className="text-right px-2 py-3 text-gray-300 font-mono border-l border-[var(--border-color)]">{p.civil.total || dash}</td>
                <td className="text-right px-2 py-3 text-gray-300 font-mono">{p.optical.total || dash}</td>
                {/* Poles: Total / Planted / QA'd */}
                <td className="text-right px-2 py-3 text-gray-300 font-mono border-l border-[var(--border-color)]">
                  {poles.total > 0 ? poles.total.toLocaleString() : dash}
                </td>
                <td className="text-right px-2 py-3 font-mono">
                  {poles.planted > 0 ? <span className="text-blue-400">{poles.planted.toLocaleString()}</span> : dash}
                </td>
                <td className="text-right px-2 py-3 font-mono">
                  <QaCell stats={poles} />
                </td>
                {/* Joints: Total / QA'd */}
                <td className="text-right px-2 py-3 text-gray-300 font-mono border-l border-[var(--border-color)]">
                  {joints.total > 0 ? joints.total.toLocaleString() : dash}
                </td>
                <td className="text-right px-2 py-3 font-mono">
                  <QaCell stats={joints} />
                </td>
                {/* Spans: Total / QA'd */}
                <td className="text-right px-2 py-3 text-gray-300 font-mono border-l border-[var(--border-color)]">
                  {cable_spans.total > 0 ? cable_spans.total.toLocaleString() : dash}
                </td>
                <td className="text-right px-2 py-3 font-mono">
                  <QaCell stats={cable_spans} />
                </td>
                {/* Meta */}
                <td className="text-right px-2 py-3 text-gray-300 font-mono border-l border-[var(--border-color)]">{p.zone_count}</td>
                <td className="text-right px-2 py-3 text-gray-300 font-mono">{p.pon_count}</td>
                <td className="text-right px-2 py-3 text-gray-300 font-mono">{p.photo_count > 0 ? p.photo_count.toLocaleString() : dash}</td>
                <td className="text-right px-2 py-3 text-gray-300 font-mono">{p.otdr_count > 0 ? p.otdr_count.toLocaleString() : dash}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
