'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreatePlanningItem } from '@/modules/planning/hooks/usePlanningItems';
import { PipelineProjectPicker, type PipelineProjectOption } from '@/modules/planning/components/PipelineProjectPicker';
import { log } from '@/lib/logger';

export default function PlanningNewClient() {
  const router = useRouter();
  const create = useCreatePlanningItem();
  const [project, setProject] = useState<{ id: string; label: string } | null>(null);
  const [form, setForm] = useState({ title: '', scope_area: '', description: '', priority: 'normal' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !form.title.trim()) return;
    try {
      const item = await create.mutateAsync({
        pipeline_project_id: project.id,
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
        <div>
          <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">Project</label>
          <PipelineProjectPicker
            value={project}
            onSelect={(p: PipelineProjectOption | null) => setProject(p ? { id: p.id, label: p.project_name } : null)}
            placeholder="Search all projects…"
          />
        </div>
        <input required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 border rounded-md" />
        <input placeholder="Scope / area (PON, zone, phase)" value={form.scope_area} onChange={(e) => setForm({ ...form, scope_area: e.target.value })} className="w-full px-3 py-2 border rounded-md" />
        <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border rounded-md" />
        <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-3 py-2 border rounded-md">
          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <button type="submit" disabled={create.isPending || !project} className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50">
          {create.isPending ? 'Creating…' : 'Create'}
        </button>
      </form>
    </div>
  );
}
