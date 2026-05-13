import { useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { PoleListTable } from './PoleListTable';
import { PoleDetailPanel } from './PoleDetailPanel';
import { usePoleList } from '../hooks/usePoleList';
import { log } from '@/lib/logger';

interface ProjectOption {
  id: string;
  name: string;
  project_code?: string | null;
  status?: string | null;
}

interface PonOption {
  pon_no: number;
  pole_count: number;
}

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
});

export function WorksQAPage() {
  const router = useRouter();
  const { project_id, pon_no } = router.query;

  const projectId = typeof project_id === 'string' ? project_id : null;
  const ponNo = typeof pon_no === 'string' ? Number(pon_no) : null;

  const { data: projectsResp } = useSWR<{ data?: ProjectOption[]; success?: boolean } | ProjectOption[]>(
    '/api/projects',
    fetcher,
  );
  const projects: ProjectOption[] = Array.isArray(projectsResp)
    ? projectsResp
    : (projectsResp?.data ?? []);
  const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const selectedProject = sortedProjects.find(p => p.id === projectId) ?? null;

  const { data: ponsResp } = useSWR<{ data?: PonOption[]; success?: boolean } | PonOption[]>(
    projectId ? `/api/works-qa/pons?project_id=${encodeURIComponent(projectId)}` : null,
    fetcher,
  );
  const pons: PonOption[] = Array.isArray(ponsResp) ? ponsResp : (ponsResp?.data ?? []);

  const { poles, isLoading, mutate } = usePoleList(projectId, ponNo);
  const [selectedPoleId, setSelectedPoleId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  function pushQuery(updates: Record<string, string | null>) {
    const next = { ...router.query };
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') delete next[k];
      else next[k] = v;
    }
    void router.push({ query: next }, undefined, { shallow: true });
  }

  async function handleSync() {
    if (!projectId) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/works-qa/sync-qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!res.ok) {
        log.error('works-qa: sync-qfield failed', { status: res.status });
        return;
      }
    } catch (err) {
      log.error('works-qa: sync-qfield network error', { error: err instanceof Error ? err.message : String(err) });
      return;
    } finally {
      setSyncing(false);
    }
    void mutate();
  }

  const approvedCount = poles.filter(p => p.status === 'approved').length;
  const readyCount = poles.filter(p => p.status === 'ready').length;
  const inProgressCount = poles.filter(p => p.status === 'in_progress').length;

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Filter bar — project + PON dropdowns */}
        <div className="flex flex-wrap items-end gap-3 mb-6">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Project</label>
            <select
              value={projectId ?? ''}
              onChange={e => pushQuery({ project_id: e.target.value || null, pon_no: null })}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-72 focus:outline-none focus:border-teal-600"
            >
              <option value="">Select a project…</option>
              {sortedProjects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.project_code ? ` (${p.project_code})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">PON</label>
            <select
              value={ponNo ?? ''}
              onChange={e => pushQuery({ pon_no: e.target.value || null })}
              disabled={!projectId || pons.length === 0}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-44 focus:outline-none focus:border-teal-600 disabled:opacity-50"
            >
              <option value="">All PONs{pons.length > 0 ? ` (${pons.length})` : ''}</option>
              {pons.map(p => (
                <option key={p.pon_no} value={p.pon_no}>
                  PON {p.pon_no} — {p.pole_count} pole{p.pole_count === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </div>

          {projectId && (
            <button
              onClick={() => void handleSync()}
              disabled={syncing}
              className="px-3 py-1.5 text-sm bg-teal-700 hover:bg-teal-600 text-white rounded transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync QField'}
            </button>
          )}
          {projectId && ponNo != null && (
            <a
              href={`/api/works-qa/pon-zip?project_id=${encodeURIComponent(projectId)}&pon_no=${ponNo}`}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors"
            >
              ↓ Download ZIP
            </a>
          )}
        </div>

        {/* Summary bar */}
        {!isLoading && poles.length > 0 && (
          <div className="flex gap-5 mb-4 text-xs text-zinc-500">
            <span><span className="font-medium text-zinc-300">{poles.length}</span> poles</span>
            <span><span className="font-medium text-emerald-400">{approvedCount}</span> approved</span>
            <span><span className="font-medium text-teal-400">{readyCount}</span> ready</span>
            <span><span className="font-medium text-zinc-400">{inProgressCount}</span> in progress</span>
          </div>
        )}

        {!projectId ? (
          <div className="text-sm text-zinc-500 text-center py-16 border border-dashed border-zinc-800 rounded-lg">
            Pick a project above to load Johan&apos;s QA sweep.
          </div>
        ) : pons.length === 0 && !isLoading ? (
          <div className="text-sm text-zinc-500 text-center py-16 border border-dashed border-zinc-800 rounded-lg">
            <div className="mb-2">No PONs yet for <span className="text-zinc-300">{selectedProject?.name ?? 'this project'}</span>.</div>
            <div className="text-xs">Click <span className="text-teal-400">Sync QField</span> to pull pole photos from the field.</div>
          </div>
        ) : (
          <PoleListTable
            poles={poles}
            selectedPoleId={selectedPoleId}
            onSelect={setSelectedPoleId}
          />
        )}
      </div>

      <PoleDetailPanel
        poleId={selectedPoleId}
        onClose={() => {
          setSelectedPoleId(null);
          void mutate();
        }}
      />
    </div>
  );
}
