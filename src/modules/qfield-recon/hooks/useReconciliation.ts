'use client';
import { useEffect, useState } from 'react';
import type { ReconModel } from '../types';

export interface ProjectOption { id: string; name: string; dataLastUpdatedAt: string | null; }

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/qfield/reconciliation-projects')
      .then(async r => {
        const j: ApiEnvelope<{ projects: ProjectOption[] }> = await r.json();
        if (!r.ok || !j.success) throw new Error(j.error?.message || `HTTP ${r.status}`);
        return j;
      })
      .then(j => setProjects(j.data?.projects ?? []))
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return { projects, error };
}

export function useReconciliation(projectId: string | null) {
  const [model, setModel] = useState<ReconModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setModel(null);
    fetch(`/api/qfield/reconciliation?projectId=${encodeURIComponent(projectId)}`)
      .then(async r => {
        const j: ApiEnvelope<ReconModel> = await r.json();
        if (!r.ok || !j.success) throw new Error(j.error?.message || `HTTP ${r.status}`);
        return j;
      })
      .then(j => setModel((j.data as ReconModel) ?? null))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  return { model, loading, error };
}
