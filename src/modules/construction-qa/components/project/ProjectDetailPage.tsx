/**
 * Project Detail Page
 *
 * Hierarchical view: Zone accordion → PON rows → Feature table.
 * Reads query params for deep-linking: ?zone=4&pon=12&highlight=UUID
 * Discipline filter tabs across top.
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, RefreshCw, Download, CheckCircle, XCircle, Cloud } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import type { DateFilter } from '@/modules/data-sync/types';
import { getDateRange } from '@/modules/data-sync/types';
import type { ZoneNode } from '../../types/dashboard.types';
import { GlobalSearchBar } from '../shared/GlobalSearchBar';
import { ZoneAccordionHeader } from './ZoneAccordionHeader';
import { PonRow } from './PonRow';
import { PonFeaturesPanel } from './PonFeaturesPanel';

interface ProjectDetailPageProps {
  projectId: string;
  projectName?: string;
}

type DisciplineFilter = '' | 'civil' | 'optical';
type ApprovalFilter = '' | 'approved' | 'unapproved';

const DISCIPLINE_TABS: { key: DisciplineFilter; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'civil', label: 'Civil' },
  { key: 'optical', label: 'Optical' },
];

const APPROVAL_TABS: { key: ApprovalFilter; label: string; icon?: typeof CheckCircle }[] = [
  { key: '', label: 'All' },
  { key: 'approved', label: 'Approved (7/7)', icon: CheckCircle },
  { key: 'unapproved', label: 'Not Approved', icon: XCircle },
];

export function ProjectDetailPage({ projectId, projectName }: ProjectDetailPageProps) {
  const router = useRouter();
  const [zones, setZones] = useState<ZoneNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [discipline, setDiscipline] = useState<DisciplineFilter>('');
  const [expandedZones, setExpandedZones] = useState<Set<number>>(new Set());
  const [selectedPon, setSelectedPon] = useState<{ zone: number; pon: number } | null>(null);
  const [highlightId, setHighlightId] = useState<string | undefined>();
  const [name, setName] = useState(projectName || '');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Compute date range from filter preset or custom inputs
  const { dateFrom, dateTo } = useMemo(() => {
    if (dateFilter === 'custom') {
      return {
        dateFrom: customFrom ? new Date(customFrom).toISOString() : undefined,
        dateTo: customTo ? new Date(new Date(customTo).getTime() + 86400000).toISOString() : undefined,
      };
    }
    return getDateRange(dateFilter);
  }, [dateFilter, customFrom, customTo]);

  // Read deep-link params on mount
  useEffect(() => {
    const { zone, pon, highlight } = router.query;
    if (zone) {
      const zoneNum = Number(zone);
      setExpandedZones(new Set([zoneNum]));
      if (pon) {
        setSelectedPon({ zone: zoneNum, pon: Number(pon) });
      }
    }
    if (highlight) {
      setHighlightId(highlight as string);
    }
  }, [router.query]);

  const fetchZones = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ projectId });
      if (discipline) params.set('discipline', discipline);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (approvalFilter) params.set('approval', approvalFilter);

      const res = await fetch(`/api/construction-qa/zone-hierarchy?${params}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setZones(data.data?.zones || []);
      }
    } catch (err) {
      log.error('Failed to fetch zones', { error: (err as Error).message }, 'construction-qa');
    } finally {
      setLoading(false);
    }
  }, [projectId, discipline, dateFrom, dateTo, approvalFilter]);

  // Fetch project name if not provided
  useEffect(() => {
    if (!name) {
      fetch('/api/construction-qa/features?action=projects', { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          const projects = data.data?.projects || [];
          const match = projects.find((p: { id: string }) => p.id === projectId);
          if (match) setName(match.name);
        })
        .catch(() => { /* silently ignore */ });
    }
  }, [projectId, name]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  const toggleZone = (zoneNo: number) => {
    setExpandedZones(prev => {
      const next = new Set(prev);
      if (next.has(zoneNo)) {
        next.delete(zoneNo);
      } else {
        next.add(zoneNo);
      }
      return next;
    });
  };

  const handleSelectPon = (zoneNo: number, ponNo: number) => {
    setSelectedPon({ zone: zoneNo, pon: ponNo });
    setHighlightId(undefined);
  };

  const handleSpSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/construction-qa/sp-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json() as { data?: { queued: number; synced: number; failed: number } };
      const r = data.data;
      if (r) {
        setSyncResult(
          r.failed > 0
            ? `${r.synced} synced, ${r.failed} failed`
            : `Synced ${r.synced} reviews`,
        );
      }
    } catch (err) {
      setSyncResult('Sync failed — see logs');
      log.error('sp-sync UI error', { error: (err as Error).message });
    } finally {
      setSyncing(false);
    }
  }, [projectId]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ projectId });
      if (discipline) params.set('discipline', discipline);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (approvalFilter) params.set('approval', approvalFilter);
      window.location.href = `/api/construction-qa/export?${params}`;
    } finally {
      // Small delay so the browser starts the download
      setTimeout(() => setExporting(false), 1500);
    }
  };

  const totalFeatures = zones.reduce((sum, z) => sum + z.total, 0);
  const totalApproved = zones.reduce((sum, z) => sum + z.approved, 0);

  return (
    <div className="space-y-4">
      {/* Top bar: back + search */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/field-ops')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-400 hover:text-white bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          All Projects
        </button>
        <GlobalSearchBar />
        <button
          onClick={fetchZones}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-400 hover:text-white bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-colors ml-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Project header + stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">{name || 'Loading...'}</h2>
          <p className="text-sm text-gray-400">
            {totalFeatures} features · {totalApproved} approved
            ({totalFeatures > 0 ? Math.round((totalApproved / totalFeatures) * 100) : 0}%)
          </p>
        </div>
      </div>

      {/* Discipline tabs */}
      <div className="flex gap-1 bg-[var(--card-bg)] p-1 rounded-lg border border-[var(--border-color)]">
        {DISCIPLINE_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setDiscipline(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              discipline === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-[var(--hover-bg)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Approval filter toggle */}
      <div className="flex gap-1 bg-[var(--card-bg)] p-1 rounded-lg border border-[var(--border-color)]">
        {APPROVAL_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setApprovalFilter(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                approvalFilter === tab.key
                  ? tab.key === 'approved'
                    ? 'bg-green-600 text-white'
                    : tab.key === 'unapproved'
                      ? 'bg-amber-600 text-white'
                      : 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-[var(--hover-bg)]'
              }`}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Date filter bar + export */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'today', 'yesterday', '7d', '30d', 'custom'] as DateFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setDateFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              dateFilter === f
                ? 'bg-blue-600 text-white'
                : 'bg-[var(--card-bg)] text-gray-400 hover:text-white border border-[var(--border-color)]'
            }`}
          >
            {f === 'all' ? 'All Time' : f === '7d' ? '7 Days' : f === '30d' ? '30 Days' : f === 'custom' ? 'Custom' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        {dateFilter === 'custom' && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 rounded-md text-xs bg-[var(--card-bg)] text-white border border-[var(--border-color)]"
            />
            <span className="text-xs text-gray-500">to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="px-2 py-1.5 rounded-md text-xs bg-[var(--card-bg)] text-white border border-[var(--border-color)]"
            />
          </>
        )}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md transition-colors"
          title="Export to Excel"
        >
          <Download className={`w-3.5 h-3.5 ${exporting ? 'animate-pulse' : ''}`} />
          Export
        </button>
        <button
          onClick={() => void handleSpSync()}
          disabled={syncing}
          className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          title="Sync approved reviews to SharePoint"
        >
          <Cloud className="h-3.5 w-3.5" />
          {syncing ? 'Syncing…' : 'Sync to SharePoint'}
        </button>
        {syncResult && (
          <span className="text-xs text-gray-400">{syncResult}</span>
        )}
      </div>

      {/* Zone accordion */}
      {loading && zones.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <LoadingSpinner size="sm" label="" className="mr-2" />
          Loading zones...
        </div>
      ) : zones.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          No zones found for this project.
        </div>
      ) : (
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg divide-y divide-[var(--border-color)] overflow-hidden">
          {zones.map(zone => (
            <div key={zone.zone_no}>
              <ZoneAccordionHeader
                zone={zone}
                expanded={expandedZones.has(zone.zone_no)}
                onToggle={() => toggleZone(zone.zone_no)}
              />
              {expandedZones.has(zone.zone_no) && (
                <div className="border-t border-[var(--border-color)] bg-gray-900/30">
                  {zone.zone_no === -1 ? (
                    /* Unassigned zone: no PON sub-rows — show direct action */
                    <button
                      onClick={() => handleSelectPon(-1, -1)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 pl-12 text-left transition-colors ${
                        selectedPon?.zone === -1
                          ? 'bg-blue-500/10 border-l-2 border-blue-500'
                          : 'hover:bg-[var(--hover-bg)] border-l-2 border-transparent'
                      }`}
                    >
                      <span className="text-sm text-yellow-400/70">
                        {zone.total} features without zone/PON assignment
                      </span>
                    </button>
                  ) : zone.pons.length === 0 ? (
                    <div className="px-4 py-3 pl-12 text-xs text-gray-500">
                      No PONs in this zone.
                    </div>
                  ) : (
                    zone.pons.map(pon => (
                      <PonRow
                        key={pon.pon_no}
                        pon={pon}
                        selected={selectedPon?.zone === zone.zone_no && selectedPon?.pon === pon.pon_no}
                        onSelect={() => handleSelectPon(zone.zone_no, pon.pon_no)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Selected PON feature table */}
      {selectedPon && (
        <PonFeaturesPanel
          projectId={projectId}
          zoneNo={selectedPon.zone}
          ponNo={selectedPon.pon}
          highlightId={highlightId}
          dateFrom={dateFrom}
          dateTo={dateTo}
          parentDiscipline={discipline}
          approvalFilter={approvalFilter}
        />
      )}
    </div>
  );
}
