'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, RefreshCw, Loader2, AlertCircle, XCircle, Wrench } from 'lucide-react';
import { log } from '@/lib/logger';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { SummaryCards, LookupProgressBanner, LookupCompleteBanner } from './PPSummaryCards';
import { CreatePPTicketsModal } from './CreatePPTicketsModal';
import { PPDataFilters } from './PPDataFilters';
import { PPDataRow, PPDataTableHead } from './PPDataRow';
import { type PPRecord, type PPCardCategory, type PPStats, type LookupStatus, isSelectable } from './ppDataShared';

export function PPDataTab() {
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PPStats | null>(null);
  const [records, setRecords] = useState<PPRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAging, setFilterAging] = useState('');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [lookupStatus, setLookupStatus] = useState<LookupStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [creatingTickets, setCreatingTickets] = useState(false);
  const [activeCard, setActiveCard] = useState<PPCardCategory | null>(null);
  const [selectingAllUnticketed, setSelectingAllUnticketed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(searchText); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => { setSelectedIds([]); }, [page, filterProject, filterStatus, filterPriority, filterAging, filterDateFrom, filterDateTo, debouncedSearch]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/activate/import-pp-data?action=stats');
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch (err) {
      log.error('Failed to fetch stats', { err }, 'PPDataTab');
    }
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
      const res = await fetch(`/api/activate/import-pp-data?${params}`);
      const data = await res.json();
      if (data.success) { setRecords(data.data); setTotalPages(data.pagination.totalPages); }
    } catch (err) {
      log.error('Failed to fetch records', { err }, 'PPDataTab');
    }
  }, [page, filterProject, filterStatus, filterPriority, filterAging, filterDateFrom, filterDateTo, debouncedSearch]);

  const fetchLookupStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/activate/import-pp-data?action=lookup-status');
      const data = await res.json();
      if (data.success && data.data) {
        setLookupStatus(data.data);
        if (data.data.status === 'running') {
          if (!pollRef.current) {
            pollRef.current = setInterval(() => {
              fetch('/api/activate/import-pp-data?action=lookup-status')
                .then(r => r.json())
                .then(d => {
                  if (d.success && d.data) {
                    setLookupStatus(d.data);
                    if (d.data.status !== 'running' && pollRef.current) {
                      clearInterval(pollRef.current);
                      pollRef.current = null;
                    }
                  }
                })
                .catch((err: unknown) => { log.error('Lookup poll failed', { err }, 'PPDataTab'); });
            }, 3000);
          }
        } else {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          if (data.data.status === 'success') { fetchStats(); fetchRecords(); }
        }
      }
    } catch (err) { log.error('Failed to fetch lookup status', { err }, 'PPDataTab'); }
  }, [fetchStats, fetchRecords]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { if (stats && stats.total > 0) fetchRecords(); }, [stats, fetchRecords]);
  useEffect(() => { fetchLookupStatus(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, [fetchLookupStatus]);

  const handleResolveAll = async () => {
    setIsResolving(true);
    setError(null);
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
      fetchStats(); fetchRecords();
      if (d.onemap_started) setTimeout(() => fetchLookupStatus(), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolve all failed');
    } finally {
      setIsResolving(false);
    }
  };

  const handleCreateTickets = async (params: { ticket_type: string; priority: string; notes: string; assigned_team_id?: string }) => {
    setCreatingTickets(true);
    try {
      const res = await fetch('/api/activate/pp-data-tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pp_data_ids: selectedIds, ...params }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || result.error || 'Failed to create tickets');
      const { created, skipped } = result.data;
      toast.success(`Created ${created} ticket${created !== 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
      setShowTicketModal(false); setSelectedIds([]); fetchStats(); fetchRecords();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tickets');
    } finally {
      setCreatingTickets(false);
    }
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
    } catch {
      toast.error('Failed to fetch unticketed records');
    } finally {
      setSelectingAllUnticketed(false);
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

  const handleFilterChange = (setter: (v: string) => void) => (val: string) => {
    setter(val);
    setPage(1);
    if (setter === setFilterStatus) {
      const reverseMap: Record<string, PPCardCategory> = { activated: 'activated', located: 'located', not_found: 'not_found', ticketed: 'ticketed' };
      setActiveCard(val === '' ? null : reverseMap[val] || null);
    }
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

  return (
    <div className="space-y-6">
      <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-300">
          PP Data is automatically imported from the <strong>PP DATA</strong> sheet when you import an OES Excel file via the OES tab.
          Use the actions below to locate imported serials against local data or 1Map. Serials are marked <strong>Activated</strong> when they appear in OES activations.
        </p>
      </div>

      {stats && <SummaryCards stats={stats} activeCard={activeCard} onCardClick={(cat) => {
        if (activeCard === cat) {
          setActiveCard(null);
          setFilterStatus('');
        } else {
          setActiveCard(cat);
          const statusMap: Record<PPCardCategory, string> = {
            total: '', activated: 'activated', located: 'located', not_found: 'not_found', ticketed: 'ticketed',
          };
          setFilterStatus(statusMap[cat]);
        }
        setPage(1);
      }} />}

      {stats?.total === 0 && (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
          <p className="text-lg mb-2">No PP Data imported yet</p>
          <p className="text-sm">Import an OES Excel file from the OES tab to automatically extract PP Data.</p>
        </div>
      )}
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div><p className="font-medium text-red-300">Error</p><p className="text-sm text-red-400">{error}</p></div>
        </div>
      )}
      {lookupStatus?.status === 'running' && lookupStatus.total > 0 && <LookupProgressBanner status={lookupStatus} />}
      {lookupStatus?.status === 'success' && lookupStatus.total > 0 && (
        <LookupCompleteBanner status={lookupStatus} onDismiss={() => setLookupStatus(null)} />
      )}

      {stats && stats.total > 0 && (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            onClick={handleResolveAll}
            disabled={isResolving || lookupStatus?.status === 'running'}
            loading={isResolving || lookupStatus?.status === 'running'}
          >
            {isResolving ? 'Resolving...'
              : lookupStatus?.status === 'running' ? '1Map Searching...'
              : <><Search className="w-4 h-4" /> Resolve All</>}
          </Button>
          {stats.unticketed > 0 && (
            <Button
              variant="primary"
              onClick={handleSelectAllUnticketed}
              disabled={selectingAllUnticketed}
              loading={selectingAllUnticketed}
            >
              {selectingAllUnticketed ? 'Loading...'
                : <><Wrench className="w-4 h-4" /> Ticket All Unticketed ({stats.unticketed})</>}
            </Button>
          )}
          <Button variant="secondary" onClick={() => { fetchStats(); fetchRecords(); }}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="bg-blue-900/30 border border-blue-700 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-blue-300"><strong>{selectedIds.length}</strong> record{selectedIds.length !== 1 ? 's' : ''} selected</span>
          <div className="flex gap-3">
            <Button variant="secondary" size="sm" onClick={() => setSelectedIds([])}>Clear</Button>
            <Button variant="primary" size="sm" onClick={() => setShowTicketModal(true)}>
              <Wrench className="w-3.5 h-3.5" /> Create NOC Tickets
            </Button>
          </div>
        </div>
      )}

      {stats && stats.total > 0 && (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <PPDataFilters
            searchText={searchText} onSearchChange={(v) => { setSearchText(v); }}
            filterProject={filterProject} onProjectChange={handleFilterChange(setFilterProject)}
            filterStatus={filterStatus} onStatusChange={handleFilterChange(setFilterStatus)}
            filterPriority={filterPriority} onPriorityChange={handleFilterChange(setFilterPriority)}
            filterAging={filterAging} onAgingChange={handleFilterChange(setFilterAging)}
            filterDateFrom={filterDateFrom} onDateFromChange={handleFilterChange(setFilterDateFrom)}
            filterDateTo={filterDateTo} onDateToChange={handleFilterChange(setFilterDateTo)}
            onExport={handleExport}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <PPDataTableHead showSelectAll={selectableOnPage.length > 0} allChecked={allSelectableChecked} onToggleAll={toggleSelectAll} />
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {records.map((record) => (
                  <PPDataRow key={record.id} record={record} isSelected={selectedIds.includes(record.id)} onToggleSelect={toggleSelect} />
                ))}
                {records.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-8 text-center text-[var(--ff-text-tertiary)]">No records found</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-between items-center px-4 py-3 border-t border-[var(--ff-border-light)]">
              <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
              <span className="text-sm text-[var(--ff-text-secondary)]">Page {page} of {totalPages}</span>
              <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
            </div>
          )}
        </div>
      )}

      {showTicketModal && <CreatePPTicketsModal selectedCount={selectedIds.length} onConfirm={handleCreateTickets} onClose={() => setShowTicketModal(false)} loading={creatingTickets} />}
    </div>
  );
}
