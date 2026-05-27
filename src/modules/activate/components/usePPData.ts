/**
 * usePPData — encapsulates all state, fetching, and handlers for PPDataTab.
 * Polling logic lives in usePPLookupPoller to keep this file within 300 lines.
 */

import { useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';
import { usePPLookupPoller } from './usePPLookupPoller';
import type { PPTicketBatch } from './CreatePPTicketsModal';
import { type PPRecord, type PPCardCategory, type PPStats, type LookupStatus, isSelectable } from './ppDataShared';

export interface PPDataActions {
  setPage: (p: number) => void;
  setFilterProject: (v: string) => void;
  setFilterStatus: (v: string) => void;
  setFilterDateFrom: (v: string) => void;
  setFilterDateTo: (v: string) => void;
  setFilterPriority: (v: string) => void;
  setFilterAging: (v: string) => void;
  setFilterPon: (v: string) => void;
  setSearchText: (v: string) => void;
  setSelectedIds: (ids: number[]) => void;
  setShowTicketModal: (v: boolean) => void;
  setLookupStatus: (v: LookupStatus | null) => void;
  fetchStats: () => Promise<void>;
  fetchRecords: () => Promise<void>;
  handleResolveAll: () => Promise<void>;
  handleCreateTickets: (params: {
    ticket_type: string;
    ticket_category: string;
    priority: string;
    notes: string;
    batches: PPTicketBatch[];
  }) => Promise<void>;
  handleSelectAllUnticketed: () => Promise<void>;
  handleExport: () => void;
  handleImportOlt: (file: File) => Promise<void>;
  handleCardClick: (cat: PPCardCategory) => void;
  handleFilterChange: (setter: (v: string) => void) => (val: string) => void;
  toggleSelect: (id: number) => void;
  toggleSelectAll: () => void;
  allSelectableChecked: boolean;
  selectableOnPage: PPRecord[];
}

export interface PPDataState {
  isResolving: boolean;
  error: string | null;
  stats: PPStats | null;
  records: PPRecord[];
  page: number;
  totalPages: number;
  total: number;
  filterProject: string;
  filterStatus: string;
  filterDateFrom: string;
  filterDateTo: string;
  filterPriority: string;
  filterAging: string;
  filterPon: string;
  isImportingOlt: boolean;
  searchText: string;
  lookupStatus: LookupStatus | null;
  selectedIds: number[];
  showTicketModal: boolean;
  creatingTickets: boolean;
  activeCard: PPCardCategory | null;
  selectingAllUnticketed: boolean;
  projects: string[];
}

export function usePPData(): { state: PPDataState; actions: PPDataActions } {
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PPStats | null>(null);
  const [records, setRecords] = useState<PPRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAging, setFilterAging] = useState('');
  const [filterPon, setFilterPon] = useState('');
  const [isImportingOlt, setIsImportingOlt] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [lookupStatus, setLookupStatus] = useState<LookupStatus | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [creatingTickets, setCreatingTickets] = useState(false);
  const [activeCard, setActiveCard] = useState<PPCardCategory | null>(null);
  const [selectingAllUnticketed, setSelectingAllUnticketed] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(searchText); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    fetch('/api/activate/projects')
      .then(r => r.json())
      .then(d => { if (d.success) setProjects(d.data.projects); })
      .catch(err => log.error('Failed to fetch projects', { err }, 'usePPData'));
  }, []);

  useEffect(() => {
    setSelectedIds([]);
  }, [page, filterProject, filterStatus, filterPriority, filterAging, filterDateFrom, filterDateTo, debouncedSearch, filterPon]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/activate/import-pp-data?action=stats');
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch (err) { log.error('Failed to fetch stats', { err }, 'usePPData'); }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      const params = new URLSearchParams({ action: 'list', page: String(page), limit: '50' });
      if (filterProject) params.set('project', filterProject);
      if (filterStatus) params.set('status', filterStatus);
      if (filterPriority) params.set('priority', filterPriority);
      if (filterAging) params.set('aging', filterAging);
      if (filterDateFrom) params.set('dateFrom', filterDateFrom);
      if (filterDateTo) params.set('dateTo', filterDateTo);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (filterPon) params.set('pon', filterPon);
      const res = await fetch(`/api/activate/import-pp-data?${params}`);
      const data = await res.json();
      if (data.success) {
        setRecords(data.data);
        setTotalPages(data.pagination.totalPages);
        setTotal(data.pagination.total ?? data.data.length);
      }
    } catch (err) { log.error('Failed to fetch records', { err }, 'usePPData'); }
  }, [page, filterProject, filterStatus, filterPriority, filterAging, filterDateFrom, filterDateTo, debouncedSearch, filterPon]);

  const onLookupComplete = useCallback(() => { void fetchStats(); void fetchRecords(); }, [fetchStats, fetchRecords]);
  const { fetchLookupStatus, stopPolling } = usePPLookupPoller({ setLookupStatus, onComplete: onLookupComplete });

  useEffect(() => { void fetchStats(); }, [fetchStats]);
  useEffect(() => { if (stats && stats.total > 0) void fetchRecords(); }, [stats, fetchRecords]);
  useEffect(() => { void fetchLookupStatus(); return stopPolling; }, [fetchLookupStatus, stopPolling]);

  const handleResolveAll = async () => {
    setIsResolving(true); setError(null);
    try {
      const res = await fetch('/api/activate/pp-data-resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve-all' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Resolve all failed');
      const d = result.data;
      const parts: string[] = [];
      if (d.steps.local_scan.resolved > 0) parts.push(`Local: ${d.steps.local_scan.resolved}`);
      if (d.steps.wa_cross_ref.resolved > 0) parts.push(`WA cross-ref: ${d.steps.wa_cross_ref.resolved}`);
      if (d.steps.wa_photo_vlm.resolved > 0) parts.push(`VLM photos: ${d.steps.wa_photo_vlm.resolved}`);
      const msg = d.total_resolved > 0
        ? `Resolved ${d.total_resolved} PPs (${parts.join(', ')})`
        : 'No new matches found across all sources';
      toast.success(d.onemap_started ? `${msg} — 1Map search running...` : msg);
      void fetchStats(); void fetchRecords();
      if (d.onemap_started) setTimeout(() => void fetchLookupStatus(), 2000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Resolve all failed'); }
    finally { setIsResolving(false); }
  };

  const handleCreateTickets = async (params: {
    ticket_type: string; ticket_category: string; priority: string; notes: string; batches: PPTicketBatch[];
  }) => {
    setCreatingTickets(true);
    try {
      const res = await fetch('/api/activate/pp-data-tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batches: params.batches.map(b => ({ pp_data_ids: b.pp_data_ids, assigned_team_id: b.assigned_team_id })),
          ticket_type: params.ticket_type, ticket_category: params.ticket_category,
          priority: params.priority, notes: params.notes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Created ${data.data.created} ticket${data.data.created !== 1 ? 's' : ''}`);
        setShowTicketModal(false); setSelectedIds([]);
        await fetchRecords(); await fetchStats();
      } else { toast.error(data.error?.message || 'Failed to create tickets'); }
    } catch { toast.error('Failed to create tickets'); }
    finally { setCreatingTickets(false); }
  };

  const handleSelectAllUnticketed = async () => {
    setSelectingAllUnticketed(true);
    try {
      const params = new URLSearchParams({ action: 'list', status: 'unticketed', limit: '10000' });
      const res = await fetch(`/api/activate/import-pp-data?${params}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        const ids = data.data.map((r: PPRecord) => r.id);
        setSelectedIds(ids); setFilterStatus('unticketed'); setPage(1);
        toast.success(`Selected ${ids.length} unticketed records`);
      }
    } catch { toast.error('Failed to fetch unticketed records'); }
    finally { setSelectingAllUnticketed(false); }
  };

  const handleExport = () => {
    const params = new URLSearchParams({ action: 'export' });
    if (filterProject) params.set('project', filterProject);
    if (filterStatus) params.set('status', filterStatus);
    if (filterPriority) params.set('priority', filterPriority);
    if (filterDateFrom) params.set('dateFrom', filterDateFrom);
    if (filterDateTo) params.set('dateTo', filterDateTo);
    window.open(`/api/activate/import-pp-data?${params}`, '_blank');
  };

  const handleImportOlt = async (file: File) => {
    setIsImportingOlt(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/activate/import-pp-olt-data', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Import failed');
      toast.success(`OLT data imported: ${data.data.updated} records updated, ${data.data.notMatched} not matched`);
      void fetchRecords();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'OLT import failed'); }
    finally { setIsImportingOlt(false); }
  };

  const handleCardClick = (cat: PPCardCategory) => {
    const statusMap: Record<PPCardCategory, string> = {
      total: '', activated: 'activated', located: 'located', not_found: 'not_found', ticketed: 'ticketed',
    };
    if (activeCard === cat) { setActiveCard(null); setFilterStatus(''); }
    else { setActiveCard(cat); setFilterStatus(statusMap[cat]); }
    setPage(1);
  };

  const handleFilterChange = (setter: (v: string) => void) => (val: string) => {
    setter(val); setPage(1);
    if (setter === setFilterStatus) {
      const reverseMap: Record<string, PPCardCategory> = {
        activated: 'activated', located: 'located', not_found: 'not_found', ticketed: 'ticketed',
      };
      setActiveCard(val === '' ? null : reverseMap[val] || null);
    }
  };

  const selectableOnPage = records.filter(isSelectable);
  const allSelectableChecked = selectableOnPage.length > 0 && selectableOnPage.every(r => selectedIds.includes(r.id));

  const toggleSelectAll = () => {
    if (allSelectableChecked) {
      setSelectedIds(prev => prev.filter(id => !selectableOnPage.some(r => r.id === id)));
    } else {
      setSelectedIds(prev => { const s = new Set(prev); selectableOnPage.forEach(r => s.add(r.id)); return Array.from(s); });
    }
  };

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }, []);

  return {
    state: {
      isResolving, error, stats, records, page, totalPages, total,
      filterProject, filterStatus, filterDateFrom, filterDateTo,
      filterPriority, filterAging, filterPon, isImportingOlt,
      searchText, lookupStatus, selectedIds, showTicketModal,
      creatingTickets, activeCard, selectingAllUnticketed, projects,
    },
    actions: {
      setPage, setFilterProject, setFilterStatus, setFilterDateFrom,
      setFilterDateTo, setFilterPriority, setFilterAging, setFilterPon,
      setSearchText, setSelectedIds, setShowTicketModal, setLookupStatus,
      fetchStats, fetchRecords,
      handleResolveAll, handleCreateTickets, handleSelectAllUnticketed,
      handleExport, handleImportOlt, handleCardClick, handleFilterChange,
      toggleSelect, toggleSelectAll, allSelectableChecked, selectableOnPage,
    },
  };
}
