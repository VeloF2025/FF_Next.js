import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Plus, RefreshCw, Video, Calendar, Film } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import Link from 'next/link';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';
import type { Meeting, MeetingAttendee, MeetingSource, ProcessingStatus, UpcomingMeeting } from './types/meeting.types';

interface RawMeetingData {
  id: string;
  title: string;
  date: string;
  duration: number;
  transcript_url?: string;
  join_url?: string;
  organizer_name?: string;
  organizer_email?: string;
  source?: string;
  processing_status?: string;
  has_transcript?: boolean;
  has_recording?: boolean;
  participants?: Array<{ name?: string; email?: string; displayName?: string }>;
  summary?: {
    outline?: string[];
    keywords?: string[];
    action_items?: string[] | string;
    overview?: string;
    decisions?: string[];
  };
  fireflies_id?: string;
}
import { MeetingStatsCards } from './components/MeetingStatsCards';
import { MeetingsList } from './components/MeetingsList';
import { MeetingsSidebar } from './components/MeetingsSidebar';
import { MeetingDetailModal } from './components/MeetingDetailModal';
import { ScheduleMeetingModal } from '@/modules/livekit/components/ScheduleMeetingModal';

export function MeetingsDashboard() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [upcomingMeetings, setUpcomingMeetings] = useState<UpcomingMeeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [, setShowNewMeetingModal] = useState(false);
  const [activeTab, setActiveTab] = useState('upcoming');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingTeams, setIsSyncingTeams] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'teams' | 'fireflies'>('all');
  const [page, setPage] = useState(1);
  const [totalMeetings, setTotalMeetings] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const PAGE_SIZE = 50;
  const router = useRouter();

  useEffect(() => {
    setPage(1);
    setMeetings([]);
    loadMeetings(sourceFilter, 1, true);
    // Auto-sync from Fireflies in background on page load
    syncFromFireflies();
  }, [sourceFilter]);

  const getAttendeeDisplayName = (p: MeetingAttendee): string => {
    return p.displayName || p.name || p.email || 'Unknown';
  };

  const transformMeeting = (m: RawMeetingData): Meeting => {
    const rawParticipants: MeetingAttendee[] = Array.isArray(m.participants)
      ? m.participants.map((p) => ({
          name: p.name || '',
          email: p.email || '',
          displayName: p.displayName || '',
        }))
      : [];

    return {
      id: m.id,
      title: m.title,
      type: 'team' as const,
      date: new Date(m.date),
      time: new Date(m.date).toLocaleTimeString(),
      duration: `${m.duration} min`,
      location: 'Virtual',
      isVirtual: true,
      meetingLink: m.transcript_url || m.join_url,
      organizer: m.organizer_name || (m.source === 'teams' ? 'Teams' : 'Fireflies'),
      participants: rawParticipants.map(getAttendeeDisplayName),
      rawParticipants,
      agenda: m.summary?.outline || m.summary?.keywords || [],
      status: 'completed' as const,
      notes: Array.isArray(m.summary?.action_items) ? m.summary.action_items.join('\n') : (m.summary?.action_items || ''),
      actionItems: [],
      summary: m.summary ? {
        ...m.summary,
        action_items: Array.isArray(m.summary.action_items) ? m.summary.action_items : undefined,
      } : undefined,
      firefliesId: m.fireflies_id,
      source: (m.source || 'fireflies') as MeetingSource,
      processingStatus: (m.processing_status || 'completed') as ProcessingStatus,
      hasTranscript: Boolean(m.has_transcript),
      hasRecording: Boolean(m.has_recording),
      organizerName: m.organizer_name,
      organizerEmail: m.organizer_email,
    };
  };

  const loadMeetings = async (source?: string, pageNum = 1, reset = false) => {
    try {
      const params = new URLSearchParams();
      if (source && source !== 'all') params.set('source', source);
      params.set('page', String(pageNum));
      params.set('limit', String(PAGE_SIZE));
      const queryString = params.toString();

      const response = await fetch(`/api/meetings?${queryString}`);
      const data = await response.json();

      if (data.meetings) {
        const transformed = data.meetings.map(transformMeeting);

        if (reset || pageNum === 1) {
          setMeetings(transformed);
        } else {
          setMeetings(prev => [...prev, ...transformed]);
        }
        setTotalMeetings(data.total ?? transformed.length);
        setTotalPages(data.totalPages ?? 1);
        setUpcomingMeetings([]);
      }
    } catch (error) {
      log.error('Failed to load meetings', { error }, 'MeetingsDashboard');
      if (reset || pageNum === 1) {
        setMeetings([]);
      }
      setUpcomingMeetings([]);
    }
  };

  const handleLoadMore = async () => {
    const nextPage = page + 1;
    setIsLoadingMore(true);
    setPage(nextPage);
    await loadMeetings(sourceFilter, nextPage, false);
    setIsLoadingMore(false);
  };

  const syncFromFireflies = async () => {
    try {
      const response = await fetch('/api/meetings?action=sync', { method: 'POST' });
      const data = await response.json();
      if (data.success && data.synced > 0) {
        setPage(1);
        await loadMeetings(sourceFilter, 1, true);
      }
    } catch (error) {
      // Silent fail - background sync shouldn't disrupt UX
      log.error('Background Fireflies sync failed', { error }, 'MeetingsDashboard');
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMessage(null);

    try {
      const response = await fetch('/api/meetings?action=sync', {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        setSyncMessage(`Synced ${data.synced} meetings from Fireflies`);
        setPage(1);
        await loadMeetings(sourceFilter, 1, true);
      } else {
        setSyncMessage(`Sync failed: ${data.error}`);
      }
    } catch (e: unknown) {
      setSyncMessage(`Sync failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  const handleTeamsSync = async () => {
    setIsSyncingTeams(true);
    setSyncMessage(null);

    try {
      const response = await fetch('/api/meetings/sync-teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 48 }),
      });

      if (response.ok) {
        setSyncMessage('Teams sync started (processing in background)');
        setTimeout(() => { setPage(1); loadMeetings(sourceFilter, 1, true); }, 5000);
      } else {
        const data = await response.json();
        setSyncMessage(`Teams sync failed: ${data.error?.message || 'Unknown error'}`);
      }
    } catch (e: unknown) {
      setSyncMessage(`Teams sync failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsSyncingTeams(false);
      setTimeout(() => setSyncMessage(null), 8000);
    }
  };

  const filteredMeetings = meetings.filter(meeting => {
    if (activeTab === 'upcoming') return meeting.status === 'scheduled';
    if (activeTab === 'past') return meeting.status === 'completed';
    if (activeTab === 'cancelled') return meeting.status === 'cancelled';
    return true;
  });

  const handleEditMeeting = (meeting: Meeting) => {
    setSelectedMeeting(meeting);
    setShowMeetingModal(true);
  };

  const handleDeleteMeeting = (meetingId: string) => {
    setMeetings(prev => prev.filter(m => m.id !== meetingId));
  };

  const handleScheduleMeeting = () => {
    setShowNewMeetingModal(true);
  };

  const handleStartVideoMeeting = async () => {
    setIsCreatingRoom(true);
    try {
      const response = await fetch('/api/livekit/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Meeting ${new Date().toLocaleString()}` }),
      });
      const data = await response.json();
      if (data.success && data.room) {
        router.push(`/livekit/${data.room.name}`);
      } else {
        notificationService.error('Failed to create meeting: ' + (data.error || 'Unknown error'));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notificationService.error('Failed to create meeting: ' + message);
    } finally {
      setIsCreatingRoom(false);
    }
  };

  return (
    <div className="ff-page-container">
      {/* Header */}
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ff-text-primary)] mb-2">Meetings Management</h1>
          <p className="text-[var(--ff-text-secondary)]">Schedule, manage and track all meetings</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => setShowScheduleModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <Calendar className="w-4 h-4" />
              Schedule Meeting
            </button>
            <button
              onClick={handleStartVideoMeeting}
              disabled={isCreatingRoom}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${isCreatingRoom
                ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
                }`}
            >
              <Video className="w-4 h-4" />
              {isCreatingRoom ? 'Creating...' : 'Start Now'}
            </button>
            <Link
              href="/recordings"
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              <Film className="w-4 h-4" />
              Recordings
            </Link>
            <button
              onClick={handleTeamsSync}
              disabled={isSyncingTeams}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${isSyncingTeams
                ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
                : 'bg-purple-600 text-white hover:bg-purple-700'
                }`}
            >
              <RefreshCw className={`w-4 h-4 ${isSyncingTeams ? 'animate-spin' : ''}`} />
              {isSyncingTeams ? 'Syncing...' : 'Sync Teams'}
            </button>
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${isSyncing
                ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync Fireflies'}
            </button>
          </div>
          {syncMessage && (
            <p className={`text-sm ${syncMessage.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
              {syncMessage}
            </p>
          )}
        </div>
      </div>

      <MeetingStatsCards meetings={meetings} totalMeetings={totalMeetings} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2">
          {/* Source Filter */}
          <div className="flex gap-2 mb-4">
            {(['all', 'teams', 'fireflies'] as const).map((src) => (
              <button
                key={src}
                onClick={() => setSourceFilter(src)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  sourceFilter === src
                    ? src === 'teams' ? 'bg-purple-600 text-white'
                    : src === 'fireflies' ? 'bg-orange-600 text-white'
                    : 'bg-blue-600 text-white'
                    : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
                }`}
              >
                {src === 'all' ? 'All Sources' : src === 'teams' ? 'Teams' : 'Fireflies'}
              </button>
            ))}
          </div>

          {/* Tabs */}
          <div className="ff-card mb-6">
            <div className="border-b">
              <nav className="flex space-x-8 px-6" aria-label="Tabs">
                {['upcoming', 'past', 'cancelled', 'all'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`py-4 px-1 border-b-2 font-medium text-sm capitalize ${activeTab === tab
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                      }`}
                  >
                    {tab}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          <MeetingsList
            meetings={filteredMeetings}
            onEditMeeting={handleEditMeeting}
            onDeleteMeeting={handleDeleteMeeting}
          />

          {/* Load More */}
          {page < totalPages && (
            <div className="flex justify-center mt-6">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <InlineSpinner size="sm" />
                ) : null}
                {isLoadingMore ? 'Loading...' : `Load More (${meetings.length} of ${totalMeetings})`}
              </button>
            </div>
          )}
        </div>

        <MeetingsSidebar
          upcomingMeetings={upcomingMeetings}
          meetings={meetings}
          onScheduleMeeting={handleScheduleMeeting}
        />
      </div>

      <MeetingDetailModal
        meeting={selectedMeeting}
        isOpen={showMeetingModal}
        onClose={() => setShowMeetingModal(false)}
      />

      <ScheduleMeetingModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSuccess={() => {
          // Optionally refresh meetings list after scheduling
        }}
      />
    </div>
  );
}