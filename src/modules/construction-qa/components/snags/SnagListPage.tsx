/**
 * SnagListPage — All-projects snag list with filters, table, and pagination.
 * State/data logic lives in useSnagListPage.ts.
 */

'use client';

import { SnagListFilters } from './SnagListFilters';
import { SnagListTable } from './SnagListTable';
import { SnagCountTiles } from './SnagCountTiles';
import { Pagination } from '@/components/ui/StandardDataTable';
import { useSnagListPage } from './useSnagListPage';

/** All-projects snag list page orchestrator */
export function SnagListPage() {
  const {
    projects,
    filters,
    zones,
    pons,
    snags,
    total,
    totalPages,
    isLoading,
    summary,
    isSummaryLoading,
    expandedSnagId,
    photosBySnag,
    handleFilterChange,
    handlePageChange,
    handleRowClick,
    handleSnagUpdated,
    handlePhotoAdded,
    handlePhotoDeleted,
  } = useSnagListPage();

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-zinc-100">All Snags</h2>
          {!isLoading && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-300">
              {total}
            </span>
          )}
        </div>
        <SnagListFilters
          filters={filters}
          projects={projects}
          zones={zones}
          pons={pons}
          onChange={handleFilterChange}
        />
      </div>

      {/* Count tiles */}
      <SnagCountTiles summary={summary} isLoading={isSummaryLoading} />

      {/* Table */}
      <SnagListTable
        snags={snags}
        projects={projects}
        isLoading={isLoading}
        expandedSnagId={expandedSnagId}
        photosBySnag={photosBySnag}
        onRowClick={handleRowClick}
        onSnagUpdated={handleSnagUpdated}
        onPhotoAdded={handlePhotoAdded}
        onPhotoDeleted={handlePhotoDeleted}
      />

      {/* Pagination */}
      {!isLoading && total > 0 && (
        <Pagination
          currentPage={filters.page}
          totalPages={totalPages}
          totalItems={total}
          itemsPerPage={filters.pageSize}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
}
