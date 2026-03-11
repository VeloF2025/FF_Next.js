'use client';

/**
 * Teams Management Page Client Component
 *
 * Displays and manages internal and contractor teams:
 * - Team listing with filters
 * - Create new team
 * - Edit team details
 * - View team members
 * - Delete (soft) teams
 *
 * 🟢 WORKING: Teams page integrates ModulePage for consistent tab navigation
 */

import { useState, useMemo } from 'react';
import { ModulePage } from '@/components/module-page';
import { nocConfig } from '@/modules/navigation';
import {
  Users,
  Plus,
  Search,
  Building2,
  Wrench,
  ChevronRight,
  UserCircle,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Edit2,
  Trash2,
  X,
  Check,
  LayoutGrid,
  List,
  Crown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTeams, useCreateTeam, useUpdateTeam, useDeleteTeam } from '@/modules/noc/hooks/useTeams';
import type { Team, TeamType, CreateTeamPayload, UpdateTeamPayload } from '@/modules/noc/types/team';
import { TeamDetailPanel } from '@/modules/noc/components/TeamDetailPanel';

type ViewMode = 'cards' | 'list';

type TeamTypeFilter = 'all' | 'internal' | 'contractor';

const TEAM_TYPE_OPTIONS: { value: TeamType; label: string }[] = [
  { value: 'internal', label: 'Internal' },
  { value: 'field', label: 'Field' },
  { value: 'support', label: 'Support' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'installation', label: 'Installation' },
  { value: 'contractor', label: 'Contractor' },
];

export default function TeamsPageClient() {
  const { teams, isLoading, isError, error, refetch } = useTeams();
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TeamTypeFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // Form state for create/edit
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    team_type: TeamType;
  }>({
    name: '',
    description: '',
    team_type: 'internal',
  });

  // Filter teams by search and type
  const filteredTeams = useMemo(() => {
    let result = teams;

    // Type filter
    if (typeFilter !== 'all') {
      if (typeFilter === 'internal') {
        result = result.filter((t) => t.team_type !== 'contractor');
      } else {
        result = result.filter((t) => t.team_type === 'contractor');
      }
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query) ||
          t.team_type?.toLowerCase().includes(query)
      );
    }

    return result;
  }, [teams, searchQuery, typeFilter]);

  // Group teams by type
  const groupedTeams = useMemo(() => {
    const internal = filteredTeams.filter((t) => t.team_type !== 'contractor');
    const contractor = filteredTeams.filter((t) => t.team_type === 'contractor');
    return { internal, contractor };
  }, [filteredTeams]);

  // Handle create team
  const handleCreate = () => {
    setFormData({ name: '', description: '', team_type: 'internal' });
    setShowCreateModal(true);
  };

  // Handle edit team
  const handleEdit = (team: Team) => {
    setFormData({
      name: team.name,
      description: team.description || '',
      team_type: (team.team_type as TeamType) || 'internal',
    });
    setEditingTeam(team);
  };

  // Handle form submit (create or update)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) return;

    if (editingTeam) {
      // Update
      updateTeam.mutate(
        {
          id: editingTeam.id,
          payload: {
            name: formData.name,
            description: formData.description || undefined,
            team_type: formData.team_type,
          },
        },
        {
          onSuccess: () => {
            setEditingTeam(null);
            setFormData({ name: '', description: '', team_type: 'internal' });
          },
        }
      );
    } else {
      // Create
      createTeam.mutate(
        {
          name: formData.name,
          description: formData.description || undefined,
          team_type: formData.team_type,
        },
        {
          onSuccess: () => {
            setShowCreateModal(false);
            setFormData({ name: '', description: '', team_type: 'internal' });
          },
        }
      );
    }
  };

  // Handle delete team
  const handleDelete = (teamId: string) => {
    deleteTeam.mutate(teamId, {
      onSuccess: () => {
        setDeletingTeamId(null);
      },
    });
  };

  // Get icon for team type
  const getTeamIcon = (teamType: string) => {
    return teamType === 'contractor' ? Wrench : Building2;
  };

  // Get color for team type
  const getTeamTypeColor = (teamType: string) => {
    if (teamType === 'contractor') {
      return 'text-orange-400 bg-orange-500/10';
    }
    return 'text-blue-400 bg-blue-500/10';
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-[var(--ff-text-secondary)] animate-spin mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">Loading teams...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="p-8">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-400 mb-1">Error Loading Teams</h3>
              <p className="text-sm text-red-300">{error?.message || 'Failed to fetch teams'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isSubmitting = createTeam.isPending || updateTeam.isPending;
  const isDeleting = deleteTeam.isPending;

  // Header actions for ModulePage
  const headerActions = (
    <button
      onClick={handleCreate}
      className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] text-white rounded-lg hover:bg-[var(--ff-primary-600)] transition-colors"
    >
      <Plus className="w-5 h-5" />
      Create Team
    </button>
  );

  return (
    <ModulePage config={nocConfig} headerActions={headerActions}>
      <div className="flex flex-col h-full">
        {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search teams..."
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
        </div>

        {/* Type Filter */}
        <div className="flex items-center bg-[var(--ff-surface)] border border-[var(--ff-border)] rounded-lg p-1">
          {(['all', 'internal', 'contractor'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                typeFilter === type
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg)]'
              )}
            >
              {type === 'all' ? 'All' : type === 'internal' ? 'Internal' : 'Contractor'}
            </button>
          ))}
        </div>

        {/* Team Count */}
        <div className="text-sm text-[var(--ff-text-tertiary)]">{filteredTeams.length} teams</div>

        {/* View Toggle */}
        <div className="flex items-center border border-[var(--ff-border-light)] rounded-lg overflow-hidden ml-auto">
          <button
            onClick={() => setViewMode('cards')}
            className={cn(
              'p-2 transition-colors',
              viewMode === 'cards'
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
            )}
            title="Card view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'p-2 border-l border-[var(--ff-border-light)] transition-colors',
              viewMode === 'list'
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
            )}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Teams Content */}
      <div className="flex-1 overflow-auto">
        {filteredTeams.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
            <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No teams found</h3>
            <p className="text-[var(--ff-text-secondary)]">
              {searchQuery ? 'Try adjusting your search' : 'Create your first team to get started'}
            </p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="space-y-6">
            {/* Internal Teams */}
            {(typeFilter === 'all' || typeFilter === 'internal') && groupedTeams.internal.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3 flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Internal Teams ({groupedTeams.internal.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groupedTeams.internal.map((team) => (
                    <TeamCard
                      key={team.id}
                      team={team}
                      onClick={() => setSelectedTeamId(team.id)}
                      onEdit={() => handleEdit(team)}
                      onDelete={() => setDeletingTeamId(team.id)}
                      isDeleting={deletingTeamId === team.id && isDeleting}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Contractor Teams */}
            {(typeFilter === 'all' || typeFilter === 'contractor') && groupedTeams.contractor.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3 flex items-center gap-2">
                  <Wrench className="w-4 h-4" />
                  Contractor Teams ({groupedTeams.contractor.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groupedTeams.contractor.map((team) => (
                    <TeamCard
                      key={team.id}
                      team={team}
                      onClick={() => setSelectedTeamId(team.id)}
                      onEdit={() => handleEdit(team)}
                      onDelete={() => setDeletingTeamId(team.id)}
                      isDeleting={deletingTeamId === team.id && isDeleting}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* List View */
          <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
                  <th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Name</th>
                  <th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium hidden md:table-cell">Description</th>
                  <th className="text-center px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Members</th>
                  <th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium hidden sm:table-cell">Lead</th>
                  <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeams.map((team) => {
                  const Icon = team.team_type === 'contractor' ? Wrench : Building2;
                  const colorClass = team.team_type === 'contractor' ? 'text-orange-400' : 'text-blue-400';
                  return (
                    <tr
                      key={team.id}
                      onClick={() => setSelectedTeamId(team.id)}
                      className="border-b border-[var(--ff-border-light)] last:border-0 hover:bg-[var(--ff-bg-hover)] cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Icon className={cn('w-4 h-4 flex-shrink-0', colorClass)} />
                          <span className="text-[var(--ff-text-primary)] font-medium">{team.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--ff-text-secondary)] capitalize">
                        {team.team_type?.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3 text-[var(--ff-text-tertiary)] hidden md:table-cell max-w-xs truncate">
                        {team.description || '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-[var(--ff-text-secondary)]">
                          <Users className="w-3.5 h-3.5" />
                          {team.member_count || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--ff-text-secondary)] hidden sm:table-cell">
                        {team.lead_user ? (
                          <span className="flex items-center gap-1">
                            <Crown className="w-3.5 h-3.5 text-amber-400" />
                            {team.lead_user.name}
                          </span>
                        ) : (
                          <span className="text-[var(--ff-text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEdit(team); }}
                            className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] rounded-md transition-colors"
                            title="Edit team"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingTeamId(team.id); }}
                            disabled={deletingTeamId === team.id && isDeleting}
                            className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
                            title="Delete team"
                          >
                            {deletingTeamId === team.id && isDeleting ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingTeam) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setShowCreateModal(false); setEditingTeam(null); }} />
          <div className="relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingTeam ? 'Edit Team' : 'Create New Team'}
              </h2>
              <button
                onClick={() => { setShowCreateModal(false); setEditingTeam(null); }}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                  Team Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter team name"
                  required
                  className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                  Team Type
                </label>
                <select
                  value={formData.team_type}
                  onChange={(e) => setFormData({ ...formData, team_type: e.target.value as TeamType })}
                  className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {TEAM_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Enter team description (optional)"
                  rows={3}
                  className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>

              {/* Error Message */}
              {(createTeam.isError || updateTeam.isError) && (
                <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {createTeam.error?.message || updateTeam.error?.message || 'An error occurred'}
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700 mt-2">
                <button
                  type="button"
                  onClick={() => { setShowCreateModal(false); setEditingTeam(null); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !formData.name.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingTeam ? 'Save Changes' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Team Detail Panel */}
      {selectedTeamId && (
        <TeamDetailPanel
          teamId={selectedTeamId}
          onClose={() => setSelectedTeamId(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingTeamId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeletingTeamId(null)} />
          <div className="relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6">
            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
                <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Delete Team?</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
                This will deactivate the team. It can be reactivated later if needed.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setDeletingTeamId(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deletingTeamId)}
                  disabled={isDeleting}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 font-medium"
                >
                  {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </ModulePage>
  );
}

// Team Card Component
function TeamCard({
  team,
  onClick,
  onEdit,
  onDelete,
  isDeleting,
}: {
  team: Team;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const Icon = team.team_type === 'contractor' ? Wrench : Building2;
  const colorClass = team.team_type === 'contractor' ? 'text-orange-400 bg-orange-500/10' : 'text-blue-400 bg-blue-500/10';

  return (
    <div
      onClick={onClick}
      className="bg-[var(--ff-bg-card)] border border-[var(--ff-border-light)] rounded-lg p-4 hover:border-blue-500/30 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', colorClass)}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] rounded-md transition-colors"
            title="Edit team"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            disabled={isDeleting}
            className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
            title="Delete team"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <h3 className="text-base font-semibold text-[var(--ff-text-primary)] mb-1">{team.name}</h3>

      {team.description && (
        <p className="text-sm text-[var(--ff-text-secondary)] mb-3 line-clamp-2">{team.description}</p>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--ff-text-tertiary)] capitalize">{team.team_type?.replace('_', ' ')}</span>
        <div className="flex items-center gap-1 text-[var(--ff-text-tertiary)]">
          <Users className="w-4 h-4" />
          <span>{team.member_count || 0}</span>
        </div>
      </div>

      {team.lead_user && (
        <div className="mt-3 pt-3 border-t border-[var(--ff-border-light)] flex items-center gap-2">
          <UserCircle className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <span className="text-xs text-[var(--ff-text-secondary)]">Lead: {team.lead_user.name}</span>
        </div>
      )}
    </div>
  );
}
