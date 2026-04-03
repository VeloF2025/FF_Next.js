/**
 * useSnagsPage — Data-fetching hook for SnagsPage.
 * Manages stats, snag groups, photo loading, and filter state.
 * Extracted to keep SnagsPage.tsx under 200 lines.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  fetchSnagStats,
  fetchSnags,
  fetchSnagPhotos,
  fetchProjects,
  deleteSnagReport,
} from '../../services/snagService';
import { log } from '@/lib/logger';
import type {
  SnagProjectStats,
  SnagPhoto,
  SnagFilters,
  SnagSortBy,
  SnagReport,
  Snag,
} from '../../types/snag.types';

export interface ReportGroup {
  report: Pick<SnagReport, 'id' | 'report_number' | 'audit_date'>;
  snags: Snag[];
}

export const DEFAULT_FILTERS: SnagFilters = {
  projectId: '',
  reportId: '',
  status: '',
  category: '',
  severity: '',
  search: '',
  sortBy: 'newest',
  page: 1,
  pageSize: 200,
};

/** Status sort priority: open/reopened first, then in-progress, then fixed, then resolved */
const STATUS_ORDER: Record<string, number> = {
  open: 0,
  reopened: 1,
  assigned: 2,
  in_progress: 3,
  fixed: 4,
  verified: 5,
  closed: 6,
  wont_fix: 7,
  duplicate: 8,
};

/** Severity sort priority: critical first */
const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

/** Sort snags within a group based on sortBy option */
function sortSnags(
  snags: Snag[],
  sortBy: SnagSortBy,
  photosBySnag: Record<string, SnagPhoto[]>
): Snag[] {
  const copy = [...snags];
  switch (sortBy) {
    case 'oldest':
      return copy.sort((a, b) => a.snag_number - b.snag_number);
    case 'newest':
      return copy.sort((a, b) => b.snag_number - a.snag_number);
    case 'status':
      return copy.sort((a, b) => {
        const diff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        return diff !== 0 ? diff : a.snag_number - b.snag_number;
      });
    case 'severity':
      return copy.sort((a, b) => {
        const diff = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
        return diff !== 0 ? diff : a.snag_number - b.snag_number;
      });
    case 'needs_attention':
      return copy.sort((a, b) => {
        const aCount = photosBySnag[a.id]?.length ?? 0;
        const bCount = photosBySnag[b.id]?.length ?? 0;
        return aCount !== bCount ? aCount - bCount : a.snag_number - b.snag_number;
      });
    default:
      return copy;
  }
}

export function useSnagsPage() {
  const [stats, setStats] = useState<SnagProjectStats[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProjectName, setSelectedProjectName] = useState('');

  const [snagGroups, setSnagGroups] = useState<ReportGroup[]>([]);
  const [snagLoading, setSnagLoading] = useState(false);

  const [photosBySnag, setPhotosBySnag] = useState<Record<string, SnagPhoto[]>>({});
  const [filters, setFilters] = useState<SnagFilters>(DEFAULT_FILTERS);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);

  // -------------------------------------------------------
  // Stats + Projects
  // -------------------------------------------------------

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await fetchSnagStats();
      setStats(data);
    } catch (err) {
      log.error('Failed to load snag stats', { err });
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    void fetchProjects().then(setProjects).catch(() => setProjects([]));
  }, [loadStats]);

  // -------------------------------------------------------
  // Snag loading + photo loading
  // -------------------------------------------------------

  const loadSnags = useCallback(async (projectId: string, activeFilters: SnagFilters) => {
    setSnagLoading(true);
    try {
      const { snags: data } = await fetchSnags({
        ...activeFilters,
        projectId: String(projectId),
      });

      // Load all photos first so sorting by needs_attention is accurate
      const photoMap: Record<string, SnagPhoto[]> = {};
      await Promise.all(
        data.map(async (snag) => {
          try {
            photoMap[snag.id] = await fetchSnagPhotos(snag.id);
          } catch (err) {
            log.error('Failed to load photos for snag', { snagId: snag.id, err });
            photoMap[snag.id] = [];
          }
        })
      );
      setPhotosBySnag(photoMap);

      // Group by report
      const groupMap = new Map<string, ReportGroup>();
      for (const snag of data) {
        const key = snag.report_id;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            report: {
              id: snag.report_id,
              report_number: snag.report?.report_number ?? snag.report_id,
              audit_date: snag.report?.audit_date ?? new Date().toISOString(),
            },
            snags: [],
          });
        }
        groupMap.get(key)!.snags.push(snag);
      }

      // Sort reports newest first, then sort snags within each group
      const groups = Array.from(groupMap.values())
        .sort((a, b) => new Date(b.report.audit_date).getTime() - new Date(a.report.audit_date).getTime())
        .map((g) => ({ ...g, snags: sortSnags(g.snags, activeFilters.sortBy, photoMap) }));

      setSnagGroups(groups);
    } catch (err) {
      log.error('Failed to load snags', { projectId, err });
    } finally {
      setSnagLoading(false);
    }
  }, []);

  // -------------------------------------------------------
  // Project selection
  // -------------------------------------------------------

  const selectProject = useCallback((s: SnagProjectStats) => {
    setSelectedProjectId(s.project_id);
    setSelectedProjectName(s.project_name);
    setFilters(DEFAULT_FILTERS);
    void loadSnags(s.project_id, DEFAULT_FILTERS);
  }, [loadSnags]);

  const handleBack = useCallback(() => {
    setSelectedProjectId(null);
    setSelectedProjectName('');
    setSnagGroups([]);
    setPhotosBySnag({});
  }, []);

  // -------------------------------------------------------
  // Filters (sort change is client-side only — no reload needed for sort)
  // -------------------------------------------------------

  const handleFilterChange = useCallback((updated: Partial<SnagFilters>) => {
    const next = { ...filters, ...updated };
    setFilters(next);

    // If only sortBy changed, re-sort in-place without a server round-trip
    const filterKeys = Object.keys(updated) as Array<keyof SnagFilters>;
    const onlySortChanged = filterKeys.length === 1 && filterKeys[0] === 'sortBy';
    if (onlySortChanged) {
      setSnagGroups((prev) =>
        prev.map((g) => ({ ...g, snags: sortSnags(g.snags, next.sortBy, photosBySnag) }))
      );
      return;
    }

    if (selectedProjectId !== null) {
      void loadSnags(selectedProjectId, next);
    }
  }, [filters, selectedProjectId, loadSnags, photosBySnag]);

  // -------------------------------------------------------
  // Mutations
  // -------------------------------------------------------

  const handleSnagUpdated = useCallback((updated: Snag) => {
    setSnagGroups((prev) =>
      prev.map((g) => ({
        ...g,
        snags: g.snags.map((s) => s.id === updated.id ? updated : s),
      }))
    );
    void loadStats();
  }, [loadStats]);

  const handlePhotoAdded = useCallback((snagId: string, photo: SnagPhoto) => {
    setPhotosBySnag((prev) => ({
      ...prev,
      [snagId]: [...(prev[snagId] ?? []), photo],
    }));
  }, []);

  const handlePhotoDeleted = useCallback((snagId: string, photoId: string) => {
    setPhotosBySnag((prev) => ({
      ...prev,
      [snagId]: (prev[snagId] ?? []).filter((p) => p.id !== photoId),
    }));
  }, []);

  const handleReportDeleted = useCallback(async (reportId: string): Promise<boolean> => {
    const confirmed = window.confirm(
      'Delete this TQR report? All snags and photos in this report will be permanently deleted.'
    );
    if (!confirmed) return false;

    try {
      await deleteSnagReport(reportId);
      setSnagGroups((prev) => prev.filter((g) => g.report.id !== reportId));
      void loadStats();
      return true;
    } catch (err) {
      log.error('Failed to delete snag report', { reportId, err });
      return false;
    }
  }, [loadStats]);

  const handleImported = useCallback((reportId: string) => {
    void loadStats();
    if (selectedProjectId !== null) {
      void loadSnags(selectedProjectId, filters);
    }
    log.info('Import complete', { reportId });
  }, [loadStats, selectedProjectId, loadSnags, filters]);

  return {
    stats,
    statsLoading,
    projects,
    selectedProjectId,
    selectedProjectName,
    snagGroups,
    snagLoading,
    photosBySnag,
    filters,
    selectProject,
    handleBack,
    handleFilterChange,
    handleSnagUpdated,
    handlePhotoAdded,
    handlePhotoDeleted,
    handleReportDeleted,
    handleImported,
  };
}
