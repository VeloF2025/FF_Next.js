/**
 * Project QA Card
 *
 * Displays a single project's QA summary in the dashboard grid.
 * Shows: name, feature count, QA progress bar, OTDR count, zone/PON counts.
 * Click → navigate to project detail page.
 */

'use client';

import { useRouter } from 'next/router';
import { MapPin, Layers, Radio, Camera } from 'lucide-react';
import type { ProjectDashboardRow } from '../../types/dashboard.types';

interface ProjectQaCardProps {
  project: ProjectDashboardRow;
}

export function ProjectQaCard({ project }: ProjectQaCardProps) {
  const router = useRouter();

  const approved = project.civil.approved + project.optical.approved + project.splicing.approved;
  const total = project.total_features;
  const approvalPct = total > 0 ? Math.round((approved / total) * 100) : 0;

  const pending = project.civil.pending + project.optical.pending + project.splicing.pending;
  const rejected = project.civil.rejected + project.optical.rejected + project.splicing.rejected;

  return (
    <button
      onClick={() => router.push(`/field-ops/project/${project.project_id}`)}
      className="w-full text-left bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-5 hover:border-blue-500/50 hover:bg-[var(--hover-bg)] transition-all group"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-base font-semibold text-white group-hover:text-blue-400 transition-colors">
          {project.project_name}
        </h3>
        <span className="text-xs text-gray-500 font-mono">
          {total.toLocaleString()} feat
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-400">QA Progress</span>
          <span className="text-xs font-medium text-gray-300">{approvalPct}%</span>
        </div>
        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden flex">
          {total > 0 && (
            <>
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${(approved / total) * 100}%` }}
              />
              <div
                className="h-full bg-red-500 transition-all"
                style={{ width: `${(rejected / total) * 100}%` }}
              />
              <div
                className="h-full bg-yellow-500 transition-all"
                style={{ width: `${(pending / total) * 100}%` }}
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-xs text-green-400">{approved} approved</span>
          <span className="text-xs text-yellow-400">{pending} pending</span>
          {rejected > 0 && <span className="text-xs text-red-400">{rejected} rejected</span>}
        </div>
      </div>

      {/* Discipline breakdown */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="bg-gray-800/50 rounded px-2 py-1.5">
          <div className="text-xs text-gray-500">Civil</div>
          <div className="text-sm font-medium text-gray-300">{project.civil.total}</div>
        </div>
        <div className="bg-gray-800/50 rounded px-2 py-1.5">
          <div className="text-xs text-gray-500">Optical</div>
          <div className="text-sm font-medium text-gray-300">{project.optical.total}</div>
        </div>
        <div className="bg-gray-800/50 rounded px-2 py-1.5">
          <div className="text-xs text-gray-500">Splicing</div>
          <div className="text-sm font-medium text-gray-300">{project.splicing.total}</div>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" />
          {project.zone_count} zones
        </span>
        <span className="flex items-center gap-1">
          <Layers className="w-3.5 h-3.5" />
          {project.pon_count} PONs
        </span>
        {project.photo_count > 0 && (
          <span className="flex items-center gap-1">
            <Camera className="w-3.5 h-3.5" />
            {project.photo_count.toLocaleString()}
          </span>
        )}
        {project.otdr_count > 0 && (
          <span className="flex items-center gap-1">
            <Radio className="w-3.5 h-3.5" />
            {project.otdr_count.toLocaleString()} OTDR
          </span>
        )}
      </div>
    </button>
  );
}
