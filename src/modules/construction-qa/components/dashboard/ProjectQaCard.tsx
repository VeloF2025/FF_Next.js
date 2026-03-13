/**
 * Project QA Card
 *
 * Displays a single project's QA summary in the dashboard grid.
 * Shows: name, feature count, QA progress bar, OTDR count, zone/PON counts.
 * Click → navigate to project detail page.
 */

'use client';

import { useRouter } from 'next/router';
import { MapPin, Layers, Radio, Camera, Milestone, CircleDot, Cable, ClipboardCheck } from 'lucide-react';
import type { ProjectDashboardRow, InfraStats } from '../../types/dashboard.types';

function InfraStat({ label, icon: Icon, stats, showAssignment }: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  stats: InfraStats;
  showAssignment?: boolean;
}) {
  const qaPct = stats.total > 0 && stats.qa_total > 0
    ? Math.round((stats.qa_approved / stats.total) * 100)
    : 0;
  const unassigned = stats.total - (stats.assigned || 0);
  return (
    <div className="bg-gray-800/50 rounded px-2 py-1.5">
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className="w-3 h-3 text-gray-500" />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="text-sm font-medium text-gray-300">{stats.total > 0 ? stats.total.toLocaleString() : '-'}</div>
      {showAssignment && stats.total > 0 && (
        <>
          <div className="text-[10px] text-green-400">
            {stats.assigned > 0 ? `${stats.assigned.toLocaleString()} assigned` : '-'}
          </div>
          <div className="text-[10px] text-amber-400">
            {unassigned > 0 ? `${unassigned.toLocaleString()} unassigned` : '-'}
          </div>
        </>
      )}
      <div className="text-[10px] text-blue-400">
        {stats.qa_total > 0
          ? `${stats.qa_approved} QA'd (${qaPct}%)`
          : <span className="text-gray-600">-</span>}
      </div>
    </div>
  );
}

interface ProjectQaCardProps {
  project: ProjectDashboardRow;
}

export function ProjectQaCard({ project }: ProjectQaCardProps) {
  const router = useRouter();

  const approved = project.civil.approved + project.optical.approved;
  const total = project.total_features;
  const approvalPct = total > 0 ? Math.round((approved / total) * 100) : 0;

  const pending = project.civil.pending + project.optical.pending;
  const rejected = project.civil.rejected + project.optical.rejected;

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
      <div className="grid grid-cols-2 gap-2 mb-3 text-center">
        <div className="bg-gray-800/50 rounded px-2 py-1.5">
          <div className="text-xs text-gray-500">Civil</div>
          <div className="text-sm font-medium text-gray-300">{project.civil.total}</div>
        </div>
        <div className="bg-gray-800/50 rounded px-2 py-1.5">
          <div className="text-xs text-gray-500">Optical</div>
          <div className="text-sm font-medium text-gray-300">{project.optical.total}</div>
        </div>
      </div>

      {/* Infrastructure stats — matches table columns: Poles(Total/Planted/QA'd), Joints(Total/QA'd), Spans(Total/QA'd) */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <InfraStat label="Poles" icon={Milestone} stats={project.infrastructure.poles} showAssignment />
        <InfraStat label="Joints" icon={CircleDot} stats={project.infrastructure.joints} />
        <InfraStat label="Spans" icon={Cable} stats={project.infrastructure.cable_spans} />
      </div>

      {/* Photo Completeness */}
      {project.photo_completeness && project.photo_completeness.total_reviews > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <ClipboardCheck className="w-3.5 h-3.5" />
              Photo Steps (7-step)
            </span>
            <span className={`text-xs font-medium ${
              project.photo_completeness.completeness_pct >= 50 ? 'text-green-400' :
              project.photo_completeness.completeness_pct >= 20 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {project.photo_completeness.completeness_pct}%
            </span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden flex">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${(project.photo_completeness.complete_7 / project.photo_completeness.total_reviews) * 100}%` }}
              title={`${project.photo_completeness.complete_7} complete (all 7 steps)`}
            />
            <div
              className="h-full bg-yellow-500 transition-all"
              style={{ width: `${(project.photo_completeness.steps_4_to_6 / project.photo_completeness.total_reviews) * 100}%` }}
              title={`${project.photo_completeness.steps_4_to_6} partial (4-6 steps)`}
            />
            <div
              className="h-full bg-orange-500 transition-all"
              style={{ width: `${(project.photo_completeness.steps_1_to_3 / project.photo_completeness.total_reviews) * 100}%` }}
              title={`${project.photo_completeness.steps_1_to_3} incomplete (1-3 steps)`}
            />
            <div
              className="h-full bg-red-500/60 transition-all"
              style={{ width: `${(project.photo_completeness.no_photos / project.photo_completeness.total_reviews) * 100}%` }}
              title={`${project.photo_completeness.no_photos} no photos`}
            />
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] text-green-400">{project.photo_completeness.complete_7} full</span>
            <span className="text-[10px] text-yellow-400">{project.photo_completeness.steps_4_to_6} partial</span>
            <span className="text-[10px] text-orange-400">{project.photo_completeness.steps_1_to_3} low</span>
            {project.photo_completeness.no_photos > 0 && (
              <span className="text-[10px] text-red-400">{project.photo_completeness.no_photos} none</span>
            )}
          </div>
          {project.photo_completeness.most_missing_step && (
            <div className="text-[10px] text-gray-500 mt-0.5">
              Most skipped: {project.photo_completeness.most_missing_step}
            </div>
          )}
        </div>
      )}

      {/* Meta row — matches table: Zones, PONs, Photos, OTDR */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" />
          {project.zone_count} zones
        </span>
        <span className="flex items-center gap-1">
          <Layers className="w-3.5 h-3.5" />
          {project.pon_count} PONs
        </span>
        <span className="flex items-center gap-1">
          <Camera className="w-3.5 h-3.5" />
          {project.photo_count > 0 ? project.photo_count.toLocaleString() : '-'}
        </span>
        <span className="flex items-center gap-1">
          <Radio className="w-3.5 h-3.5" />
          {project.otdr_count > 0 ? `${project.otdr_count.toLocaleString()} OTDR` : '-'}
        </span>
      </div>
    </button>
  );
}
