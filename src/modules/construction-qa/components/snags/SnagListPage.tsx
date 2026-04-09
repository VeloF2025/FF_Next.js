/**
 * SnagListPage — All-projects snag list with filters, table, and pagination.
 * State/data logic lives in useSnagListPage.ts.
 */

'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { SnagListFilters } from './SnagListFilters';
import { SnagListTable } from './SnagListTable';
import { SnagCountTiles } from './SnagCountTiles';
import { Pagination } from '@/components/ui/StandardDataTable';
import { useSnagListPage } from './useSnagListPage';
import { log } from '@/lib/logger';
import toast from 'react-hot-toast';

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

  const [generatingReport, setGeneratingReport] = useState(false);

  const handleExportCloseout = async () => {
    if (!filters.projectId) {
      toast.error('Select a project to generate the closeout report');
      return;
    }
    setGeneratingReport(true);
    try {
      // 1. Fetch report data
      const params = new URLSearchParams({ projectId: filters.projectId });
      if (filters.status) params.set('status', filters.status);
      if (filters.zone_no) params.set('zone_no', filters.zone_no);
      if (filters.pon_no) params.set('pon_no', filters.pon_no);

      const res = await fetch(`/api/snags/closeout-report?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch report data: ${res.status}`);
      const json = await res.json();

      // 2. Generate PDF (dynamic import to avoid bundling)
      const { generateSnagCloseoutPdf } = await import('../../utils/snagCloseoutPdf');
      const blob = await generateSnagCloseoutPdf(json.data);

      // 3. Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `snag-closeout-${json.data.project_name.replace(/\s+/g, '-').toLowerCase()}-${dateStr}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success('Closeout report downloaded');
    } catch (err) {
      log.error('Failed to generate closeout report', { err });
      toast.error('Failed to generate closeout report');
    } finally {
      setGeneratingReport(false);
    }
  };

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
          {filters.projectId && (
            <button
              type="button"
              onClick={() => { void handleExportCloseout(); }}
              disabled={generatingReport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              {generatingReport ? 'Generating...' : 'Closeout Report'}
            </button>
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
