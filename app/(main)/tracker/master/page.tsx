'use client';

import { useState, useEffect } from 'react';
import { Table2 } from 'lucide-react';
import { MasterTrackerPage } from '@/modules/tracker/components/MasterTrackerPage';
import { log } from '@/lib/logger';

interface Project {
  id: string;
  name: string;
}

export default function MasterTrackerSubPage() {
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
        log.error('MasterTrackerSubPage: failed to fetch projects', { err }, 'tracker');
      } finally {
        setLoading(false);
      }
    }
    void fetchProjects();
  }, []);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Table2 className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Master Tracker</h1>
            <p className="text-sm text-slate-400">Pole-by-pole tracking — all stages from permission to activation</p>
          </div>
        </div>

        {/* Project selector */}
        {!loading && projects.length > 0 && (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-16 text-center text-slate-500">Loading projects…</div>
      ) : projects.length === 0 ? (
        <div className="py-16 text-center text-slate-500">No active projects found.</div>
      ) : selectedId ? (
        <MasterTrackerPage key={selectedId} projectId={selectedId} />
      ) : null}
    </div>
  );
}
