/**
 * Project Team Tab Component
 * Position-based team management with add/remove capability
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { log } from '@/lib/logger';
import {
  Users, UserPlus, X, Search, Trash2, Crown,
  HardHat, Cable, Wrench, ChevronDown,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

const PROJECT_ROLES = [
  'Project Manager',
  'Site Manager',
  'Civil Manager',
  'Optical Manager',
  'Technician',
  'General',
] as const;

type ProjectRole = typeof PROJECT_ROLES[number];

const ROLE_CONFIG: Record<ProjectRole, { icon: typeof Users; color: string; bgColor: string; singular: boolean }> = {
  'Project Manager': { icon: Crown, color: 'text-amber-400', bgColor: 'bg-amber-500/10 border-amber-500/30', singular: true },
  'Site Manager':    { icon: HardHat, color: 'text-blue-400', bgColor: 'bg-blue-500/10 border-blue-500/30', singular: true },
  'Civil Manager':   { icon: Wrench, color: 'text-green-400', bgColor: 'bg-green-500/10 border-green-500/30', singular: true },
  'Optical Manager': { icon: Cable, color: 'text-purple-400', bgColor: 'bg-purple-500/10 border-purple-500/30', singular: true },
  'Technician':      { icon: Users, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10 border-cyan-500/30', singular: false },
  'General':         { icon: Users, color: 'text-gray-400', bgColor: 'bg-gray-500/10 border-gray-500/30', singular: false },
};

interface TeamMember {
  person_id: string;
  person_type: 'staff' | 'contractor';
  name: string;
  email?: string;
  phone?: string;
  role: string;
  is_active: boolean;
  is_primary: boolean;
}

interface SearchResult {
  id: string;
  name: string;
  type: 'staff' | 'contractor';
  position?: string;
  email?: string;
}

interface ProjectTeamTabProps {
  projectId: string;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ProjectTeamTab({ projectId }: ProjectTeamTabProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addingRole, setAddingRole] = useState<ProjectRole | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${projectId}/team`);
      if (!res.ok) throw new Error('Failed to fetch team');
      const data = await res.json();
      setMembers(data.data?.members || []);
    } catch (err) {
      log.error('Error fetching team', { error: err, projectId });
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  const handleRemove = async (member: TeamMember) => {
    if (!confirm(`Remove ${member.name} from this project?`)) return;
    setRemoving(member.person_id);
    try {
      const res = await fetch(`/api/projects/${projectId}/team`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: member.person_id, personType: member.person_type }),
      });
      if (!res.ok) throw new Error('Failed to remove');
      await fetchTeam();
    } catch (err) {
      log.error('Error removing member', { error: err });
    } finally {
      setRemoving(null);
    }
  };

  const openAddForRole = (role: ProjectRole) => {
    setAddingRole(role);
    setAddModalOpen(true);
  };

  const handleAdded = () => {
    setAddModalOpen(false);
    setAddingRole(null);
    fetchTeam();
  };

  if (loading) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--ff-bg-secondary)] rounded w-1/4" />
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-[var(--ff-bg-secondary)] rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-red-500/30 p-6">
        <div className="text-red-400 text-center">{error}</div>
      </div>
    );
  }

  // Group members by role
  const membersByRole: Record<string, TeamMember[]> = {};
  for (const role of PROJECT_ROLES) {
    membersByRole[role] = [];
  }
  for (const m of members) {
    const role = PROJECT_ROLES.includes(m.role as ProjectRole) ? m.role : 'General';
    (membersByRole[role] = membersByRole[role] || []).push(m);
  }

  const totalCount = members.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Project Team
          </h3>
          <span className="px-2 py-0.5 text-xs bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] rounded-full">
            {totalCount} member{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={() => { setAddingRole(null); setAddModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Add Member
        </button>
      </div>

      {/* Position Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROJECT_ROLES.map(role => {
          const config = ROLE_CONFIG[role];
          const Icon = config.icon;
          const roleMembers = membersByRole[role] || [];

          return (
            <div
              key={role}
              className={`rounded-lg border p-4 ${config.bgColor}`}
            >
              {/* Role Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${config.color}`} />
                  <span className={`text-sm font-semibold ${config.color}`}>
                    {role}{!config.singular ? 's' : ''}
                  </span>
                  <span className="text-xs text-[var(--ff-text-tertiary)]">
                    ({roleMembers.length})
                  </span>
                </div>
                {(!config.singular || roleMembers.length === 0) && (
                  <button
                    onClick={() => openAddForRole(role)}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                    title={`Add ${role}`}
                  >
                    <UserPlus className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" />
                  </button>
                )}
              </div>

              {/* Members in this role */}
              {roleMembers.length === 0 ? (
                <button
                  onClick={() => openAddForRole(role)}
                  className="w-full py-3 border border-dashed border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-tertiary)] hover:border-[var(--ff-text-secondary)] hover:text-[var(--ff-text-secondary)] transition-colors"
                >
                  + Assign {role}
                </button>
              ) : (
                <div className="space-y-2">
                  {roleMembers.map(member => (
                    <div
                      key={member.person_id}
                      className="flex items-center gap-3 bg-[var(--ff-card-bg)] rounded-lg px-3 py-2 group"
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                        member.person_type === 'staff'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-purple-500/20 text-purple-400'
                      }`}>
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                          {member.name}
                        </div>
                        <div className="text-xs text-[var(--ff-text-tertiary)]">
                          {member.person_type === 'staff' ? 'Staff' : 'Contractor'}
                          {member.email ? ` · ${member.email}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemove(member)}
                        disabled={removing === member.person_id}
                        className="p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400 transition-all"
                        title="Remove from project"
                      >
                        {removing === member.person_id
                          ? <span className="w-3.5 h-3.5 block border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />
                        }
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Member Modal */}
      {addModalOpen && (
        <AddTeamMemberModal
          projectId={projectId}
          preselectedRole={addingRole}
          onClose={() => { setAddModalOpen(false); setAddingRole(null); }}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}

// ── Add Team Member Modal ──────────────────────────────────────────────────────

function AddTeamMemberModal({
  projectId,
  preselectedRole,
  onClose,
  onAdded,
}: {
  projectId: string;
  preselectedRole: ProjectRole | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [role, setRole] = useState<ProjectRole>(preselectedRole || 'Technician');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      searchPeople(searchQuery);
    }, 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [searchQuery, projectId]);

  const searchPeople = async (q: string) => {
    setSearching(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/team-search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setSearchResults(data.data || []);
    } catch (err) {
      log.error('Search error', { error: err });
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (person: SearchResult) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId: person.id,
          personType: person.type,
          role,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to add');
      }
      onAdded();
    } catch (err) {
      log.error('Error adding member', { error: err });
      alert(err instanceof Error ? err.message : 'Failed to add team member');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--ff-card-bg)] rounded-xl border border-[var(--ff-border-light)] w-full max-w-lg mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Add Team Member
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--ff-bg-secondary)] rounded transition-colors">
            <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Role Selector */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1.5">
              Position
            </label>
            <div className="relative">
              <button
                onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] hover:border-blue-500/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {(() => {
                    const config = ROLE_CONFIG[role];
                    const Icon = config.icon;
                    return <Icon className={`w-4 h-4 ${config.color}`} />;
                  })()}
                  {role}
                </div>
                <ChevronDown className={`w-4 h-4 text-[var(--ff-text-tertiary)] transition-transform ${roleDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {roleDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full bg-[var(--ff-card-bg)] border border-[var(--ff-border-light)] rounded-lg shadow-xl overflow-hidden">
                  {PROJECT_ROLES.map(r => {
                    const config = ROLE_CONFIG[r];
                    const Icon = config.icon;
                    return (
                      <button
                        key={r}
                        onClick={() => { setRole(r); setRoleDropdownOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-[var(--ff-bg-secondary)] transition-colors ${
                          r === role ? 'bg-blue-500/10 text-blue-400' : 'text-[var(--ff-text-primary)]'
                        }`}
                      >
                        <Icon className={`w-4 h-4 ${config.color}`} />
                        {r}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1.5">
              Search Staff or Contractor
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Type a name or email..."
                className="w-full pl-10 pr-4 py-2.5 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:border-blue-500/50"
                autoFocus
              />
            </div>
          </div>

          {/* Results */}
          <div className="max-h-64 overflow-y-auto -mx-1 px-1">
            {searching ? (
              <div className="text-center py-6 text-sm text-[var(--ff-text-tertiary)]">
                Searching...
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-6 text-sm text-[var(--ff-text-tertiary)]">
                {searchQuery ? 'No results found' : 'Start typing to search'}
              </div>
            ) : (
              <div className="space-y-1">
                {searchResults.map(person => (
                  <button
                    key={`${person.type}-${person.id}`}
                    onClick={() => handleAdd(person)}
                    disabled={submitting}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--ff-bg-secondary)] transition-colors text-left disabled:opacity-50"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      person.type === 'staff'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-purple-500/20 text-purple-400'
                    }`}>
                      {person.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                        {person.name}
                      </div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">
                        {person.type === 'staff' ? 'Staff' : 'Contractor'}
                        {person.position ? ` · ${person.position}` : ''}
                        {person.email ? ` · ${person.email}` : ''}
                      </div>
                    </div>
                    <UserPlus className="w-4 h-4 text-[var(--ff-text-tertiary)] shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectTeamTab;
