/**
 * WorksQAPage — main Works QA dashboard page component.
 *
 * Renders the nav bar, project/PON filter inputs, pole list table,
 * and the slide-out pole detail panel. URL query params (`project_id`,
 * `pon_no`) drive the data fetch so the view is deep-linkable.
 */
import { useState } from 'react';
import { useRouter } from 'next/router';
import { WorksQANav } from './WorksQANav';
import { PoleListTable } from './PoleListTable';
import { PoleDetailPanel } from './PoleDetailPanel';
import { usePoleList } from '../hooks/usePoleList';
import { log } from '@/lib/logger';

// 🟢 WORKING: page component — wraps table + detail panel with filter bar
export function WorksQAPage() {
  const router = useRouter();
  const { project_id, pon_no } = router.query;

  const projectId = typeof project_id === 'string' ? project_id : null;
  const ponNo = typeof pon_no === 'string' ? Number(pon_no) : null;

  const { poles, isLoading, mutate } = usePoleList(projectId, ponNo);
  const [selectedPoleId, setSelectedPoleId] = useState<string | null>(null);

  /** Push a single query param update without clobbering existing params. */
  function pushQuery(key: string, value: string) {
    void router.push({ query: { ...router.query, [key]: value } }, undefined, {
      shallow: true,
    });
  }

  /** Trigger a QField sync for the current project then refresh the list. */
  async function handleSync() {
    if (!projectId) return;
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
    }
    void mutate();
  }

  const approvedCount = poles.filter(p => p.status === 'approved').length;
  const readyCount = poles.filter(p => p.status === 'ready').length;
  const inProgressCount = poles.filter(p => p.status === 'in_progress').length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <WorksQANav />

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <input
            type="text"
            placeholder="Project ID…"
            key={projectId ?? ''}
          defaultValue={projectId ?? ''}
            className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-72 focus:outline-none focus:border-teal-600"
            onBlur={e => {
              const val = e.target.value.trim();
              if (val && val !== projectId) pushQuery('project_id', val);
            }}
          />
          <input
            type="number"
            placeholder="PON No…"
            key={ponNo ?? ''}
          defaultValue={ponNo ?? ''}
            className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-32 focus:outline-none focus:border-teal-600"
            onBlur={e => {
              const val = e.target.value.trim();
              if (val && Number(val) !== ponNo) pushQuery('pon_no', val);
            }}
          />
          {projectId && (
            <button
              onClick={() => void handleSync()}
              className="px-3 py-1.5 text-sm bg-teal-700 hover:bg-teal-600 text-white rounded transition-colors"
            >
              Sync QField
            </button>
          )}
          {projectId && ponNo && (
            <a
              href={`/api/works-qa/pon-zip?project_id=${encodeURIComponent(projectId)}&pon_no=${ponNo}`}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors"
            >
              ↓ Download ZIP
            </a>
          )}
        </div>

        {/* Summary bar — only shown when data is loaded */}
        {!isLoading && poles.length > 0 && (
          <div className="flex gap-5 mb-4 text-xs text-zinc-500">
            <span>
              <span className="font-medium text-zinc-300">{poles.length}</span> poles
            </span>
            <span>
              <span className="font-medium text-emerald-400">{approvedCount}</span> approved
            </span>
            <span>
              <span className="font-medium text-teal-400">{readyCount}</span> ready
            </span>
            <span>
              <span className="font-medium text-zinc-400">{inProgressCount}</span> in progress
            </span>
          </div>
        )}

        <PoleListTable
          poles={poles}
          selectedPoleId={selectedPoleId}
          onSelect={setSelectedPoleId}
        />

        {/* Empty state when no project has been entered yet */}
        {!projectId && !isLoading && (
          <div className="text-sm text-zinc-600 text-center py-16">
            Enter a Project ID above to load poles.
          </div>
        )}
      </div>

      {/* Slide-out detail panel — mutate on close to pick up any approvals */}
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
