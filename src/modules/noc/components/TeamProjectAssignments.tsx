'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

interface Project { id: string; project_name: string; }

interface TeamProjectAssignmentsProps {
  teamId: string;
  assignments: ProjectTeamAssignment[];
  onChanged: () => void;
}

const ROLES = [
  { value: 'activations', label: 'Activations' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'fault_repair', label: 'Fault Repair' },
  { value: 'other', label: 'Other' },
];

export function TeamProjectAssignments({ teamId, assignments, onChanged }: TeamProjectAssignmentsProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectId, setNewProjectId] = useState('');
  const [newRole, setNewRole] = useState<'activations' | 'maintenance' | 'fault_repair' | 'other'>('activations');
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/pipeline/projects?limit=200')
      .then(r => r.json())
      .then(d => setProjects(d.data ?? []))
      .catch(() => {});
  }, []);

  const handleAdd = async () => {
    if (!newProjectId) return;
    setSaving(true);
    try {
      await fetch('/api/noc/project-team-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: newProjectId, team_id: teamId, role: newRole }),
      });
      setNewProjectId('');
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      await fetch(`/api/noc/project-team-assignments/${id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-2 min-w-[260px]">
      {assignments.length === 0 && (
        <span className="text-xs text-[var(--ff-text-tertiary)]">No project assignments</span>
      )}
      {assignments.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-xs">
          <span className="text-[var(--ff-text-primary)] font-medium">{a.project_name}</span>
          <span className="text-[var(--ff-text-tertiary)] capitalize">({a.role})</span>
          <button
            onClick={() => handleRemove(a.id)}
            disabled={removingId === a.id}
            className="ml-auto text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors"
          >
            {removingId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1 pt-1 border-t border-[var(--ff-border-light)]">
        <select
          value={newProjectId}
          onChange={e => setNewProjectId(e.target.value)}
          className="text-xs px-1.5 py-1 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] flex-1 min-w-0"
        >
          <option value="">Project...</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_name}</option>)}
        </select>
        <select
          value={newRole}
          onChange={e => setNewRole(e.target.value as typeof newRole)}
          className="text-xs px-1.5 py-1 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
        >
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button
          onClick={handleAdd}
          disabled={!newProjectId || saving}
          className="p-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
