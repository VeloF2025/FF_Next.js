/**
 * OltInvestigateTab — records needing investigation with cross-DR swap panel + bulk ticketing
 */

'use client';

import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import type { OltRecord, OltStats, InvestigationContext, SwapLookupResult } from '../../../types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { OltRecordTable } from './OltRecordTable';
import { OltResolveModal } from './OltResolveModal';
import { OltEscalateModal } from './OltEscalateModal';
import { CreateOltTicketsModal } from './CreateOltTicketsModal';

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
  fetchRecords: (status: string, subStatus?: string, search?: string, project?: string) => Promise<void>;
  fetchStats: () => Promise<void>;
}

export function OltInvestigateTab({
  records,
  stats,
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
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [projects, setProjects] = useState<string[]>([]);
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

  // Cross-DR swap state
  const [swapLookups, setSwapLookups] = useState<Record<string, SwapLookupResult>>({});
  const [swapLoading, setSwapLoading] = useState<Set<string>>(new Set());
  const [swapErrors, setSwapErrors] = useState<Record<string, string>>({});

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchText);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, setPage]);

  // Re-fetch when sub-filter, search, or project changes
  useEffect(() => {
    const sub = investigateSubFilter !== 'all' ? investigateSubFilter : undefined;
    const proj = projectFilter !== 'all' ? projectFilter : undefined;
    fetchRecords('needs_investigation', sub, debouncedSearch || undefined, proj);
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investigateSubFilter, debouncedSearch, projectFilter]);

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

  const investigateSubCounts = stats.investigateBreakdown || { cross_dr: 0, not_found: 0, other: 0 };

  // Selection helpers
  const isSelectable = (record: OltRecord) =>
    !record.maintenance_ticket_id &&
    ['needs_investigation', 'not_found', 'empty_serial'].includes(record.fix_status || '');

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
      const params = new URLSearchParams({
        status: 'needs_investigation',
        pageSize: '10000',
      });
      if (projectFilter !== 'all') params.set('project', projectFilter);
      const res = await fetch(`/api/system/olt-report/records?${params.toString()}`);
      const data = await res.json();
      const allRecords = (data.data?.records || data.records || []) as OltRecord[];
      const ticketable = allRecords.filter((r: OltRecord) =>
        !r.maintenance_ticket_id &&
        ['needs_investigation', 'not_found', 'empty_serial'].includes(r.fix_status || '')
      );
      setSelectedIds(new Set(ticketable.map((r: OltRecord) => r.id)));
      toast.success(`Selected ${ticketable.length} records for ticketing`);
    } catch {
      toast.error('Failed to load all records');
    } finally {
      setSelectingAll(false);
    }
  };

  const handleCreateTickets = async (params: { ticket_type: string; priority: string; notes: string; assigned_team_id?: string }) => {
    setCreatingTickets(true);
    try {
      const res = await fetch('/api/system/olt-report/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_ids: Array.from(selectedIds), ...params }),
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
        projectFilter !== 'all' ? projectFilter : undefined,
      );
      fetchStats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tickets');
    } finally {
      setCreatingTickets(false);
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
          projectFilter !== 'all' ? projectFilter : undefined,
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
      projectFilter !== 'all' ? projectFilter : undefined,
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
        {(records.length > 0 || debouncedSearch) && (
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
              {/* Project filter */}
              <select
                value={projectFilter}
                onChange={(e) => { setProjectFilter(e.target.value); setPage(1); }}
                className="shrink-0 px-2.5 py-1.5 rounded bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]
                           text-[var(--ff-text-primary)] text-xs
                           focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]/50"
                title="Filter by project"
              >
                <option value="all">All Projects</option>
                {projects.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <span className="text-xs text-[var(--ff-text-secondary)] mr-1">Filter:</span>
              {([
                { key: 'all', label: 'All', count: stats.needs_investigation },
                { key: 'needs_investigation', label: 'Cross-DR Conflict', count: investigateSubCounts.cross_dr },
                { key: 'not_found', label: 'Not on 1Map', count: investigateSubCounts.not_found },
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
                onClick={handleSelectAllNotFound}
                disabled={selectingAll}
                className="px-3 py-1.5 bg-amber-600 text-white text-xs rounded hover:bg-amber-700
                           disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {selectingAll ? (
                  <><InlineSpinner size="sm" /> Loading...</>
                ) : (
                  <><Ticket className="w-3 h-3" /> Ticket All ({stats.needs_investigation})</>
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
        )}

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
          selectedCount={selectedIds.size}
          onConfirm={handleCreateTickets}
          onClose={() => setShowTicketModal(false)}
          loading={creatingTickets}
        />
      )}
    </>
  );
}
