'use client';

import { useState } from 'react';
import { X, UserPlus, Trash2, Crown, Loader2, Search } from 'lucide-react';
import {
  useTeam,
  useTeamMembers,
  useStaffDropdown,
  useAddTeamMember,
  useRemoveTeamMember,
} from '@/modules/maintenance/hooks/useTeams';
import type { UserDropdownOption } from '@/modules/maintenance/types/team';

interface TeamDetailPanelProps {
  teamId: string;
  onClose: () => void;
}

export function TeamDetailPanel({ teamId, onClose }: TeamDetailPanelProps) {
  const { team, isLoading: teamLoading } = useTeam(teamId);
  const { members, isLoading: membersLoading } = useTeamMembers(teamId);
  const { staff } = useStaffDropdown();
  const addMember = useAddTeamMember();
  const removeMember = useRemoveTeamMember();

  const [showAddForm, setShowAddForm] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<UserDropdownOption | null>(null);
  const [memberRole, setMemberRole] = useState('');
  const [isTeamLead, setIsTeamLead] = useState(false);

  const existingEmails = new Set(members.map((m) => m.email?.toLowerCase()).filter(Boolean));
  const availableStaff = staff.filter((s) => !existingEmails.has(s.email?.toLowerCase()));
  const filteredStaff = staffSearch.trim()
    ? availableStaff.filter(
        (s) =>
          s.name.toLowerCase().includes(staffSearch.toLowerCase()) ||
          s.email?.toLowerCase().includes(staffSearch.toLowerCase())
      )
    : availableStaff;

  const handleAddMember = () => {
    if (!selectedStaff) return;
    const nameParts = selectedStaff.name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    addMember.mutate(
      {
        teamId,
        payload: {
          user_id: selectedStaff.id,
          first_name: firstName,
          last_name: lastName,
          email: selectedStaff.email,
          role: memberRole || selectedStaff.role || undefined,
          is_team_lead: isTeamLead,
        },
      },
      {
        onSuccess: () => {
          setSelectedStaff(null);
          setMemberRole('');
          setIsTeamLead(false);
          setShowAddForm(false);
          setStaffSearch('');
        },
      }
    );
  };

  const handleRemoveMember = (memberId: string) => {
    removeMember.mutate({ teamId, memberId });
  };

  const resetAddForm = () => {
    setShowAddForm(false);
    setSelectedStaff(null);
    setStaffSearch('');
    setMemberRole('');
    setIsTeamLead(false);
  };

  if (teamLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div className="relative bg-[var(--ff-bg-card)] border border-[var(--ff-border)] rounded-xl shadow-2xl max-w-lg w-full mx-4 p-8">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-[var(--ff-text-secondary)]" />
        </div>
      </div>
    );
  }

  if (!team) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-[var(--ff-bg-card)] border border-[var(--ff-border)] rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-[var(--ff-border-light)] flex items-start justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">{team.name}</h2>
            <p className="text-sm text-[var(--ff-text-secondary)] capitalize mt-1">
              {team.team_type?.replace('_', ' ')}
            </p>
            {team.description && (
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-2">{team.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Members */}
        <div className="flex-1 overflow-auto p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)]">
              Members ({members.length})
            </h3>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Add Member
            </button>
          </div>

          {/* Add Member Form */}
          {showAddForm && (
            <div className="mb-4 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                <input
                  type="text"
                  value={selectedStaff ? selectedStaff.name : staffSearch}
                  onChange={(e) => {
                    setStaffSearch(e.target.value);
                    setSelectedStaff(null);
                  }}
                  placeholder="Search staff by name or email..."
                  className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>

              {/* Staff Dropdown */}
              {!selectedStaff && staffSearch.trim() && (
                <div className="max-h-40 overflow-auto border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg)]">
                  {filteredStaff.length === 0 ? (
                    <p className="p-3 text-sm text-[var(--ff-text-tertiary)]">No matching staff</p>
                  ) : (
                    filteredStaff.slice(0, 10).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setSelectedStaff(s);
                          setStaffSearch('');
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--ff-bg-hover)] transition-colors border-b border-[var(--ff-border-light)] last:border-0"
                      >
                        <span className="text-[var(--ff-text-primary)] font-medium">{s.name}</span>
                        {s.email && (
                          <span className="text-[var(--ff-text-tertiary)] ml-2 text-xs">{s.email}</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}

              {selectedStaff && (
                <>
                  <input
                    type="text"
                    value={memberRole}
                    onChange={(e) => setMemberRole(e.target.value)}
                    placeholder="Role (optional)"
                    className="w-full px-3 py-2 bg-[var(--ff-bg)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                  <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isTeamLead}
                      onChange={(e) => setIsTeamLead(e.target.checked)}
                      className="rounded border-[var(--ff-border)] text-blue-600 focus:ring-blue-500"
                    />
                    Team Lead
                  </label>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={resetAddForm}
                      className="px-3 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddMember}
                      disabled={addMember.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {addMember.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                      Add
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Members List */}
          {membersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-text-secondary)]" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-center py-8 text-sm text-[var(--ff-text-tertiary)]">
              No members yet. Add staff to this team.
            </p>
          ) : (
            <div className="space-y-2">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-sm font-medium text-blue-400 flex-shrink-0">
                      {member.first_name?.[0]}
                      {member.last_name?.[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                          {member.first_name} {member.last_name}
                        </span>
                        {member.is_team_lead && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-500/10 text-amber-400 rounded flex-shrink-0">
                            <Crown className="w-3 h-3" />
                            Lead
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[var(--ff-text-tertiary)]">
                        {member.role && <span>{member.role}</span>}
                        {member.role && member.email && <span>·</span>}
                        {member.email && <span className="truncate">{member.email}</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveMember(member.id)}
                    disabled={removeMember.isPending}
                    className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50 flex-shrink-0"
                    title="Remove member"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
