/**
 * SnagGrid — Grid of snag cards for a selected project.
 * Groups by TQR report with collapsible headers.
 * Inline accordion detail on card click.
 */

'use client';

import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronDown, ChevronRight, Loader2, Trash2, Ticket } from 'lucide-react';
import { SnagCard } from './SnagCard';
import { SnagDetail } from './SnagDetail';
import { deleteSnagReport, createNocTicketsBulk } from '../../services/snagService';
import { log } from '@/lib/logger';
import type { Snag, SnagPhoto } from '../../types/snag.types';
import type { ReportGroup } from './useSnagsPage';

interface SnagGridProps {
  projectName: string;
  groups: ReportGroup[];
  photosBySnag: Record<string, SnagPhoto[]>;
  loading: boolean;
  onBack: () => void;
  onSnagUpdated: (snag: Snag) => void;
  onPhotoAdded: (snagId: string, photo: SnagPhoto) => void;
  onReportDeleted: (reportId: string) => void;
  onPhotoDeleted: (snagId: string, photoId: string) => void;
  /** Called after bulk ticket creation so the parent can refresh snag data */
  onBulkTicketsCreated?: (reportId: string) => void;
}

/** 🟢 WORKING: Snag card grid grouped by report */
export function SnagGrid({
  projectName,
  groups,
  photosBySnag,
  loading,
  onBack,
  onSnagUpdated,
  onPhotoAdded,
  onReportDeleted,
  onPhotoDeleted,
  onBulkTicketsCreated,
}: SnagGridProps) {
  const [expandedSnagId, setExpandedSnagId] = useState<string | null>(null);
  const [collapsedReports, setCollapsedReports] = useState<Set<string>>(new Set());
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [bulkCreatingReportId, setBulkCreatingReportId] = useState<string | null>(null);

  const toggleReport = useCallback((reportId: string) => {
    setCollapsedReports((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) {
        next.delete(reportId);
      } else {
        next.add(reportId);
      }
      return next;
    });
  }, []);

  const handleCardClick = useCallback((snagId: string) => {
    setExpandedSnagId((prev) => (prev === snagId ? null : snagId));
  }, []);

  const handleSnagUpdated = useCallback((updated: Snag) => {
    onSnagUpdated(updated);
  }, [onSnagUpdated]);

  const handlePhotoAdded = useCallback((snagId: string, photo: SnagPhoto) => {
    onPhotoAdded(snagId, photo);
  }, [onPhotoAdded]);

  const handleBulkCreateTickets = useCallback(async (reportId: string, openWithoutTicket: number) => {
    if (openWithoutTicket === 0) return;
    if (!window.confirm(`Create NOC tickets for ${openWithoutTicket} open snag(s) in this report?`)) return;
    setBulkCreatingReportId(reportId);
    try {
      const result = await createNocTicketsBulk(reportId);
      log.info('Bulk tickets created', { reportId, ...result });
      onBulkTicketsCreated?.(reportId);
    } catch (err) {
      log.error('Failed to bulk-create NOC tickets', { err, reportId });
    } finally {
      setBulkCreatingReportId(null);
    }
  }, [onBulkTicketsCreated]);

  const handleDeleteReport = useCallback(async (reportId: string, reportNumber: string) => {
    if (!window.confirm(`Delete report ${reportNumber} and all its findings? This cannot be undone.`)) return;
    setDeletingReportId(reportId);
    try {
      await deleteSnagReport(reportId);
      onReportDeleted(reportId);
    } catch (err) {
      log.error('Failed to delete snag report', { err, reportId });
    } finally {
      setDeletingReportId(null);
    }
  }, [onReportDeleted]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 text-zinc-400 animate-spin" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-zinc-500">
        <p className="text-sm">No snags found</p>
        <p className="text-xs mt-1">Import a TQR report to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to {projectName}
      </button>

      {/* Report groups */}
      {groups.map((group) => {
        const isCollapsed = collapsedReports.has(group.report.id);
        const auditDate = new Date(group.report.audit_date).toLocaleDateString('en-ZA');
        const openCount = group.snags.filter(
          (s) => ['open', 'assigned', 'in_progress', 'reopened'].includes(s.status)
        ).length;
        const fixedCount = group.snags.filter(
          (s) => ['fixed', 'verified', 'closed'].includes(s.status)
        ).length;
        const openWithoutTicket = group.snags.filter(
          (s) => s.status === 'open' && !s.noc_ticket_id
        ).length;

        return (
          <div key={group.report.id} className="space-y-2">
            {/* Report header */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggleReport(group.report.id)}
                className="flex-1 flex items-center gap-2 text-left bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 rounded-md px-3 py-2 transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" />
                )}
                <span className="text-sm font-medium text-zinc-200 flex-1">
                  {group.report.report_number} — {auditDate}
                </span>
                <span className="text-xs text-zinc-400">
                  {group.snags.length} findings
                </span>
                {openCount > 0 && (
                  <span className="text-xs bg-red-900/60 text-red-300 px-1.5 py-0.5 rounded">
                    {openCount} open
                  </span>
                )}
                {fixedCount > 0 && (
                  <span className="text-xs bg-green-900/60 text-green-300 px-1.5 py-0.5 rounded">
                    {fixedCount} resolved
                  </span>
                )}
              </button>

              {/* Bulk create NOC tickets (only when there are open snags without tickets) */}
              {openWithoutTicket > 0 && (
                <button
                  type="button"
                  onClick={() => { void handleBulkCreateTickets(group.report.id, openWithoutTicket); }}
                  disabled={bulkCreatingReportId === group.report.id}
                  aria-label={`Create NOC tickets for ${openWithoutTicket} open snags`}
                  title={`Create NOC tickets for ${openWithoutTicket} open snag(s)`}
                  className="flex items-center gap-1.5 px-2 py-2 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors border border-zinc-700 rounded-md bg-zinc-800"
                >
                  {bulkCreatingReportId === group.report.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Ticket className="h-4 w-4" />
                  }
                  <span className="hidden sm:inline">
                    {bulkCreatingReportId === group.report.id ? 'Creating...' : `${openWithoutTicket} tickets`}
                  </span>
                </button>
              )}

              {/* Delete report button */}
              <button
                type="button"
                onClick={() => { void handleDeleteReport(group.report.id, group.report.report_number); }}
                disabled={deletingReportId === group.report.id}
                aria-label={`Delete report ${group.report.report_number}`}
                className="p-2 text-zinc-500 hover:text-red-400 disabled:opacity-50 transition-colors border border-zinc-700 rounded-md bg-zinc-800 hover:bg-zinc-750"
              >
                {deletingReportId === group.report.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Trash2 className="h-4 w-4" />
                }
              </button>
            </div>

            {/* Snag cards grid */}
            {!isCollapsed && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {group.snags.map((snag) => {
                  const photos = photosBySnag[snag.id] ?? [];
                  const isExpanded = expandedSnagId === snag.id;

                  return (
                    <div key={snag.id} className="flex flex-col">
                      <SnagCard
                        snag={snag}
                        photos={photos}
                        isExpanded={isExpanded}
                        onClick={() => handleCardClick(snag.id)}
                      />

                      {isExpanded && (
                        <SnagDetail
                          snag={snag}
                          photos={photos}
                          onClose={() => setExpandedSnagId(null)}
                          onUpdated={handleSnagUpdated}
                          onPhotoAdded={(photo) => handlePhotoAdded(snag.id, photo)}
                          onPhotoDeleted={(photoId) => onPhotoDeleted(snag.id, photoId)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
