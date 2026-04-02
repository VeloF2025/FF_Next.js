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
} from '../../services/snagService';
import { log } from '@/lib/logger';
import type {
  SnagProjectStats,
  SnagPhoto,
  SnagFilters,
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
  page: 1,
  pageSize: 200,
};

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
      const groups = Array.from(groupMap.values()).sort(
        (a, b) => new Date(b.report.audit_date).getTime() - new Date(a.report.audit_date).getTime()
      );
      setSnagGroups(groups);

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
  // Filters
  // -------------------------------------------------------

  const handleFilterChange = useCallback((updated: Partial<SnagFilters>) => {
    const next = { ...filters, ...updated };
    setFilters(next);
    if (selectedProjectId !== null) {
      void loadSnags(selectedProjectId, next);
    }
  }, [filters, selectedProjectId, loadSnags]);

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
    handleImported,
  };
}
