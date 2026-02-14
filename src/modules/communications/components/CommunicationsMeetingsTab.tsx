'use client';

/**
 * Communications Meetings Tab
 *
 * Integrates the full Meetings module functionality:
 * - MeetingsList component (card-based with agenda/keywords)
 * - MeetingDetailModal for viewing details
 * - Sub-tab filters (all/upcoming/past/cancelled)
 */

import { useState } from 'react';
import { Calendar } from 'lucide-react';
import type { Meeting } from '@/modules/meetings/types/meeting.types';
import { MeetingsList } from '@/modules/meetings/components/MeetingsList';
import { MeetingDetailModal } from '@/modules/meetings/components/MeetingDetailModal';

interface CommunicationsMeetingsTabProps {
  meetings: Meeting[];
  getStatusColor: (status: string) => string;
  onRefresh?: () => Promise<void>;
}

type MeetingFilter = 'all' | 'upcoming' | 'past' | 'cancelled';

export function CommunicationsMeetingsTab({
  meetings,
  getStatusColor,
  onRefresh
}: CommunicationsMeetingsTabProps) {
  const [activeFilter, setActiveFilter] = useState<MeetingFilter>('all');
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Filter meetings based on active filter
  const filteredMeetings = meetings.filter(meeting => {
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
  const handleDeleteMeeting = (meetingId: string) => {
    // Future: implement delete functionality
  };

  const filters: { key: MeetingFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: meetings.length },
    { key: 'upcoming', label: 'Upcoming', count: meetings.filter(m => m.status === 'scheduled').length },
    { key: 'past', label: 'Past', count: meetings.filter(m => m.status === 'completed').length },
    { key: 'cancelled', label: 'Cancelled', count: meetings.filter(m => m.status === 'cancelled').length },
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
      {/* Sub-tab filters */}
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
                  ? 'bg-white dark:bg-gray-800/20 text-white'
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

      {/* Meeting Detail Modal */}
      <MeetingDetailModal
        meeting={selectedMeeting}
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedMeeting(null);
        }}
      />
    </div>
  );
}
