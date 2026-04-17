'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2, Loader2 } from 'lucide-react';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

interface Project { id: string; name: string; status?: string | null; }

interface Props {
  teamId: string;
  assignments: ProjectTeamAssignment[];
  onChanged: () => void;
}

type Role = 'activations' | 'maintenance' | 'civils' | 'optical' | 'fault_repair' | 'other';

const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'activations',  label: 'Activations' },
  { value: 'maintenance',  label: 'Maintenance' },
  { value: 'civils',       label: 'Civils' },
  { value: 'optical',      label: 'Optical' },
  { value: 'fault_repair', label: 'Fault Repair' },
  { value: 'other',        label: 'Other' },
];

const ROLE_COLORS: Record<Role, string> = {
  activations:  'bg-blue-500/10 text-blue-300 border-blue-500/30',
  maintenance:  'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  civils:       'bg-amber-500/10 text-amber-300 border-amber-500/30',
  optical:      'bg-purple-500/10 text-purple-300 border-purple-500/30',
  fault_repair: 'bg-red-500/10 text-red-300 border-red-500/30',
  other:        'bg-zinc-500/10 text-zinc-300 border-zinc-500/30',
};

export function TeamProjectAssignments({ teamId, assignments, onChanged }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('activations');
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Only active projects — not pipeline projects.
  useEffect(() => {
    setProjectsLoading(true);
    fetch('/api/projects?status=active&limit=500')
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d?.data)
          ? d.data
          : Array.isArray(d?.data?.projects)
            ? d.data.projects
            : [];
        setProjects(list);
      })
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, []);

  const assignedProjectIds = useMemo(
    () => new Set(assignments.map(a => a.project_id)),
    [assignments]
  );

  const filteredProjects = useMemo(() => {
    const available = projects.filter(p => !assignedProjectIds.has(p.id));
    const term = search.trim().toLowerCase();
    if (!term) return available;
    return available.filter(p => p.name?.toLowerCase().includes(term));
  }, [projects, assignedProjectIds, search]);

  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const resetAddForm = () => {
    setSelectedProjectId(null);
    setSearch('');
    setRole('activations');
    setShowAdd(false);
  };

  const handleAdd = async () => {
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/noc/project-team-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: selectedProjectId, team_id: teamId, role }),
      });
      if (!res.ok) throw new Error('Assignment failed');
      resetAddForm();
      onChanged();
    } catch {
      // non-fatal — leave form state so the user can retry
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
    <div className="space-y-3">
      {assignments.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-tertiary)] py-2">
          No projects assigned to this team yet.
        </p>
      ) : (
        <div className="space-y-2">
          {assignments.map((a) => {
            const roleColor = ROLE_COLORS[a.role as Role] ?? ROLE_COLORS.other;
            return (
              <div
                key={a.id}
                className="flex items-center gap-3 p-2.5 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                      {a.project_name}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${roleColor}`}>
                      {a.role.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(a.id)}
                  disabled={removingId === a.id}
                  className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
                  title="Remove assignment"
                >
                  {removingId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!showAdd ? (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Assign Project
        </button>
      ) : (
        <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg space-y-3">
          {!selectedProject ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={projectsLoading ? 'Loading active projects…' : 'Search active projects…'}
                  disabled={projectsLoading}
                  className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  autoFocus
                />
              </div>

              <div className="max-h-48 overflow-auto border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg)]">
                {filteredProjects.length === 0 ? (
                  <p className="p-3 text-sm text-[var(--ff-text-tertiary)]">
                    {projectsLoading ? 'Loading…' : search ? 'No matching active projects' : 'All active projects assigned'}
                  </p>
                ) : (
                  filteredProjects.slice(0, 30).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProjectId(p.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--ff-bg-hover)] transition-colors border-b border-[var(--ff-border-light)] last:border-0 text-[var(--ff-text-primary)]"
                    >
                      {p.name}
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[var(--ff-text-tertiary)]">Project:</span>
                <span className="font-medium text-[var(--ff-text-primary)]">{selectedProject.name}</span>
                <button
                  type="button"
                  onClick={() => setSelectedProjectId(null)}
                  className="ml-auto text-xs text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] underline"
                >
                  Change
                </button>
              </div>

              <div>
                <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1.5">Role</label>
                <div className="grid grid-cols-3 gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setRole(r.value)}
                      className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                        role === r.value
                          ? ROLE_COLORS[r.value]
                          : 'bg-[var(--ff-bg)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetAddForm}
              className="px-3 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!selectedProjectId || saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Assign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
