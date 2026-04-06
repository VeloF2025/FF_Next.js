/**
 * useSnagListPage — Data-fetching hook for SnagListPage.
 * Manages all-projects snag list, filters, pagination, and inline row expansion.
 *
 * Supports seeding initial filters from URL query params:
 *   ?projectId=<uuid>&zone_no=<int>&pon_no=<int>
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  fetchSnags,
  fetchSnagPhotos,
  fetchProjects,
  fetchSnagSummary,
  fetchZonePonOptions,
} from '../../services/snagService';
import type { SnagSummary } from '../../services/snagService';
import { log } from '@/lib/logger';
import type { Snag, SnagPhoto } from '../../types/snag.types';

export interface SnagListFilters {
  projectId: string;
  status: string;
  category: string;
  severity: string;
  search?: string;
  /** Zone number deep-link filter (from ?zone_no= URL param) */
  zone_no?: string;
  /** PON number deep-link filter (from ?pon_no= URL param) */
  pon_no?: string;
  page: number;
  pageSize: number;
}

export interface ProjectOption {
  id: string;
  name: string;
}

const DEFAULT_FILTERS: SnagListFilters = {
  projectId: '',
  status: '',
  category: '',
  severity: '',
  zone_no: '',
  pon_no: '',
  page: 1,
  pageSize: 25,
};

export function useSnagListPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [filters, setFilters] = useState<SnagListFilters>(DEFAULT_FILTERS);

  const [snags, setSnags] = useState<Snag[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<SnagSummary | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);

  const [expandedSnagId, setExpandedSnagId] = useState<string | null>(null);
  const [photosBySnag, setPhotosBySnag] = useState<Record<string, SnagPhoto[]>>({});
  const [loadingPhotos, setLoadingPhotos] = useState<Set<string>>(new Set());

  const [zones, setZones] = useState<number[]>([]);
  const [pons, setPons] = useState<Array<{ zone_no: number | null; pon_no: number | null }>>([]);

  // -------------------------------------------------------
  // Projects on mount
  // -------------------------------------------------------

  useEffect(() => {
    fetchProjects()
      .then(setProjects)
      .catch((err) => {
        log.error('Failed to load projects for snag list', { err });
        setProjects([]);
      });
  }, []);

  // -------------------------------------------------------
  // Seed filters from URL query params (deep-link support)
  // Runs when router.query changes (covers initial load + back/forward nav)
  // -------------------------------------------------------

  useEffect(() => {
    if (!router.isReady) return;
    const { projectId, zone_no, pon_no } = router.query;

    const hasDeepLink =
      (projectId && typeof projectId === 'string') ||
      (zone_no && typeof zone_no === 'string') ||
      (pon_no && typeof pon_no === 'string');

    if (!hasDeepLink) return;

    setFilters((prev) => ({
      ...prev,
      projectId: typeof projectId === 'string' ? projectId : prev.projectId,
      zone_no:   typeof zone_no   === 'string' ? zone_no   : prev.zone_no,
      pon_no:    typeof pon_no    === 'string' ? pon_no    : prev.pon_no,
      page: 1,
    }));
  }, [router.isReady, router.query]);

  // -------------------------------------------------------
  // Zone/PON options — re-fetch when projectId changes
  // -------------------------------------------------------

  useEffect(() => {
    if (filters.projectId) {
      fetchZonePonOptions(filters.projectId)
        .then(({ zones: z, pons: p }) => { setZones(z); setPons(p); })
        .catch(() => { setZones([]); setPons([]); });
    } else {
      setZones([]);
      setPons([]);
    }
  }, [filters.projectId]);

  // -------------------------------------------------------
  // Snag loading — re-runs when filters change
  // -------------------------------------------------------

  const loadSummary = useCallback(async (activeFilters: SnagListFilters) => {
    setIsSummaryLoading(true);
    try {
      const data = await fetchSnagSummary({
        projectId: activeFilters.projectId || undefined,
        category:  activeFilters.category  || undefined,
        severity:  activeFilters.severity  || undefined,
        search:    activeFilters.search    || undefined,
        zone_no:   activeFilters.zone_no   || undefined,
        pon_no:    activeFilters.pon_no    || undefined,
      });
      setSummary(data);
    } catch (err) {
      log.error('Failed to load snag summary', { err });
    } finally {
      setIsSummaryLoading(false);
    }
  }, []);

  const loadSnags = useCallback(async (activeFilters: SnagListFilters) => {
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        page: String(activeFilters.page),
        pageSize: String(activeFilters.pageSize),
      };
      if (activeFilters.projectId) params['projectId'] = activeFilters.projectId;
      if (activeFilters.status) params['status'] = activeFilters.status;
      if (activeFilters.category) params['category'] = activeFilters.category;
      if (activeFilters.severity) params['severity'] = activeFilters.severity;
      if (activeFilters.search) params['search'] = activeFilters.search;
      if (activeFilters.zone_no) params['zone_no'] = activeFilters.zone_no;
      if (activeFilters.pon_no) params['pon_no'] = activeFilters.pon_no;

      const { snags: data, total: count } = await fetchSnags(params);
      setSnags(data);
      setTotal(count);
    } catch (err) {
      log.error('Failed to load snag list', { err });
      setError(err instanceof Error ? err.message : 'Failed to load snags');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSnags(filters);
    void loadSummary(filters);
  }, [filters, loadSnags, loadSummary]);

  // -------------------------------------------------------
  // Filter changes
  // -------------------------------------------------------

  const handleFilterChange = useCallback((key: string, value: string) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value, page: 1 };
      // Cascade: project change resets zone + PON
      if (key === 'projectId') {
        next.zone_no = '';
        next.pon_no = '';
      }
      // Cascade: zone change resets PON
      if (key === 'zone_no') {
        next.pon_no = '';
      }
      return next;
    });
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  }, []);

  // -------------------------------------------------------
  // Row expansion + lazy photo loading
  // -------------------------------------------------------

  const handleRowClick = useCallback((snag: Snag) => {
    setExpandedSnagId((prev) => (prev === snag.id ? null : snag.id));

    // Lazy-load photos if not already loaded
    if (!photosBySnag[snag.id] && !loadingPhotos.has(snag.id)) {
      setLoadingPhotos((prev) => new Set(prev).add(snag.id));
      fetchSnagPhotos(snag.id)
        .then((photos) => {
          setPhotosBySnag((prev) => ({ ...prev, [snag.id]: photos }));
        })
        .catch((err) => {
          log.error('Failed to load photos for snag', { snagId: snag.id, err });
          setPhotosBySnag((prev) => ({ ...prev, [snag.id]: [] }));
        })
        .finally(() => {
          setLoadingPhotos((prev) => {
            const next = new Set(prev);
            next.delete(snag.id);
            return next;
          });
        });
    }
  }, [photosBySnag, loadingPhotos]);

  // -------------------------------------------------------
  // Mutations
  // -------------------------------------------------------

  const handleSnagUpdated = useCallback((updated: Snag) => {
    setSnags((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

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

  // -------------------------------------------------------
  // Derived pagination
  // -------------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

  return {
    projects,
    filters,
    zones,
    pons,
    snags,
    total,
    totalPages,
    isLoading,
    error,
    summary,
    isSummaryLoading,
    expandedSnagId,
    photosBySnag,
    loadingPhotos,
    handleFilterChange,
    handlePageChange,
    handleRowClick,
    handleSnagUpdated,
    handlePhotoAdded,
    handlePhotoDeleted,
  };
}
