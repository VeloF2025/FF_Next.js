import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Plus, RefreshCw, Video, Calendar, Film } from 'lucide-react';
import Link from 'next/link';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { notificationService } from '@/services/core/NotificationService';
import type { Meeting, UpcomingMeeting } from './types/meeting.types';
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
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadMeetings();
  }, []);

  const loadMeetings = async () => {
    try {
      const response = await fetch('/api/meetings');
      const data = await response.json();

      if (data.meetings) {
        // Transform Neon data to Meeting format
        const transformedMeetings = data.meetings.map((m: any) => ({
          id: m.id,
          title: m.title,
          type: 'team' as const,
          date: new Date(m.date),
          time: new Date(m.date).toLocaleTimeString(),
          duration: `${m.duration} min`,
          location: 'Virtual',
          isVirtual: true,
          meetingLink: m.transcript_url,
          organizer: 'Fireflies',
          participants: m.participants ? m.participants.map((p: any) => p.name || p.email) : [],
          agenda: m.summary?.outline || m.summary?.keywords || [],
          status: 'completed' as const,
          notes: m.summary?.action_items || '',
          actionItems: [],
          // Store full summary for detail view
          summary: m.summary,
          firefliesId: m.fireflies_id
        }));

        setMeetings(transformedMeetings);
        setUpcomingMeetings([]);
      }
    } catch (error) {
      console.error('Failed to load meetings:', error);
      // Fallback to empty arrays
      setMeetings([]);
      setUpcomingMeetings([]);
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
        setSyncMessage(`✓ Synced ${data.synced} meetings from Fireflies`);
        // Reload meetings after sync
        await loadMeetings();
      } else {
        setSyncMessage(`✗ Sync failed: ${data.error}`);
      }
    } catch (error: any) {
      setSyncMessage(`✗ Sync failed: ${error.message}`);
    } finally {
      setIsSyncing(false);
      // Clear message after 5 seconds
      setTimeout(() => setSyncMessage(null), 5000);
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

      <MeetingStatsCards meetings={meetings} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2">
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