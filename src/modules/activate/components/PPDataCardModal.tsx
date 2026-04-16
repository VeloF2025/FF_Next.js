'use client';

import { useState, useCallback, useEffect } from 'react';
import { X, Search, XCircle, Wrench } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { CreatePPTicketsModal } from './CreatePPTicketsModal';
import type { PPTicketBatch } from './CreatePPTicketsModal';
import { type PPRecord, type PPCardCategory, isSelectable } from './ppDataShared';
import { PPDataRow, PPDataTableHead } from './PPDataRow';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';

const CATEGORY_CONFIG: Record<PPCardCategory, { title: string; statusFilter: string; color: string }> = {
  total:     { title: 'Total Imported',  statusFilter: '',          color: 'text-[var(--ff-text-primary)]' },
  activated: { title: 'Activated',       statusFilter: 'activated', color: 'text-green-500' },
  located:   { title: 'Located',         statusFilter: 'located',   color: 'text-blue-500' },
  not_found: { title: 'Not Found',       statusFilter: 'not_found', color: 'text-amber-500' },
  ticketed:  { title: 'Ticketed',        statusFilter: 'ticketed',  color: 'text-orange-500' },
};

interface PPDataCardModalProps {
  category: PPCardCategory;
  count: number;
  onClose: () => void;
}

export { type PPCardCategory } from './ppDataShared';

export function PPDataCardModal({ category, count, onClose }: PPDataCardModalProps) {
  const config = CATEGORY_CONFIG[category];
  const [records, setRecords] = useState<PPRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(count);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [creatingTickets, setCreatingTickets] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(searchText); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => { setSelectedIds([]); }, [page, debouncedSearch]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ action: 'list', page: String(page), limit: '50' });
      if (config.statusFilter) params.set('status', config.statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await fetch(`/api/activate/import-pp-data?${params}`);
      const data = await res.json();
      if (data.success) {
        setRecords(data.data);
        setTotalPages(data.pagination.totalPages);
        setTotal(data.pagination.total);
      }
    } catch (err) {
      log.error('Failed to fetch records', { err }, 'PPDataCardModal');
    } finally {
      setLoading(false);
    }
  }, [page, config.statusFilter, debouncedSearch]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }, []);

  const selectableOnPage = records.filter(isSelectable);
  const allSelectableChecked = selectableOnPage.length > 0 && selectableOnPage.every(r => selectedIds.includes(r.id));

  const toggleSelectAll = () => {
    if (allSelectableChecked) {
      setSelectedIds(prev => prev.filter(id => !selectableOnPage.some(r => r.id === id)));
    } else {
      setSelectedIds(prev => {
        const newIds = new Set(prev);
        selectableOnPage.forEach(r => newIds.add(r.id));
        return Array.from(newIds);
      });
    }
  };

  const handleCreateTickets = async (params: {
    ticket_type: string;
    ticket_category: string;
    priority: string;
    notes: string;
    batches: PPTicketBatch[];
  }) => {
    setCreatingTickets(true);
    try {
      const res = await fetch('/api/activate/pp-data-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batches: params.batches.map(b => ({
            pp_data_ids: b.pp_data_ids,
            assigned_team_id: b.assigned_team_id,
          })),
          ticket_type: params.ticket_type,
          ticket_category: params.ticket_category,
          priority: params.priority,
          notes: params.notes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Created ${data.data.created} ticket${data.data.created !== 1 ? 's' : ''}`);
        setShowTicketModal(false);
        setSelectedIds([]);
        fetchRecords();
      } else {
        toast.error(data.error?.message || 'Failed to create tickets');
      }
    } catch {
      toast.error('Failed to create tickets');
    } finally {
      setCreatingTickets(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--ff-bg-primary)] flex flex-col" role="dialog" aria-modal="true" aria-label={config.title}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
        <div className="flex items-center gap-3">
          <h2 className={`text-xl font-bold ${config.color}`}>{config.title}</h2>
          <span className="text-sm text-[var(--ff-text-tertiary)]">{total} record{total !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)]" />
            <input
              type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search serial, DR, ticket..."
              className="pl-8 pr-3 py-1.5 rounded bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)]
                         text-[var(--ff-text-primary)] text-sm w-56 placeholder:text-[var(--ff-text-tertiary)]"
            />
            {searchText && (
              <Button variant="ghost" size="icon" onClick={() => setSearchText('')} className="absolute right-2 top-1/2 -translate-y-1/2" aria-label="Clear search">
                <XCircle className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-blue-900/30 border-b border-blue-700 px-6 py-3 flex items-center justify-between">
          <span className="text-sm text-blue-300"><strong>{selectedIds.length}</strong> record{selectedIds.length !== 1 ? 's' : ''} selected</span>
          <div className="flex gap-3">
            <Button variant="secondary" size="sm" onClick={() => setSelectedIds([])}>Clear</Button>
            <Button variant="primary" size="sm" onClick={() => setShowTicketModal(true)}>
              <Wrench className="w-3.5 h-3.5" /> Create NOC Tickets
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <LoadingSpinner className="h-64" size="lg" label="" />
        ) : (
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
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center px-6 py-3 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span className="text-sm text-[var(--ff-text-secondary)]">Page {page} of {totalPages}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}

      {showTicketModal && (
        <CreatePPTicketsModal selectedRecords={records.filter(r => selectedIds.includes(r.id))} onConfirm={handleCreateTickets} onClose={() => setShowTicketModal(false)} loading={creatingTickets} />
      )}
    </div>
  );
}
