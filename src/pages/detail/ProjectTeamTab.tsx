/**
 * Project Team Tab Component
 * Sprint 1: Project Hub Foundation
 *
 * Displays unified team (staff + contractors) with primary manager
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { log } from '@/lib/logger';

interface TeamMember {
  person_id: string;
  person_type: 'staff' | 'contractor';
  name: string;
  email?: string;
  phone?: string;
  role: string;
  is_active: boolean;
  is_primary: boolean;
  start_date?: string;
}

interface PrimaryManager {
  staff_id: string;
  name: string;
  role: string;
  is_primary: boolean;
}

interface TeamData {
  primaryManager: PrimaryManager | null;
  members: TeamMember[];
  stats: {
    staff: number;
    contractors: number;
    total: number;
  };
}

interface ProjectTeamTabProps {
  projectId: string;
}

export function ProjectTeamTab({ projectId }: ProjectTeamTabProps) {
  const router = useRouter();
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'staff' | 'contractor'>('all');

  useEffect(() => {
    async function fetchTeam() {
      try {
        setLoading(true);
        const response = await fetch(`/api/projects/${projectId}/team`);
        if (!response.ok) {
          throw new Error('Failed to fetch team data');
        }
        const data = await response.json();
        setTeamData(data.data);
      } catch (err) {
        log.error('Error fetching team', { error: err, projectId });
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchTeam();
  }, [projectId]);

  if (loading) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--ff-bg-secondary)] rounded w-1/4" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-[var(--ff-bg-secondary)] rounded" />
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

  if (!teamData) return null;

  const filteredMembers = teamData.members.filter(m =>
    filter === 'all' || m.person_type === filter
  );

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Total Team"
          value={teamData.stats.total}
          icon="users"
          color="blue"
        />
        <StatCard
          label="Staff Members"
          value={teamData.stats.staff}
          icon="user"
          color="green"
        />
        <StatCard
          label="Contractors"
          value={teamData.stats.contractors}
          icon="briefcase"
          color="purple"
        />
      </div>

      {/* Primary Manager Card */}
      {teamData.primaryManager && (
        <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-lg border border-blue-500/30 p-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-xs text-blue-400 font-medium uppercase tracking-wider mb-1">
                Project Manager
              </div>
              <div className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {teamData.primaryManager.name}
              </div>
              <div className="text-sm text-[var(--ff-text-secondary)]">
                {teamData.primaryManager.role}
              </div>
            </div>
            <button
              onClick={() => router.push(`/staff/${teamData.primaryManager?.staff_id}`)}
              className="px-4 py-2 text-sm bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors"
            >
              View Profile
            </button>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'staff', 'contractor'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              filter === f
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-secondary)]'
            }`}
          >
            {f === 'all' ? 'All' : f === 'staff' ? 'Staff' : 'Contractors'}
          </button>
        ))}
      </div>

      {/* Team Members Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredMembers.map(member => (
          <TeamMemberCard
            key={member.person_id}
            member={member}
            onClick={() => router.push(
              member.person_type === 'staff'
                ? `/staff/${member.person_id}`
                : `/contractors/${member.person_id}`
            )}
          />
        ))}
      </div>

      {filteredMembers.length === 0 && (
        <div className="text-center py-8 text-[var(--ff-text-secondary)]">
          No {filter === 'all' ? 'team members' : filter === 'staff' ? 'staff' : 'contractors'} assigned to this project.
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex gap-4">
        <button
          onClick={() => router.push(`/projects/${projectId}/edit?tab=team`)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Manage Team
        </button>
        <button
          onClick={() => router.push('/staff')}
          className="px-4 py-2 bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-lg text-sm font-medium transition-colors"
        >
          View All Staff
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }: {
  label: string;
  value: number;
  icon: string;
  color: 'blue' | 'green' | 'purple';
}) {
  const colorClasses = {
    blue: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
    green: 'bg-green-500/10 border-green-500/30 text-green-400',
    purple: 'bg-purple-500/10 border-purple-500/30 text-purple-400',
  };

  const icons = {
    users: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    user: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    briefcase: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-3">
        {icons[icon as keyof typeof icons]}
        <div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{value}</div>
          <div className="text-sm opacity-80">{label}</div>
        </div>
      </div>
    </div>
  );
}

function TeamMemberCard({ member, onClick }: { member: TeamMember; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4 hover:border-blue-500/50 cursor-pointer transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
          member.person_type === 'staff'
            ? 'bg-green-500/20 text-green-400'
            : 'bg-purple-500/20 text-purple-400'
        }`}>
          {member.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--ff-text-primary)] truncate">
              {member.name}
            </span>
            {member.is_primary && (
              <span className="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                PM
              </span>
            )}
          </div>
          <div className="text-sm text-[var(--ff-text-secondary)] truncate">
            {member.role}
          </div>
          <div className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            {member.person_type === 'staff' ? 'Staff' : 'Contractor'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectTeamTab;
