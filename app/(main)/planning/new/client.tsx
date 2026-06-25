'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreatePlanningItem } from '@/modules/planning/hooks/usePlanningItems';
import { ProjectQueryService } from '@/services/projects/core/projectQueryService';
import { log } from '@/lib/logger';
import type { Project } from '@/types/project/base.types';

export default function PlanningNewClient() {
  const router = useRouter();
  const create = useCreatePlanningItem();
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState({ project_id: '', title: '', scope_area: '', description: '', priority: 'normal' });

  useEffect(() => {
    ProjectQueryService.getActiveProjects()
      .then(setProjects)
      .catch((error) => log.error('Failed to load projects', { data: error }, 'PlanningNew'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.project_id || !form.title.trim()) return;
    try {
      const item = await create.mutateAsync({
        project_id: form.project_id,
        title: form.title.trim(),
        scope_area: form.scope_area || null,
        description: form.description || null,
        priority: form.priority as 'low' | 'normal' | 'high' | 'urgent',
        source: 'manual',
      });
      router.push(`/planning/${item.id}`);
    } catch (error) {
      log.error('Failed to create planning item', { data: error }, 'PlanningNew');
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-4">New Planning Item</h1>
      <form onSubmit={submit} className="space-y-3">
        <select required value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="w-full px-3 py-2 border rounded-md">
          <option value="">Select project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.project_name ?? p.name}</option>)}
        </select>
        <input required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 border rounded-md" />
        <input placeholder="Scope / area (PON, zone, phase)" value={form.scope_area} onChange={(e) => setForm({ ...form, scope_area: e.target.value })} className="w-full px-3 py-2 border rounded-md" />
        <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border rounded-md" />
        <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-3 py-2 border rounded-md">
          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50">
          {create.isPending ? 'Creating…' : 'Create'}
        </button>
      </form>
    </div>
  );
}
