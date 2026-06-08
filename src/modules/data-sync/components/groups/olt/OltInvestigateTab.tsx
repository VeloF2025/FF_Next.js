/**
 * OltInvestigateTab — records needing investigation with cross-DR swap panel + bulk ticketing
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Search,
  ExternalLink,
  Wrench,
  XCircle,
  CheckCircle,
  ArrowLeftRight,
  Ticket,
  ClipboardList,
  Calendar,
  Download,
} from 'lucide-react';
import type { OltRecord, OltStats, InvestigationContext, SwapLookupResult, DateFilter } from '../../../types';
import { getDateRange } from '../../../types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { OltRecordTable } from './OltRecordTable';
import { OltResolveModal } from './OltResolveModal';
import { OltEscalateModal } from './OltEscalateModal';
import { CreateOltTicketsModal } from './CreateOltTicketsModal';
import type { OltTicketBatch } from './CreateOltTicketsModal';
import { log } from '@/lib/logger';

interface OltInvestigateTabProps {
  records: OltRecord[];
  stats: OltStats;
  isLoading: boolean;
  page: number;
  total: number;
  pageSize: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  setError: (e: string | null) => void;
  isStatusMismatch: (record: OltRecord) => boolean;
  getInvestigationContext: (record: OltRecord) => InvestigationContext | null;
  fetchRecords: (status: string, subStatus?: string, search?: string, project?: string, projects?: string[], dateFrom?: string, dateTo?: string) => Promise<void>;
  fetchStats: () => Promise<void>;
}

const INVESTIGATE_DATE_OPTIONS: { key: DateFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'custom', label: 'Custom' },
  { key: 'all', label: 'All' },
];

const EMPTY_INVESTIGATE_STATS: OltStats = {
  pending: 0,
  needs_investigation: 0,
  fixed: 0,
  resolved: 0,
  escalated: 0,
  empty: 0,
  total: 0,
  investigateBreakdown: { cross_dr: 0, not_found: 0, serial_other_dr: 0, other: 0 },
  projectBreakdown: [],
};

function getDateLabel(dateFilter: DateFilter, customDateFrom: string, customDateTo: string) {
  if (dateFilter === 'custom') {
    if (customDateFrom && customDateTo) return `${customDateFrom} → ${customDateTo}`;
    if (customDateFrom) return `From ${customDateFrom}`;
    if (customDateTo) return `Until ${customDateTo}`;
    return 'Custom range';
  }
  return INVESTIGATE_DATE_OPTIONS.find((option) => option.key === dateFilter)?.label || 'All';
}

function localDateBoundaryIso(dateValue: string, addDays = 0) {
  if (!dateValue) return undefined;
  const [year, month, day] = dateValue.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(year, month - 1, day + addDays, 0, 0, 0, 0);
  return date.toISOString();
}

export function OltInvestigateTab({
  records,
  isLoading,
  page,
  total,
  pageSize,
  setPage,
  setError,
  isStatusMismatch,
  getInvestigationContext,
  fetchRecords,
  fetchStats,
}: OltInvestigateTabProps) {
  // Local state
  const [investigateSubFilter, setInvestigateSubFilter] = useState<string>('all');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [filteredStats, setFilteredStats] = useState<OltStats>(EMPTY_INVESTIGATE_STATS);
  const [expandedContexts, setExpandedContexts] = useState<Set<string>>(new Set());
  const [showResolveModal, setShowResolveModal] = useState<string | null>(null);
  const [showEscalateModal, setShowEscalateModal] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Ticketing state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [creatingTickets, setCreatingTickets] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Cross-DR swap state
  const [swapLookups, setSwapLookups] = useState<Record<string, SwapLookupResult>>({});
  const [swapLoading, setSwapLoading] = useState<Set<string>>(new Set());
  const [swapErrors, setSwapErrors] = useState<Record<string, string>>({});
  const [dispatchingSignup, setDispatchingSignup] = useState<Set<string>>(new Set());

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchText);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, setPage]);

  const customDateRange = dateFilter === 'custom'
    ? {
        dateFrom: localDateBoundaryIso(customDateFrom),
        dateTo: localDateBoundaryIso(customDateTo, 1),
      }
    : getDateRange(dateFilter);

  useEffect(() => {
    if (!isProjectMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) {
        setIsProjectMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsProjectMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProjectMenuOpen]);

  // Re-fetch when sub-filter, search, project, or date changes
  useEffect(() => {
    const sub = investigateSubFilter !== 'all' ? investigateSubFilter : undefined;
    fetchRecords(
      'needs_investigation',
      sub,
      debouncedSearch || undefined,
      undefined,
      selectedProjects,
      customDateRange.dateFrom,
      customDateRange.dateTo,
    );
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investigateSubFilter, debouncedSearch, selectedProjects, customDateRange.dateFrom, customDateRange.dateTo]);

  // Fetch filtered counts for cards and filter pills
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams({ status: 'needs_investigation' });
      if (investigateSubFilter !== 'all') params.set('subStatus', investigateSubFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (selectedProjects.length > 0) params.set('projects', selectedProjects.join('|'));
      if (customDateRange.dateFrom) params.set('dateFrom', customDateRange.dateFrom);
      if (customDateRange.dateTo) params.set('dateTo', customDateRange.dateTo);

      try {
        const res = await fetch(`/api/system/olt-report/stats?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setFilteredStats(data.data || data);
      } catch {
        if (!cancelled) setFilteredStats(EMPTY_INVESTIGATE_STATS);
      }
    })();
    return () => { cancelled = true; };
  }, [investigateSubFilter, debouncedSearch, selectedProjects, customDateRange.dateFrom, customDateRange.dateTo]);

  // Load distinct project list once for the filter dropdown
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/system/olt-report/projects?status=needs_investigation');
        if (!res.ok) return;
        const data = await res.json();
        const list: string[] = data.data?.projects || data.projects || [];
        if (!cancelled) setProjects(list);
      } catch {
        // Non-fatal — filter dropdown just stays empty
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleContext = (id: string) => {
    setExpandedContexts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const investigateSubCounts = filteredStats.investigateBreakdown || { cross_dr: 0, not_found: 0, serial_other_dr: 0, other: 0 };
  const projectBreakdown = filteredStats.projectBreakdown || [];
  const selectedProjectLabel = selectedProjects.length === 0
    ? 'All Projects'
    : `${selectedProjects.length} project${selectedProjects.length === 1 ? '' : 's'} selected`;
  const ticketAllLabel = investigateSubFilter !== 'all' || selectedProjects.length > 0 || debouncedSearch || dateFilter !== 'all'
    ? 'Ticket Filtered'
    : 'Ticket All';

  const buildActiveFilterParams = (extra?: Record<string, string>) => {
    const params = new URLSearchParams({ status: 'needs_investigation', ...(extra || {}) });
    if (selectedProjects.length > 0) params.set('projects', selectedProjects.join('|'));
    if (investigateSubFilter !== 'all') params.set('subStatus', investigateSubFilter);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (customDateRange.dateFrom) params.set('dateFrom', customDateRange.dateFrom);
    if (customDateRange.dateTo) params.set('dateTo', customDateRange.dateTo);
    return params;
  };

  const toggleProject = (project: string) => {
    setSelectedProjects((prev) =>
      prev.includes(project)
        ? prev.filter((name) => name !== project)
        : [...prev, project]
    );
    setPage(1);
  };

  const handleDateFilterChange = (filter: DateFilter) => {
    setDateFilter(filter);
    if (filter !== 'custom') {
      setCustomDateFrom('');
      setCustomDateTo('');
    }
    setPage(1);
  };

  // Selection helpers
  const isSelectable = (record: OltRecord) =>
    !record.maintenance_ticket_id &&
    ['needs_investigation', 'not_found', 'empty_serial', 'serial_other_dr'].includes(record.fix_status || '');

  const selectableOnPage = records.filter(isSelectable);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === selectableOnPage.length && selectableOnPage.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableOnPage.map(r => r.id)));
    }
  };

  const handleSelectAllNotFound = async () => {
    setSelectingAll(true);
    try {
      const params = buildActiveFilterParams({
        pageSize: '10000',
        bulk: '1',
      });
      const res = await fetch(`/api/system/olt-report/records?${params.toString()}`);
      const data = await res.json();
      const allRecords = (data.data?.records || data.records || []) as OltRecord[];
      const ticketable = allRecords.filter((r: OltRecord) =>
        !r.maintenance_ticket_id &&
        ['needs_investigation', 'not_found', 'empty_serial', 'serial_other_dr'].includes(r.fix_status || '')
      );
      setSelectedIds(new Set(ticketable.map((r: OltRecord) => r.id)));
      toast.success(`Selected ${ticketable.length} records for ticketing`);
    } catch {
      toast.error('Failed to load all records');
    } finally {
      setSelectingAll(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = buildActiveFilterParams();
      const res = await fetch(`/api/system/olt-report/export?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to export OLT records');

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/);
      const filename = filenameMatch?.[1] || `olt-investigate-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Exported ${res.headers.get('X-Export-Count') || total} records`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to export OLT records');
    } finally {
      setExporting(false);
    }
  };

  const handleCreateTickets = async (params: { ticket_type: string; priority: string; notes: string; batches: OltTicketBatch[] }) => {
    setCreatingTickets(true);
    try {
      const res = await fetch('/api/system/olt-report/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batches: params.batches.map(b => ({
            record_ids: b.record_ids,
            assigned_team_id: b.assigned_team_id,
          })),
          ticket_type: params.ticket_type,
          priority: params.priority,
          notes: params.notes,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || result.error || 'Failed to create tickets');
      const { created, skipped } = result.data;
      toast.success(`Created ${created} ticket${created !== 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
      setShowTicketModal(false);
      setSelectedIds(new Set());
      fetchRecords(
        'needs_investigation',
        investigateSubFilter !== 'all' ? investigateSubFilter : undefined,
        debouncedSearch || undefined,
        undefined,
        selectedProjects,
        customDateRange.dateFrom,
        customDateRange.dateTo,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tickets');
    } finally {
      setCreatingTickets(false);
    }
  };

  // Create a home sign-up dispatch ticket directly from the Cross-DR conflict panel
  const handleCreateHomeSignupTicket = async (record: OltRecord, drNumber: string) => {
    if (dispatchingSignup.has(record.id)) return;
    setDispatchingSignup(prev => new Set(prev).add(record.id));
    try {
      const res = await fetch('/api/system/olt-report/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          record_ids: [record.id],
          ticket_type: 'home_installation_status',
          priority: 'normal',
          notes: `Home sign-up dispatch for ${drNumber} — required before serial swap can proceed.`,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || result.error || 'Failed to create ticket');
      const created = result.data?.created ?? result.created ?? 0;
      if (created === 0) {
        toast.error(`No ticket created for ${drNumber} — record may already have an open ticket`);
        return;
      }
      toast.success(`Home sign-up dispatch ticket created for ${drNumber}`);
      fetchRecords(
        'needs_investigation',
        investigateSubFilter !== 'all' ? investigateSubFilter : undefined,
        debouncedSearch || undefined,
        undefined,
        selectedProjects,
        customDateRange.dateFrom,
        customDateRange.dateTo,
      );
      fetchStats();
    } catch (err: unknown) {
      log.error('Failed to create home sign-up dispatch ticket', { error: err }, 'OltInvestigateTab');
      toast.error(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setDispatchingSignup(prev => { const s = new Set(prev); s.delete(record.id); return s; });
    }
  };

  // Cross-DR lookup
  const handleSwapLookup = async (record: OltRecord) => {
    if (!record.investigation_context) return;
    let ctx: InvestigationContext;
    try { ctx = JSON.parse(record.investigation_context); } catch { return; }

    setSwapLoading(prev => new Set(prev).add(record.id));
    setSwapErrors(prev => { const n = { ...prev }; delete n[record.id]; return n; });

    try {
      const res = await fetch('/api/system/olt-report/cross-dr-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: record.id,
          drNumber: record.drop_number,
          wrongSerial: ctx.wrongSerial,
          belongsToDr: ctx.belongsToDr,
        }),
      });
      const data = await res.json();
      const result = data.data || data;
      if (result.drA) {
        setSwapLookups(prev => ({ ...prev, [record.id]: result }));
      } else {
        const errMsg = typeof result.error === 'string' ? result.error : result.error?.message || 'Lookup failed';
        setSwapErrors(prev => ({ ...prev, [record.id]: errMsg }));
      }
    } catch {
      setSwapErrors(prev => ({ ...prev, [record.id]: 'Network error' }));
    } finally {
      setSwapLoading(prev => { const n = new Set(prev); n.delete(record.id); return n; });
    }
  };

  // Cross-DR swap fix
  const handleSwapFix = async (record: OltRecord, lookup: SwapLookupResult, fixBothDrs: boolean) => {
    const scenario = fixBothDrs ? lookup.scenario : 'fix_a_only';

    setSwapLoading(prev => new Set(prev).add(`fix-${record.id}`));
    setSwapErrors(prev => { const n = { ...prev }; delete n[record.id]; return n; });

    try {
      const res = await fetch('/api/system/olt-report/swap-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: record.id,
          drANumber: lookup.drA.drNumber,
          drACorrectSerial: lookup.drA.oesSerial,
          drAWrongSerial: lookup.drA.oneMapSerial,
          drBNumber: lookup.drB.drNumber,
          drBCorrectSerial: lookup.drB.oesSerial,
          drBWrongSerial: lookup.drB.oneMapSerial,
          scenario,
          upsTransfer: lookup.upsTransfer,
        }),
      });
      const data = await res.json();
      const result = data.data || data;
      if (result.success) {
        let msg = scenario === 'clean_swap'
          ? `Swapped serials on both ${lookup.drA.drNumber} and ${lookup.drB.drNumber}`
          : `Fixed ${lookup.drA.drNumber}` + (scenario === 'fix_a_flag_b' ? ` and flagged ${lookup.drB.drNumber}` : '');
        if (result.upsTransfer?.success) msg += ` | UPS transferred to ${lookup.drB.drNumber}`;
        if (result.photoCopy?.success) msg += ` | ${result.photoCopy.count} photos copied to ${lookup.drB.drNumber}`;
        toast.success(msg);

        // Re-sync DR A photos
        fetch('/api/activate/fetch-photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dropNumber: lookup.drA.drNumber, force: true }),
        }).then(r => r.json()).then(d => {
          const photoResult = d.data || d;
          if (photoResult.count > 0) toast.success(`${lookup.drA.drNumber}: ${photoResult.count} photos refreshed`);
        }).catch(() => { /* non-fatal */ });

        setSwapLookups(prev => { const n = { ...prev }; delete n[record.id]; return n; });
        fetchRecords(
          'needs_investigation',
          investigateSubFilter !== 'all' ? investigateSubFilter : undefined,
          debouncedSearch || undefined,
          undefined,
          selectedProjects,
          customDateRange.dateFrom,
          customDateRange.dateTo,
        );
        fetchStats();
      } else {
        const errMsg = typeof result.error === 'string' ? result.error : result.error?.message || 'Swap fix failed';
        setSwapErrors(prev => ({ ...prev, [record.id]: errMsg }));
      }
    } catch {
      setSwapErrors(prev => ({ ...prev, [record.id]: 'Network error' }));
    } finally {
      setSwapLoading(prev => { const n = new Set(prev); n.delete(`fix-${record.id}`); return n; });
    }
  };

  const onResolved = () => {
    fetchRecords(
      'needs_investigation',
      investigateSubFilter !== 'all' ? investigateSubFilter : undefined,
      debouncedSearch || undefined,
      undefined,
      selectedProjects,
      customDateRange.dateFrom,
      customDateRange.dateTo,
    );
    fetchStats();
  };

  // Render the investigation context row for each record
  const renderContextRow = (record: OltRecord) => {
    if (!record.investigation_context) return null;
    try {
      const ctx: InvestigationContext = JSON.parse(record.investigation_context);
      const isExpanded = expandedContexts.has(record.id);
      return (
        <tr key={`${record.id}-ctx`} className="border-b border-[var(--ff-border-light)]">
          <td colSpan={7} className="py-1.5 px-4">
            <button
              onClick={() => toggleContext(record.id)}
              className="w-full bg-purple-500/5 border border-purple-500/20 rounded-lg text-xs text-left hover:bg-purple-500/10 transition-colors"
            >
              <div className="flex items-center gap-2 px-3 py-2">
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />}
                <AlertTriangle className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                <span className="font-semibold text-purple-300">Cross-DR Conflict</span>
                <span className="text-[var(--ff-text-secondary)]">
                  — ONT <span className="font-mono text-red-400">{ctx.wrongSerial}</span> belongs to <span className="font-mono text-[var(--ff-accent)]">{ctx.belongsToDr}</span> ({ctx.belongsToTeam})
                </span>
              </div>
            </button>
            {isExpanded && (
              <div className="bg-purple-500/5 border border-t-0 border-purple-500/20 rounded-b-lg px-3 py-2.5 -mt-1 space-y-2">
                <p className="text-xs text-[var(--ff-text-secondary)] leading-relaxed">
                  The ONT serial <span className="font-mono text-red-400">{ctx.wrongSerial}</span> currently on 1Map
                  belongs to <a
                    href={`https://www.1map.co.za/apps/app?workspace=Fibertime%20Installations&selected=${ctx.belongsToDr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[var(--ff-accent)] hover:underline"
                    onClick={e => e.stopPropagation()}
                  >{ctx.belongsToDr}</a> ({ctx.belongsToTeam}).
                  {ctx.wrongUps && <> UPS: <span className="font-mono text-orange-400">{ctx.wrongUps}</span>.</>}
                </p>
                <div className="flex gap-4 text-xs text-[var(--ff-text-tertiary)]">
                  <span>1Map records: {ctx.totalPropRecords}</span>
                  <span className="text-green-400">Correct: {ctx.correctRecords}</span>
                  <span className="text-red-400">Wrong: {ctx.wrongRecords}</span>
                  {ctx.swappedRecords > 0 && <span className="text-orange-400">Swapped: {ctx.swappedRecords}</span>}
                </div>
                {/* Cross-DR Swap Panel */}
                <div className="mt-1 pt-2 border-t border-purple-500/10">
                  {!swapLookups[record.id] ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSwapLookup(record); }}
                        disabled={swapLoading.has(record.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 disabled:opacity-50"
                      >
                        {swapLoading.has(record.id) ? <InlineSpinner size="sm" /> : <Search className="w-3 h-3" />}
                        Check Other DR
                      </button>
                      {swapErrors[record.id] && <span className="text-[10px] text-red-400">{swapErrors[record.id]}</span>}
                    </div>
                  ) : (() => {
                    const lookup = swapLookups[record.id]!;
                    const isFixing = swapLoading.has(`fix-${record.id}`);
                    const scenarioLabels: Record<string, { label: string; color: string }> = {
                      clean_swap: { label: 'Clean Swap', color: 'text-green-400' },
                      fix_a_only: { label: lookup.upsTransfer?.needed ? 'Fix A + Transfer UPS' : 'Fix DR A Only', color: lookup.upsTransfer?.needed ? 'text-amber-400' : 'text-blue-400' },
                      fix_a_flag_b: { label: 'Fix A + Flag B', color: 'text-amber-400' },
                      fix_a_b_missing: { label: 'Fix A (B Missing)', color: 'text-amber-400' },
                    };
                    const sc = scenarioLabels[lookup.scenario] || { label: lookup.scenario, color: 'text-gray-400' };
                    return (
                      <div className="space-y-2">
                        {/* Comparison card */}
                        <div className="grid grid-cols-2 gap-3 bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-semibold text-[var(--ff-text-secondary)] uppercase">DR A ({lookup.drA.drNumber})</span>
                              <a href={`/activate/${lookup.drA.drNumber}`} target="_blank" rel="noopener noreferrer" className="text-[var(--ff-accent)] hover:text-[var(--ff-accent)]/80" title="DR Review" onClick={e => e.stopPropagation()}><Search className="w-3 h-3" /></a>
                              <a href={`https://www.1map.co.za/apps/app?workspace=Fibertime%20Installations&selected=${lookup.drA.drNumber}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300" title="View in 1Map" onClick={e => e.stopPropagation()}><ExternalLink className="w-3 h-3" /></a>
                            </div>
                            <p className="text-xs text-[var(--ff-text-secondary)]">OES: <span className="font-mono text-green-400">{lookup.drA.oesSerial}</span></p>
                            <p className="text-xs text-[var(--ff-text-secondary)]">1Map: <span className="font-mono text-red-400">{lookup.drA.oneMapSerial}</span> <XCircle className="w-3 h-3 inline text-red-400" /></p>
                            {lookup.drA.oneMapUps && (
                              <p className="text-xs text-[var(--ff-text-secondary)]">UPS: <span className={`font-mono ${lookup.upsTransfer?.needed ? 'text-amber-400' : 'text-gray-400'}`}>{lookup.drA.oneMapUps}</span>
                                {lookup.upsTransfer?.needed && <span className="text-[10px] text-amber-400 ml-1">(belongs to DR B)</span>}
                              </p>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-semibold text-[var(--ff-text-secondary)] uppercase">DR B ({lookup.drB.drNumber})</span>
                              <a href={`/activate/${lookup.drB.drNumber}`} target="_blank" rel="noopener noreferrer" className="text-[var(--ff-accent)] hover:text-[var(--ff-accent)]/80" title="DR Review" onClick={e => e.stopPropagation()}><Search className="w-3 h-3" /></a>
                              <a href={`https://www.1map.co.za/apps/app?workspace=Fibertime%20Installations&selected=${lookup.drB.drNumber}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300" title="View in 1Map" onClick={e => e.stopPropagation()}><ExternalLink className="w-3 h-3" /></a>
                            </div>
                            <p className="text-xs text-[var(--ff-text-secondary)]">OES: <span className="font-mono text-green-400">{lookup.drB.oesSerial || 'N/A'}</span></p>
                            <p className="text-xs text-[var(--ff-text-secondary)]">1Map: {lookup.drB.foundOn1Map ? (
                              <><span className={`font-mono ${lookup.drB.oneMapSerial?.toUpperCase() === lookup.drB.oesSerial?.toUpperCase() ? 'text-green-400' : 'text-red-400'}`}>{lookup.drB.oneMapSerial}</span>
                              {lookup.drB.oneMapSerial?.toUpperCase() === lookup.drB.oesSerial?.toUpperCase() ? <CheckCircle className="w-3 h-3 inline text-green-400 ml-0.5" /> : <XCircle className="w-3 h-3 inline text-red-400 ml-0.5" />}</>
                            ) : <span className="text-muted-foreground italic">Not on 1Map</span>}</p>
                            {lookup.drB.foundOn1Map && (
                              <p className="text-xs text-[var(--ff-text-secondary)]">UPS: {lookup.drB.oneMapUps ? (
                                <span className="font-mono text-gray-400">{lookup.drB.oneMapUps}</span>
                              ) : (
                                <span className={`italic ${lookup.upsTransfer?.needed ? 'text-amber-400' : 'text-muted-foreground'}`}>
                                  {lookup.upsTransfer?.needed ? 'Empty — will receive transfer' : 'Empty'}
                                </span>
                              )}</p>
                            )}
                          </div>
                        </div>
                        {/* UPS transfer notice */}
                        {lookup.upsTransfer?.needed && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 rounded border border-amber-500/20">
                            <ArrowLeftRight className="w-3 h-3 text-amber-400" />
                            <span className="text-[10px] text-amber-400">UPS {lookup.upsTransfer.serial} will transfer: {lookup.upsTransfer.from} → {lookup.upsTransfer.to}</span>
                          </div>
                        )}
                        {/* Scenario + actions */}
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-medium ${sc.color}`}>Scenario: {sc.label}</span>
                          <div className="flex items-center gap-2">
                            {swapErrors[record.id] && <span className="text-[10px] text-red-400">{swapErrors[record.id]}</span>}
                            {swapErrors[record.id]?.toLowerCase().includes('home installation') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCreateHomeSignupTicket(record, lookup.drB.drNumber); }}
                                disabled={isFixing || dispatchingSignup.has(record.id)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 disabled:opacity-50"
                              >
                                {dispatchingSignup.has(record.id) ? <InlineSpinner size="sm" /> : <ClipboardList className="w-3 h-3" />}
                                Dispatch Home Sign-up
                              </button>
                            )}
                            {lookup.scenario === 'clean_swap' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSwapFix(record, lookup, true); }}
                                disabled={isFixing}
                                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                {isFixing ? <InlineSpinner size="sm" /> : <ArrowLeftRight className="w-3 h-3" />}
                                Swap Both DRs
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSwapFix(record, lookup, false); }}
                              disabled={isFixing}
                              className={`flex items-center gap-1 px-3 py-1.5 text-white text-xs rounded disabled:opacity-50 ${lookup.upsTransfer?.needed ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                            >
                              {isFixing ? <InlineSpinner size="sm" /> : <Wrench className="w-3 h-3" />}
                              {lookup.upsTransfer?.needed ? 'Fix A + Transfer UPS' : 'Fix DR A Only'}
                            </button>
                          </div>
                        </div>
                        <p className="text-[10px] text-[var(--ff-text-tertiary)] leading-relaxed">{lookup.recommendation}</p>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </td>
        </tr>
      );
    } catch {
      return null;
    }
  };

  return (
    <>
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        {/* Search + Sub-filter bar + ticket actions */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ff-border-light)] gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {/* Search input */}
              <div className="relative w-52 shrink-0">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)]" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search DR, serial..."
                  className="w-full pl-8 pr-7 py-1.5 rounded bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]
                             text-[var(--ff-text-primary)] text-xs placeholder:text-[var(--ff-text-tertiary)]
                             focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]/50"
                />
                {searchText && (
                  <button
                    onClick={() => setSearchText('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {/* Project multi-select */}
              <div ref={projectMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setIsProjectMenuOpen((open) => !open)}
                  className="min-w-[140px] px-2.5 py-1.5 rounded bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]
                             text-[var(--ff-text-primary)] text-xs text-left flex items-center justify-between gap-2
                             focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]/50"
                  aria-label="Filter OLT investigate records by multiple projects"
                  aria-expanded={isProjectMenuOpen}
                >
                  <span>{selectedProjectLabel}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" />
                </button>
                {isProjectMenuOpen && (
                  <div className="absolute left-0 top-full z-30 mt-1 w-72 max-h-80 overflow-auto rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] shadow-xl p-2">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--ff-border-light)] mb-1">
                      <span className="text-xs font-medium text-[var(--ff-text-primary)]">Projects</span>
                      <button
                        type="button"
                        onClick={() => { setSelectedProjects([]); setPage(1); }}
                        className="text-[10px] text-[var(--ff-accent)] hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                    {projects.map((name) => (
                      <label key={name} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] cursor-pointer">
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedProjects.includes(name)}
                            onChange={() => toggleProject(name)}
                            className="accent-[var(--ff-accent)]"
                          />
                          <span className="text-xs text-[var(--ff-text-primary)] truncate">{name}</span>
                        </span>
                        <span className="text-[10px] text-[var(--ff-text-tertiary)]">
                          {projectBreakdown.find((item) => item.project === name)?.count ?? 0}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-[var(--ff-text-secondary)] mr-1">
                  <Calendar className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                  Date:
                </span>
                {INVESTIGATE_DATE_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleDateFilterChange(key)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      dateFilter === key
                        ? 'bg-[var(--ff-accent)] text-white border-[var(--ff-accent)]'
                        : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {dateFilter === 'custom' && (
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={customDateFrom}
                      onChange={(e) => { setCustomDateFrom(e.target.value); setPage(1); }}
                      className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
                      aria-label="Custom date from"
                    />
                    <span className="text-[var(--ff-text-tertiary)] text-xs">to</span>
                    <input
                      type="date"
                      value={customDateTo}
                      onChange={(e) => { setCustomDateTo(e.target.value); setPage(1); }}
                      className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
                      aria-label="Custom date to"
                    />
                  </div>
                )}
              </div>
              <span className="text-xs text-[var(--ff-text-secondary)] mr-1">Filter:</span>
              {([
                { key: 'all', label: 'All', count: filteredStats.needs_investigation },
                { key: 'needs_investigation', label: 'Cross-DR Conflict', count: investigateSubCounts.cross_dr },
                { key: 'not_found', label: 'Not on 1Map', count: investigateSubCounts.not_found },
                { key: 'serial_other_dr', label: 'Serial on Other DR', count: investigateSubCounts.serial_other_dr },
                { key: 'other', label: 'Other', count: investigateSubCounts.other },
              ] as const).map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => { setInvestigateSubFilter(key); setPage(1); }}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    investigateSubFilter === key
                      ? 'bg-[var(--ff-accent)] text-white border-[var(--ff-accent)]'
                      : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
                  }`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExport}
                disabled={exporting || total === 0}
                className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] text-xs rounded hover:border-[var(--ff-accent)]
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                aria-label="Export filtered OLT investigate records to Excel"
              >
                {exporting ? (
                  <><InlineSpinner size="sm" /> Exporting...</>
                ) : (
                  <><Download className="w-3 h-3" /> Export Excel ({total})</>
                )}
              </button>
              <button
                onClick={handleSelectAllNotFound}
                disabled={selectingAll}
                className="px-3 py-1.5 bg-amber-600 text-white text-xs rounded hover:bg-amber-700
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {selectingAll ? (
                  <><InlineSpinner size="sm" /> Loading...</>
                ) : (
                  <><Ticket className="w-3 h-3" /> {ticketAllLabel} ({total})</>
                )}
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setShowTicketModal(true)}
                  className="px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-700
                             flex items-center gap-1.5"
                >
                  <Ticket className="w-3 h-3" />
                  Create {selectedIds.size} Ticket{selectedIds.size !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 px-4 py-3 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]/35">
          <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--ff-text-tertiary)]">Filtered Total</p>
            <p className="text-lg font-semibold text-[var(--ff-text-primary)]">{total}</p>
            <p className="text-[10px] text-[var(--ff-text-tertiary)]">{getDateLabel(dateFilter, customDateFrom, customDateTo)}</p>
          </div>
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-purple-300">Cross-DR Conflict</p>
            <p className="text-lg font-semibold text-purple-200">{investigateSubCounts.cross_dr}</p>
            <p className="text-[10px] text-purple-300/80">Needs serial ownership check</p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-amber-300">Not on 1Map</p>
            <p className="text-lg font-semibold text-amber-200">{investigateSubCounts.not_found}</p>
            <p className="text-[10px] text-amber-300/80">Missing or empty 1Map serials</p>
          </div>
          <div className="rounded-lg border border-teal-500/20 bg-teal-500/10 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-teal-300">Serial on Other DR</p>
            <p className="text-lg font-semibold text-teal-200">{investigateSubCounts.serial_other_dr}</p>
            <p className="text-[10px] text-teal-300/80">Installed under a different drop</p>
          </div>
          <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--ff-text-tertiary)]">Projects</p>
            <p className="text-lg font-semibold text-[var(--ff-text-primary)]">{selectedProjects.length || projectBreakdown.length}</p>
            <p className="text-[10px] text-[var(--ff-text-tertiary)] truncate">{selectedProjectLabel}</p>
          </div>
        </div>

        <OltRecordTable
          records={records}
          mode="investigate"
          page={page}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          isLoading={isLoading}
          isStatusMismatch={isStatusMismatch}
          getInvestigationContext={getInvestigationContext}
          onResolve={(id) => setShowResolveModal(id)}
          onEscalate={(id) => setShowEscalateModal(id)}
          expandedContexts={expandedContexts}
          onToggleContext={toggleContext}
          renderContextRow={renderContextRow}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          isSelectable={isSelectable}
        />
      </div>

      {/* Modals */}
      {showResolveModal && (
        <OltResolveModal
          recordId={showResolveModal}
          onClose={() => setShowResolveModal(null)}
          onResolved={onResolved}
          setError={setError}
        />
      )}
      {showEscalateModal && (
        <OltEscalateModal
          recordId={showEscalateModal}
          onClose={() => setShowEscalateModal(null)}
          onEscalated={onResolved}
          setError={setError}
        />
      )}
      {showTicketModal && (
        <CreateOltTicketsModal
          selectedRecords={records.filter(r => selectedIds.has(r.id))}
          onConfirm={handleCreateTickets}
          onClose={() => setShowTicketModal(false)}
          loading={creatingTickets}
        />
      )}
    </>
  );
}
