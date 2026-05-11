'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Table2, LayoutGrid, Settings, BarChart3 } from 'lucide-react';
import { BuildTrackerPage } from '@/modules/tracker/components/BuildTrackerPage';
import { MasterTrackerPage } from '@/modules/tracker/components/MasterTrackerPage';
import { DashboardPage } from '@/modules/tracker/components/DashboardPage';
import { TrackerSelectListAdmin } from '@/modules/tracker/components/TrackerSelectListAdmin';
import { log } from '@/lib/logger';

type Tab = 'dashboard' | 'pon' | 'master' | 'settings';

interface Project {
  id: string;
  name: string;
}

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'pon', label: 'Build Tracker', icon: Table2 },
  { id: 'master', label: 'Master Tracker', icon: LayoutGrid },
  { id: 'settings', label: 'Tracker Settings', icon: Settings },
];

export default function TrackerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Handle null searchParams (Next.js can return null in some render scenarios)
  const tabParam = searchParams?.get('tab') as Tab | null;
  const activeTab: Tab = tabParam && ['dashboard', 'pon', 'master', 'settings'].includes(tabParam) ? tabParam : 'dashboard';

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await fetch('/api/projects?limit=50&status=active');
        if (!res.ok) throw new Error('Failed to fetch projects');
        const json = (await res.json()) as { data?: Project[]; projects?: Project[] };
        const list: Project[] = json.data ?? json.projects ?? [];
        setProjects(list);
        if (list.length > 0 && list[0]) setSelectedId(list[0].id);
      } catch (err) {
        log.error('TrackerPage: failed to fetch projects', { err }, 'tracker');
      } finally {
        setLoading(false);
      }
    }
    void fetchProjects();
  }, []);

  function setTab(tab: Tab) {
    router.push(`/tracker?tab=${tab}`);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-6 pt-5 pb-0 border-b border-slate-700/60">
        <div className="flex items-center gap-4">
          {/* Tab bar */}
          <div className="flex gap-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                  activeTab === id
                    ? 'border-blue-500 text-blue-400 bg-slate-800/60'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Project selector — only for per-project tabs */}
        {activeTab !== 'dashboard' && activeTab !== 'settings' && !loading && projects.length > 0 && (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 mb-1"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'dashboard' ? (
          <DashboardPage />
        ) : loading ? (
          <div className="py-16 text-center text-slate-500">Loading projects…</div>
        ) : activeTab === 'pon' ? (
          projects.length === 0 ? (
            <div className="py-16 text-center text-slate-500">No active projects found.</div>
          ) : selectedId ? (
            <BuildTrackerPage key={selectedId} projectId={selectedId} />
          ) : null
        ) : activeTab === 'master' ? (
          projects.length === 0 ? (
            <div className="py-16 text-center text-slate-500">No active projects found.</div>
          ) : selectedId ? (
            <MasterTrackerPage key={selectedId} projectId={selectedId} />
          ) : null
        ) : (
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Settings className="w-5 h-5 text-slate-400" />
              <div>
                <h2 className="text-base font-semibold text-slate-100">Tracker Settings</h2>
                <p className="text-sm text-slate-400">Manage dropdown values used across PON and Master trackers</p>
              </div>
            </div>
            <TrackerSelectListAdmin />
          </div>
        )}
      </div>
    </div>
  );
}
