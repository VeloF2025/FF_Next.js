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
          <Table2 className="w-6 h-6 text-[var(--ff-primary)]" />
          <div>
            <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">Master Tracker</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">Pole-by-pole tracking — all stages from permission to activation</p>
          </div>
        </div>

        {/* Project selector */}
        {!loading && projects.length > 0 && (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            aria-label="Select project"
            className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded px-3 py-1.5 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
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
        <div className="py-16 text-center text-[var(--ff-text-tertiary)]">Loading projects…</div>
      ) : projects.length === 0 ? (
        <div className="py-16 text-center text-[var(--ff-text-tertiary)]">No active projects found.</div>
      ) : selectedId ? (
        <MasterTrackerPage key={selectedId} projectId={selectedId} />
      ) : null}
    </div>
  );
}
