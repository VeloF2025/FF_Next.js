/**
 * WorksQADashboardView — Level-1 project dashboard grid/table.
 *
 * Renders the aggregate stats header row (project count, pole totals, approved
 * percentage, overrides, unassigned photos) plus the card-grid / table toggle
 * and the project list itself.
 *
 * Extracted from WorksQAPage.tsx to keep it under the 200-line component limit.
 *
 * // 🟢 WORKING: T9 — Level-1 view extraction.
 */
import { LayoutGrid, Table2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { WorksQAProjectCardRich } from './dashboard/WorksQAProjectCardRich';
import { WorksQAProjectTable } from './dashboard/WorksQAProjectTable';
import type { WorksQADashboardRow } from '../types/dashboard.types';

interface Props {
  projects: WorksQADashboardRow[];
  loading: boolean;
  viewMode: 'cards' | 'table';
  onViewModeChange: (mode: 'cards' | 'table') => void;
  onSelectProject: (id: string) => void;
}

export function WorksQADashboardView({ projects, loading, viewMode, onViewModeChange, onSelectProject }: Props) {
  const totalPoles      = projects.reduce((sum, p) => sum + p.total_poles, 0);
  const totalApproved   = projects.reduce((sum, p) => sum + p.fully_approved, 0);
  const totalOverrides  = projects.reduce((sum, p) => sum + p.override_count, 0);
  const totalUnassigned = projects.reduce((sum, p) => sum + p.unassigned_total, 0);
  const approvedPct = totalPoles > 0 ? Math.round((totalApproved / totalPoles) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header row: aggregation summary + view toggle.
          Use aria-pressed on plain buttons (this is a view-mode toggle, not
          a WAI-ARIA tab pattern — no tabpanel to associate with). */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 text-xs text-zinc-500 flex-wrap" aria-busy={loading}>
          {loading ? (
            <span className="text-zinc-600">Loading dashboard…</span>
          ) : (
            <>
              <span><span className="font-medium text-zinc-200">{projects.length}</span> projects</span>
              <span>·</span>
              <span><span className="font-medium text-zinc-200">{totalPoles.toLocaleString()}</span> total poles</span>
              <span>·</span>
              <span><span className="font-medium text-green-400">{totalApproved.toLocaleString()}</span> approved ({approvedPct}%)</span>
              {totalOverrides > 0 && (
                <>
                  <span>·</span>
                  <span><span className="font-medium text-amber-400">{totalOverrides}</span> overrides</span>
                </>
              )}
              {totalUnassigned > 0 && (
                <>
                  <span>·</span>
                  <span><span className="font-medium text-amber-400">{totalUnassigned.toLocaleString()}</span> unassigned photos</span>
                </>
              )}
            </>
          )}
        </div>
        <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden" role="group" aria-label="Dashboard view mode">
          <button
            type="button"
            aria-pressed={viewMode === 'cards'}
            aria-label="Card view"
            onClick={() => onViewModeChange('cards')}
            className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === 'cards' ? 'bg-teal-700 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'table'}
            aria-label="Table view"
            onClick={() => onViewModeChange('table')}
            className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === 'table' ? 'bg-teal-700 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
          >
            <Table2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <LoadingSpinner size="md" label="" />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-zinc-500">
          <p className="text-sm">No projects with pole photos yet.</p>
          <p className="text-xs mt-1">Sync from QField to start populating Johan&apos;s sweep.</p>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {projects.map(p => (
            <WorksQAProjectCardRich
              key={p.project_id}
              project={p}
              onClick={() => onSelectProject(p.project_id)}
            />
          ))}
        </div>
      ) : (
        <WorksQAProjectTable projects={projects} onSelect={onSelectProject} />
      )}
    </div>
  );
}
