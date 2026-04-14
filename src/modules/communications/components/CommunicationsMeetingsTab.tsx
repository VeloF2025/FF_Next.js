'use client';

/**
 * Communications Meetings Tab
 *
 * Integrates the full Meetings module functionality:
 * - MeetingsList component (card-based with agenda/keywords)
 * - MeetingDetailModal for viewing details
 * - Sub-tab filters (all/upcoming/past/cancelled)
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { Calendar, Search } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import type { Meeting } from '@/modules/meetings/types/meeting.types';
import { MeetingsList } from '@/modules/meetings/components/MeetingsList';
import { MeetingDetailModal } from '@/modules/meetings/components/MeetingDetailModal';

interface CommunicationsMeetingsTabProps {
  meetings: Meeting[];
  getStatusColor: (status: string) => string;
  onRefresh?: () => Promise<void>;
  totalMeetings?: number;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** When set, auto-open the meeting detail modal for this meeting ID (deep-link). */
  initialMeetingId?: number;
}

type MeetingFilter = 'all' | 'upcoming' | 'past' | 'cancelled';
type SourceFilter = 'all' | 'teams' | 'fireflies';

export function CommunicationsMeetingsTab({
  meetings,
  getStatusColor: _getStatusColor,
  onRefresh: _onRefresh,
  totalMeetings,
  hasMore,
  isLoadingMore,
  onLoadMore,
  initialMeetingId,
}: CommunicationsMeetingsTabProps) {
  const [activeFilter, setActiveFilter] = useState<MeetingFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const hasAutoOpened = useRef(false);

  // Auto-open meeting modal from deep-link URL param
  useEffect(() => {
    if (!initialMeetingId || hasAutoOpened.current || meetings.length === 0) return;

    const match = meetings.find(m => String(m.id) === String(initialMeetingId));
    if (match) {
      setSelectedMeeting(match);
      setShowDetailModal(true);
      hasAutoOpened.current = true;
    } else {
      // Meeting not in loaded list — fetch it directly
      fetch(`/api/meetings?id=${initialMeetingId}`)
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          if (json?.data) {
            setSelectedMeeting(json.data);
            setShowDetailModal(true);
          }
          hasAutoOpened.current = true;
        })
        .catch(err => log.error('Failed to fetch meeting for deep-link', { err, meetingId: initialMeetingId }));
    }
  }, [initialMeetingId, meetings]);

  // Search + date filter (client-side)
  const searchedMeetings = useMemo(() => {
    let filtered = meetings;

    // Date filter
    if (dateFilter) {
      filtered = filtered.filter(m => {
        const meetingDate = m.date instanceof Date ? m.date : new Date(m.date);
        const meetingDateStr = meetingDate.toISOString().substring(0, 10);
        return meetingDateStr === dateFilter;
      });
    }

    // Text search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(m => {
        if (m.title?.toLowerCase().includes(term)) return true;
        if (m.organizer?.toLowerCase().includes(term)) return true;
        if (m.participants?.some(p => p.toLowerCase().includes(term))) return true;
        if (m.rawParticipants?.some(p =>
          (p.name?.toLowerCase().includes(term)) ||
          (p.email?.toLowerCase().includes(term)) ||
          (p.displayName?.toLowerCase().includes(term))
        )) return true;
        if (m.summary?.overview?.toLowerCase().includes(term)) return true;
        if (m.summary?.keywords?.some(k => k.toLowerCase().includes(term))) return true;
        return false;
      });
    }

    return filtered;
  }, [meetings, searchTerm, dateFilter]);

  // Filter meetings based on source + status filters
  const filteredMeetings = searchedMeetings.filter(meeting => {
    // Source filter
    if (sourceFilter !== 'all' && meeting.source !== sourceFilter) return false;

    // Status filter
    switch (activeFilter) {
      case 'upcoming':
        return meeting.status === 'scheduled';
      case 'past':
        return meeting.status === 'completed';
      case 'cancelled':
        return meeting.status === 'cancelled';
      default:
        return true;
    }
  });

  // Handle meeting click to show detail modal
  const handleEditMeeting = (meeting: Meeting) => {
    setSelectedMeeting(meeting);
    setShowDetailModal(true);
  };

  // Handle delete (no-op for now since Fireflies meetings are read-only)
  const handleDeleteMeeting = (_meetingId: string) => {
    // Future: implement delete functionality
  };

  // Source-filtered meetings for accurate counts
  const sourceMeetings = sourceFilter === 'all'
    ? searchedMeetings
    : searchedMeetings.filter(m => m.source === sourceFilter);

  const filters: { key: MeetingFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: sourceMeetings.length },
    { key: 'upcoming', label: 'Upcoming', count: sourceMeetings.filter(m => m.status === 'scheduled').length },
    { key: 'past', label: 'Past', count: sourceMeetings.filter(m => m.status === 'completed').length },
    { key: 'cancelled', label: 'Cancelled', count: sourceMeetings.filter(m => m.status === 'cancelled').length },
  ];

  const sourceFilters: { key: SourceFilter; label: string; color: string }[] = [
    { key: 'all', label: 'All Sources', color: 'bg-blue-600 text-white' },
    { key: 'teams', label: 'Teams', color: 'bg-purple-600 text-white' },
    { key: 'fireflies', label: 'Fireflies', color: 'bg-orange-600 text-white' },
  ];

  if (meetings.length === 0) {
    return (
      <div className="text-center py-12">
        <Calendar className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No meetings yet</h3>
        <p className="text-[var(--ff-text-secondary)]">
          Click &quot;Sync Fireflies&quot; to import your recorded meetings, or schedule a new meeting.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search + Date filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search meetings by title, participants, keywords..."
            className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
          />
        </div>
        <div className="relative flex-shrink-0">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)] pointer-events-none" />
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="pl-10 pr-3 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
          />
          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] text-xs"
              title="Clear date filter"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Source filter */}
      <div className="flex items-center gap-2">
        {sourceFilters.map(sf => (
          <button
            key={sf.key}
            onClick={() => setSourceFilter(sf.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              sourceFilter === sf.key
                ? sf.color
                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
            }`}
          >
            {sf.label}
          </button>
        ))}
      </div>

      {/* Status filters */}
      <div className="flex items-center gap-2">
        {filters.map(filter => (
          <button
            key={filter.key}
            onClick={() => setActiveFilter(filter.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeFilter === filter.key
                ? 'bg-[var(--ff-primary)] text-white'
                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]'
            }`}
          >
            {filter.label}
            {filter.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 text-xs rounded-full ${
                activeFilter === filter.key
                  ? 'bg-card/20 text-white'
                  : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-tertiary)]'
              }`}>
                {filter.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Meeting List */}
      {filteredMeetings.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-[var(--ff-text-secondary)]">
            No {activeFilter === 'all' ? '' : activeFilter} meetings found.
          </p>
        </div>
      ) : (
        <MeetingsList
          meetings={filteredMeetings}
          onEditMeeting={handleEditMeeting}
          onDeleteMeeting={handleDeleteMeeting}
        />
      )}

      {/* Load More */}
      {hasMore && onLoadMore && (
        <div className="flex justify-center mt-4">
          <button
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors disabled:opacity-50"
          >
            {isLoadingMore && <InlineSpinner size="sm" />}
            {isLoadingMore ? 'Loading...' : `Load More (${meetings.length} of ${totalMeetings ?? '?'})`}
          </button>
        </div>
      )}

      {/* Meeting Detail Modal */}
      <MeetingDetailModal
        meeting={selectedMeeting}
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedMeeting(null);
        }}
        onRefresh={() => _onRefresh?.()}
      />
    </div>
  );
}
