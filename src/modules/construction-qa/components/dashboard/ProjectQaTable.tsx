/**
 * Project QA Table
 *
 * Compact table/grid view of project QA data as an alternative to cards.
 * Each row is clickable and navigates to the project detail page.
 */

'use client';

import { useRouter } from 'next/router';
import type { ProjectDashboardRow } from '../../types/dashboard.types';

interface ProjectQaTableProps {
  projects: ProjectDashboardRow[];
}

export function ProjectQaTable({ projects }: ProjectQaTableProps) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto border border-[var(--border-color)] rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-800/60 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-4 py-3 font-medium">Project</th>
            <th className="text-right px-3 py-3 font-medium">Features</th>
            <th className="text-right px-3 py-3 font-medium">QA %</th>
            <th className="text-right px-3 py-3 font-medium">Civil</th>
            <th className="text-right px-3 py-3 font-medium">Optical</th>
            <th className="text-right px-3 py-3 font-medium">Splicing</th>
            <th className="text-right px-3 py-3 font-medium">Poles</th>
            <th className="text-right px-3 py-3 font-medium">Joints</th>
            <th className="text-right px-3 py-3 font-medium">Spans</th>
            <th className="text-right px-3 py-3 font-medium">Zones</th>
            <th className="text-right px-3 py-3 font-medium">PONs</th>
            <th className="text-right px-3 py-3 font-medium">Photos</th>
            <th className="text-right px-3 py-3 font-medium">OTDR</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-color)]">
          {projects.map(p => {
            const approved = p.civil.approved + p.optical.approved + p.splicing.approved;
            const pct = p.total_features > 0 ? Math.round((approved / p.total_features) * 100) : 0;
            const infra = p.infrastructure;

            return (
              <tr
                key={p.project_id}
                onClick={() => router.push(`/field-ops/project/${p.project_id}`)}
                className="bg-[var(--card-bg)] hover:bg-[var(--hover-bg)] cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{p.project_name}</div>
                  {/* Mini progress bar */}
                  <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden flex mt-1">
                    {p.total_features > 0 && (
                      <>
                        <div className="h-full bg-green-500" style={{ width: `${(approved / p.total_features) * 100}%` }} />
                        <div className="h-full bg-yellow-500" style={{ width: `${((p.civil.pending + p.optical.pending + p.splicing.pending) / p.total_features) * 100}%` }} />
                      </>
                    )}
                  </div>
                </td>
                <td className="text-right px-3 py-3 text-gray-300 font-mono">{p.total_features.toLocaleString()}</td>
                <td className="text-right px-3 py-3 font-mono">
                  <span className={pct > 0 ? 'text-green-400' : 'text-gray-500'}>{pct}%</span>
                </td>
                <td className="text-right px-3 py-3 text-gray-300 font-mono">{p.civil.total || <span className="text-gray-600">-</span>}</td>
                <td className="text-right px-3 py-3 text-gray-300 font-mono">{p.optical.total || <span className="text-gray-600">-</span>}</td>
                <td className="text-right px-3 py-3 text-gray-300 font-mono">{p.splicing.total || <span className="text-gray-600">-</span>}</td>
                <td className="text-right px-3 py-3 font-mono">
                  {infra.poles.total > 0 ? (
                    <div>
                      <span className="text-gray-300">{infra.poles.total.toLocaleString()}</span>
                      {infra.poles.planted > 0 && (
                        <div className="text-[10px] text-blue-400">{infra.poles.planted} pl</div>
                      )}
                    </div>
                  ) : <span className="text-gray-600">-</span>}
                </td>
                <td className="text-right px-3 py-3 font-mono">
                  {infra.joints.total > 0 ? (
                    <span className="text-gray-300">{infra.joints.total.toLocaleString()}</span>
                  ) : <span className="text-gray-600">-</span>}
                </td>
                <td className="text-right px-3 py-3 font-mono">
                  {infra.cable_spans.total > 0 ? (
                    <span className="text-gray-300">{infra.cable_spans.total.toLocaleString()}</span>
                  ) : <span className="text-gray-600">-</span>}
                </td>
                <td className="text-right px-3 py-3 text-gray-300 font-mono">{p.zone_count}</td>
                <td className="text-right px-3 py-3 text-gray-300 font-mono">{p.pon_count}</td>
                <td className="text-right px-3 py-3 text-gray-300 font-mono">{p.photo_count > 0 ? p.photo_count.toLocaleString() : <span className="text-gray-600">-</span>}</td>
                <td className="text-right px-3 py-3 text-gray-300 font-mono">{p.otdr_count > 0 ? p.otdr_count.toLocaleString() : <span className="text-gray-600">-</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
