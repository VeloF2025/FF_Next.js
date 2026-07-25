'use client';

import { useState } from 'react';
import { FolderOpen, ChevronDown, ClipboardCheck } from 'lucide-react';
import { useProjects, useReconciliation } from '@/modules/qfield-recon/hooks/useReconciliation';
import { ReconDashboard } from '@/modules/qfield-recon/components/ReconDashboard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function ReconciliationPage() {
  const { projects, loading: projectsLoading, error: projectsError } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const { model, loading, error } = useReconciliation(projectId);

  const selectedProject = projects.find(p => p.id === projectId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">QField Audit Reconciliation</h1>
        <p className="mt-1 text-[var(--ff-text-secondary)]">
          Reconcile QField audit deltas against the project design layer — applied, stuck-recoverable, and
          never-captured features.
        </p>
      </div>

      <div className="max-w-sm">
        <label
          className="mb-2 block text-xs font-medium uppercase tracking-wider text-[var(--ff-text-tertiary)]"
          htmlFor="recon-project"
        >
          Project
        </label>
        <div className="relative">
          <select
            id="recon-project"
            value={projectId ?? ''}
            onChange={e => setProjectId(e.target.value || null)}
            disabled={projectsLoading}
            className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] py-2.5 pl-9 pr-8 text-sm font-medium text-[var(--ff-text-primary)] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
          >
            <option value="">Select a project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <FolderOpen className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ff-text-tertiary)]" />
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ff-text-tertiary)]" />
        </div>
        {selectedProject?.dataLastUpdatedAt && (
          <p className="mt-2 text-xs text-[var(--ff-text-tertiary)]">
            Data last updated: {new Date(selectedProject.dataLastUpdatedAt).toLocaleString()}
          </p>
        )}
      </div>

      {projectsError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          Failed to load projects: {projectsError}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {!projectId && !projectsError && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--ff-border-light)] py-16 text-center">
          <ClipboardCheck className="h-10 w-10 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">Select a project to begin reconciliation</p>
        </div>
      )}

      {projectId && loading && !model && (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-[var(--ff-text-secondary)]">Loading reconciliation data…</p>
        </div>
      )}

      {projectId && model && <ReconDashboard model={model} isLoading={loading} />}
    </div>
  );
}
