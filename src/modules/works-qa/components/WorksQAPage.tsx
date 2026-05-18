import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { ArrowLeft, RefreshCw, Download, LayoutGrid, Table2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { PoleListTable } from './PoleListTable';
import { PoleDetailPanel } from './PoleDetailPanel';
import { WorksQAProjectCardRich } from './dashboard/WorksQAProjectCardRich';
import { WorksQAProjectTable } from './dashboard/WorksQAProjectTable';
import { WorksQAFiltersBar } from './WorksQAFiltersBar';
import { ConfirmPlantedModal } from './ConfirmPlantedModal';
import { usePoleList } from '../hooks/usePoleList';
import type { WorksQAZoneSummary } from '../types/works-qa.types';
import type { WorksQADashboardResponse } from '../types/dashboard.types';

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as ApiEnvelope<T> | T;
  if (body && typeof body === 'object' && 'success' in body && (body as ApiEnvelope<T>).data !== undefined) {
    return (body as ApiEnvelope<T>).data as T;
  }
  return body as T;
}

export function WorksQAPage() {
  const router = useRouter();
  const { project_id, zone_no, pon_no } = router.query;
  const projectId = typeof project_id === 'string' ? project_id : null;
  const zoneNo = typeof zone_no === 'string' ? Number(zone_no) : null;
  const ponNo = typeof pon_no === 'string' ? Number(pon_no) : null;

  // Rich dashboard endpoint — same shape used in QA Centre (cards + table view).
  // We always fetch (even at Level 2) so the project header in the detail view
  // can still resolve project_name without an extra round-trip.
  const { data: dashboard, isLoading: dashboardLoading } = useSWR<WorksQADashboardResponse>(
    '/api/works-qa/project-dashboard',
    fetcher,
  );
  const projects = dashboard?.projects ?? [];
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  const { data: zones = [], isLoading: zonesLoading } = useSWR<WorksQAZoneSummary[]>(
    projectId ? `/api/works-qa/zones?project_id=${encodeURIComponent(projectId)}` : null,
    fetcher,
  );

  const { poles, isLoading: polesLoading, mutate: mutatePoles } = usePoleList(projectId, ponNo);
  const [selectedPoleId, setSelectedPoleId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [snagPole, setSnagPole] = useState<{ id: string; pole_label: string } | null>(null);
  // Tracks which projects this mount has already auto-synced so opening, leaving,
  // and returning to the same project doesn't refire a sync on every navigation.
  const autoSyncedRef = useRef<Set<string>>(new Set());

  const selectedProject = projects.find(p => p.project_id === projectId);

  function pushQuery(updates: Record<string, string | null>) {
    const next = { ...router.query };
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') delete next[k];
      else next[k] = v;
    }
    void router.push({ query: next }, undefined, { shallow: true });
  }

  function selectProject(id: string) {
    pushQuery({ project_id: id, zone_no: null, pon_no: null });
  }

  function backToDashboard() {
    void router.push({ query: {} }, undefined, { shallow: true });
    setSelectedPoleId(null);
  }

  async function handleSync() {
    if (!projectId) return;
    setSyncing(true);
    const body = JSON.stringify({ project_id: projectId });
    const headers = { 'Content-Type': 'application/json' };
    try {
      const [historicalRes, qfieldRes] = await Promise.all([
        fetch('/api/works-qa/sync-historical', { method: 'POST', headers, body }),
        fetch('/api/works-qa/sync-qfield',      { method: 'POST', headers, body }),
      ]);
      if (!historicalRes.ok) log.error('works-qa: sync-historical failed', { status: historicalRes.status });
      if (!qfieldRes.ok)     log.error('works-qa: sync-qfield failed',     { status: qfieldRes.status });
    } catch (err) {
      log.error('works-qa: sync error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false);
    }
    void mutatePoles();
  }

  // Auto-sync QField photos the first time a project is opened in this session.
  // Without this Johan's pole-tag photos sit in qfield_photo_validations until
  // someone remembers to click Sync QField. Fires fire-and-forget; the user
  // can still click the button explicitly to re-pull.
  useEffect(() => {
    if (!projectId) return;
    if (autoSyncedRef.current.has(projectId)) return;
    autoSyncedRef.current.add(projectId);
    // Guard the post-fetch setSyncing(false) so it doesn't run on an unmounted
    // component when the user navigates away mid-sync.
    let cancelled = false;
    const body = JSON.stringify({ project_id: projectId });
    const headers = { 'Content-Type': 'application/json' };
    setSyncing(true);
    Promise.all([
      fetch('/api/works-qa/sync-historical', { method: 'POST', headers, body }),
      fetch('/api/works-qa/sync-qfield',      { method: 'POST', headers, body }),
    ])
      .catch(err => log.error('works-qa: auto-sync error', { error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        if (cancelled) return;
        setSyncing(false);
        void mutatePoles();
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ─── Level 1: Project dashboard ───────────────────────────────────────
  if (!projectId) {
    const totalPoles      = projects.reduce((sum, p) => sum + p.total_poles, 0);
    const totalApproved   = projects.reduce((sum, p) => sum + p.fully_approved, 0);
    const totalOverrides  = projects.reduce((sum, p) => sum + p.override_count, 0);
    const totalUnassigned = projects.reduce((sum, p) => sum + p.unassigned_total, 0);
    const approvedPct = totalPoles > 0 ? Math.round((totalApproved / totalPoles) * 100) : 0;

    return (
      <div className="space-y-4">
        {/* Header row: aggregation summary + view toggle */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4 text-xs text-zinc-500 flex-wrap">
            <span><span className="font-medium text-zinc-200">{projects.length}</span> projects</span>
            <span>·</span>
            <span><span className="font-medium text-zinc-200">{totalPoles.toLocaleString()}</span> total poles</span>
            <span>·</span>
            <span><span className="font-medium text-green-400">{totalApproved.toLocaleString()}</span> approved ({approvedPct}%)</span>
            {totalOverrides > 0 && (
              <>
                <span>·</span>
                <span><span className="font-medium text-amber-400">{totalOverrides}</span> overrides</span>
              </>
            )}
            {totalUnassigned > 0 && (
              <>
                <span>·</span>
                <span><span className="font-medium text-amber-400">{totalUnassigned.toLocaleString()}</span> unassigned photos</span>
              </>
            )}
          </div>
          <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden" role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'cards'}
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === 'cards' ? 'bg-teal-700 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
              title="Card view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'table'}
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === 'table' ? 'bg-teal-700 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
              title="Table view"
            >
              <Table2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {dashboardLoading ? (
          <div className="flex items-center justify-center h-48">
            <LoadingSpinner size="md" label="" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-500">
            <p className="text-sm">No projects with pole photos yet.</p>
            <p className="text-xs mt-1">Sync from QField to start populating Johan&apos;s sweep.</p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {projects.map(p => (
              <WorksQAProjectCardRich
                key={p.project_id}
                project={p}
                onClick={() => selectProject(p.project_id)}
              />
            ))}
          </div>
        ) : (
          <WorksQAProjectTable projects={projects} onSelect={selectProject} />
        )}
      </div>
    );
  }

  // ─── Level 2: Project detail (zone+PON filters + pole table) ───────────
  const approvedCount = poles.filter(p => p.status === 'approved').length;
  const readyCount = poles.filter(p => p.status === 'ready').length;
  const inProgressCount = poles.filter(p => p.status === 'in_progress').length;

  return (
    <div className="space-y-4">
      {/* Top bar: back, project name, filters, sync, zip */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={backToDashboard}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All projects
          </button>
          <h2 className="text-sm font-semibold text-zinc-100">
            {selectedProject?.project_name ?? 'Project'}
          </h2>
          {zonesLoading ? (
            <span className="text-xs text-zinc-500">Loading zones…</span>
          ) : (
            <WorksQAFiltersBar
              zones={zones}
              zoneNo={zoneNo}
              ponNo={ponNo}
              onChange={updates => {
                const next: Record<string, string | null> = {};
                if ('zone_no' in updates) next.zone_no = updates.zone_no === null ? null : String(updates.zone_no);
                if ('pon_no' in updates) next.pon_no = updates.pon_no === null ? null : String(updates.pon_no);
                pushQuery(next);
              }}
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-md font-medium transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync QField'}
          </button>
          {ponNo !== null && (
            <a
              href={`/api/works-qa/pon-zip?project_id=${encodeURIComponent(projectId)}&pon_no=${ponNo}`}
              className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs px-3 py-2 rounded-md font-medium transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              ZIP
            </a>
          )}
        </div>
      </div>

      {/* Summary counts */}
      {!polesLoading && poles.length > 0 && (
        <div className="flex gap-5 text-xs text-zinc-500">
          <span><span className="font-medium text-zinc-300">{poles.length}</span> poles</span>
          <span><span className="font-medium text-green-400">{approvedCount}</span> approved</span>
          <span><span className="font-medium text-teal-400">{readyCount}</span> ready</span>
          <span><span className="font-medium text-yellow-400">{inProgressCount}</span> in progress</span>
        </div>
      )}

      {polesLoading ? (
        <div className="flex items-center justify-center h-48">
          <LoadingSpinner size="md" label="" />
        </div>
      ) : poles.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-zinc-500">
          <p className="text-sm">No poles yet for this filter.</p>
          <p className="text-xs mt-1">
            Click <span className="text-teal-400">Sync QField</span> to pull pole photos from the field.
          </p>
        </div>
      ) : (
        <PoleListTable
          poles={poles}
          selectedPoleId={selectedPoleId}
          onSelect={setSelectedPoleId}
          onSnagPole={(p) => setSnagPole({ id: p.id, pole_label: p.pole_label })}
        />
      )}

      <PoleDetailPanel
        poleId={selectedPoleId}
        onClose={() => {
          setSelectedPoleId(null);
          void mutatePoles();
        }}
      />

      {projectId && snagPole && (
        <ConfirmPlantedModal
          open
          projectId={projectId}
          poleQaPhotoId={snagPole.id}
          poleLabel={snagPole.pole_label}
          onClose={() => setSnagPole(null)}
          onChanged={() => { void mutatePoles(); }}
        />
      )}
    </div>
  );
}
