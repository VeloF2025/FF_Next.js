/**
 * SnagsPage — Main Snags module page.
 * Level 1: Project dashboard grid (default)
 * Level 2: Snag card grid for selected project
 *
 * Data/state logic lives in useSnagsPage.ts.
 */

'use client';

import { useState } from 'react';
import { Upload, Loader2, FileText, Network } from 'lucide-react';
import { SnagProjectCard } from './SnagProjectCard';
import { SnagGrid } from './SnagGrid';
import { SnagGridByPon } from './SnagGridByPon';
import { SnagImportDialog } from './SnagImportDialog';
import { SnagFiltersBar } from './SnagFilters';
import { useSnagsPage } from './useSnagsPage';

// ============================================================
// Main component
// ============================================================

/** 🟢 WORKING: Main snags page with project dashboard and snag grid */
export function SnagsPage() {
  const [showImport, setShowImport] = useState(false);

  const {
    stats,
    statsLoading,
    projects,
    selectedProjectId,
    selectedProjectName,
    snagGroups,
    zonePonGroups,
    snagLoading,
    photosBySnag,
    filters,
    viewMode,
    setViewMode,
    selectProject,
    handleBack,
    handleFilterChange,
    handleSnagUpdated,
    handlePhotoAdded,
    handleReportDeleted,
    handlePhotoDeleted,
    handleImported,
  } = useSnagsPage();

  const onImported = (reportId: string) => {
    setShowImport(false);
    handleImported(reportId);
  };

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {selectedProjectId !== null && (
            <h2 className="text-sm font-medium text-zinc-300">{selectedProjectName}</h2>
          )}
          {selectedProjectId !== null && (
            <SnagFiltersBar
              filters={filters}
              projects={projects}
              onChange={handleFilterChange}
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle — only shown when a project is selected */}
          {selectedProjectId !== null && (
            <div className="flex items-center border border-zinc-700 rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode('report')}
                className={`px-3 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                  viewMode === 'report'
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                By Report
              </button>
              <button
                type="button"
                onClick={() => setViewMode('pon')}
                className={`px-3 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                  viewMode === 'pon'
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Network className="h-3.5 w-3.5" />
                By PON
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-2 rounded-md font-medium transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            Import TQR Report
          </button>
        </div>
      </div>

      {/* Dashboard view */}
      {selectedProjectId === null && (
        <>
          {statsLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 text-zinc-400 animate-spin" />
            </div>
          ) : stats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-zinc-500">
              <p className="text-sm">No snags imported yet</p>
              <p className="text-xs mt-1">Click &quot;Import TQR Report&quot; to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {stats.map((s) => (
                <SnagProjectCard
                  key={s.project_id}
                  stats={s}
                  onClick={() => selectProject(s)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Project detail — by report (default) */}
      {selectedProjectId !== null && viewMode === 'report' && (
        <SnagGrid
          projectName={selectedProjectName}
          groups={snagGroups}
          photosBySnag={photosBySnag}
          loading={snagLoading}
          onBack={handleBack}
          onSnagUpdated={handleSnagUpdated}
          onPhotoAdded={handlePhotoAdded}
          onReportDeleted={handleReportDeleted}
          onPhotoDeleted={handlePhotoDeleted}
        />
      )}

      {/* Project detail — by zone/PON hierarchy */}
      {selectedProjectId !== null && viewMode === 'pon' && (
        <SnagGridByPon
          projectName={selectedProjectName}
          groups={zonePonGroups}
          photosBySnag={photosBySnag}
          loading={snagLoading}
          onBack={handleBack}
          onSnagUpdated={handleSnagUpdated}
          onPhotoAdded={handlePhotoAdded}
          onReportDeleted={handleReportDeleted}
          onPhotoDeleted={handlePhotoDeleted}
        />
      )}

      {/* Import dialog */}
      {showImport && (
        <SnagImportDialog
          onClose={() => setShowImport(false)}
          onImported={onImported}
        />
      )}
    </div>
  );
}
