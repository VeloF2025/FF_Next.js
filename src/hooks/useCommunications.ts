import { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';
import type { Meeting, MeetingAttendee } from '@/modules/meetings/types/meeting.types';
import {
  ActionItem,
  Notification,
  CommunicationsStats,
  CommunicationsData
} from '@/types/communications.types';

function getAttendeeDisplayName(p: MeetingAttendee): string {
  return p.displayName || p.name || p.email || 'Unknown';
}

export function useCommunications() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalMeetings, setTotalMeetings] = useState(0);
  const [meetingPage, setMeetingPage] = useState(1);
  const [meetingTotalPages, setMeetingTotalPages] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [serverStats, setServerStats] = useState<{
    total: number; teams: number; fireflies: number;
    withTranscripts: number; withRecordings: number;
  } | null>(null);

  const PAGE_SIZE = 50;

  const transformMeeting = (m: Record<string, unknown>): Meeting => {
    const rawParticipants: MeetingAttendee[] = Array.isArray(m.participants)
      ? (m.participants as Array<Record<string, unknown>>).map(p => ({
          name: (p.name as string) || '',
          email: (p.email as string) || '',
          displayName: (p.displayName as string) || '',
        }))
      : [];

    const source = (m.source as string) || 'fireflies';

    return {
      id: m.id as string,
      title: m.title as string,
      type: 'team' as const,
      date: new Date(m.date as string),
      time: new Date(m.date as string).toLocaleTimeString(),
      duration: `${m.duration} min`,
      location: 'Virtual',
      isVirtual: true,
      meetingLink: (m.transcript_url as string) || (m.join_url as string) || undefined,
      organizer: (m.organizer_name as string) || (source === 'teams' ? 'Teams' : 'Fireflies'),
      participants: rawParticipants.map(getAttendeeDisplayName),
      rawParticipants,
      agenda: (m.summary as Record<string, unknown>)?.outline as string[]
        || (m.summary as Record<string, unknown>)?.keywords as string[]
        || [],
      status: 'completed' as const,
      notes: (m.summary as Record<string, unknown>)?.action_items as string || '',
      actionItems: [],
      summary: m.summary as Meeting['summary'],
      firefliesId: m.fireflies_id as string,
      source: source as Meeting['source'],
      processingStatus: ((m.processing_status as string) || 'completed') as Meeting['processingStatus'],
      hasTranscript: Boolean(m.has_transcript),
      hasRecording: Boolean(m.has_recording),
      organizerName: m.organizer_name as string | undefined,
      organizerEmail: m.organizer_email as string | undefined,
      transcriptUrl: m.transcript_url as string | undefined,
    };
  };

  const loadData = useCallback(async (pageNum = 1, append = false) => {
    if (!append) setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pageNum), limit: String(PAGE_SIZE) });
      const response = await fetch(`/api/meetings?${params}`);
      const data = await response.json();

      if (data.meetings) {
        const transformed = data.meetings.map((m: Record<string, unknown>) => transformMeeting(m));

        if (append) {
          setMeetings(prev => [...prev, ...transformed]);
        } else {
          setMeetings(transformed);
        }
        setTotalMeetings(data.total ?? transformed.length);
        setMeetingTotalPages(data.totalPages ?? 1);
        if (data.stats) setServerStats(data.stats);
      } else {
        if (!append) setMeetings([]);
      }

      setActionItems([]);
      setNotifications([]);
    } catch (error) {
      log.error('Failed to load communications data:', { error: error });
      if (!append) {
        setMeetings([]);
        setActionItems([]);
        setNotifications([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMoreMeetings = useCallback(async () => {
    const nextPage = meetingPage + 1;
    setIsLoadingMore(true);
    setMeetingPage(nextPage);
    await loadData(nextPage, true);
    setIsLoadingMore(false);
  }, [meetingPage, loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Utility functions - accept string to handle dynamic values
  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-secondary text-foreground';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'pending': return 'bg-secondary text-foreground';
      case 'overdue': return 'bg-red-100 text-red-800';
      case 'scheduled': return 'bg-purple-100 text-purple-800';
      case 'cancelled': return 'bg-secondary text-foreground';
      default: return 'bg-secondary text-foreground';
    }
  };

  // Use server-provided stats for accurate counts (not limited by page size)
  const stats: CommunicationsStats = {
    totalMeetings: serverStats?.total ?? (totalMeetings || meetings.length),
    completedMeetings: meetings.filter(m => m.status === 'completed').length,
    upcomingMeetings: meetings.filter(m => m.status === 'scheduled').length,
    pendingActions: actionItems.filter(a => a.status === 'pending').length,
    teamsMeetings: serverStats?.teams ?? meetings.filter(m => m.source === 'teams').length,
    firefliesMeetings: serverStats?.fireflies ?? meetings.filter(m => m.source === 'fireflies').length,
    withTranscripts: serverStats?.withTranscripts ?? meetings.filter(m => m.hasTranscript).length,
    withRecordings: serverStats?.withRecordings ?? meetings.filter(m => m.hasRecording).length,
  };

  const data: CommunicationsData = {
    meetings,
    actionItems,
    notifications
  };

  return {
    data,
    stats,
    isLoading,
    isLoadingMore,
    hasMoreMeetings: meetingPage < meetingTotalPages,
    loadMoreMeetings,
    getPriorityColor,
    getStatusColor,
    refetch: loadData
  };
}