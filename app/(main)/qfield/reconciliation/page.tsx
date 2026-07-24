'use client';
import { useState } from 'react';
import { useProjects, useReconciliation } from '@/modules/qfield-recon/hooks/useReconciliation';
import { ReconDashboard } from '@/modules/qfield-recon/components/ReconDashboard';

export default function ReconciliationPage() {
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const { model, loading, error } = useReconciliation(projectId);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-bold">QField Audit Reconciliation</h1>
      <label className="mb-6 block">
        <span className="sr-only">Select a project</span>
        <select
          className="rounded border p-2"
          value={projectId ?? ''}
          onChange={e => setProjectId(e.target.value || null)}
        >
          <option value="">Select a project…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>

      {loading && <p>Loading reconciliation…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}
      {model && <ReconDashboard model={model} />}
    </div>
  );
}
