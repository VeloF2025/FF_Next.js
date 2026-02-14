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

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/meetings');
      const data = await response.json();

      if (data.meetings) {
        const transformedMeetings: Meeting[] = data.meetings.map((m: Record<string, unknown>) => {
          const rawParticipants: MeetingAttendee[] = Array.isArray(m.participants)
            ? (m.participants as Array<Record<string, unknown>>).map(p => ({
                name: (p.name as string) || '',
                email: (p.email as string) || '',
                displayName: (p.displayName as string) || '',
              }))
            : [];

          return {
            id: m.id as string,
            title: m.title as string,
            type: 'team' as const,
            date: new Date(m.date as string),
            time: new Date(m.date as string).toLocaleTimeString(),
            duration: `${m.duration} min`,
            location: 'Virtual',
            isVirtual: true,
            meetingLink: m.transcript_url as string | undefined,
            organizer: 'Fireflies',
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
          };
        });

        setMeetings(transformedMeetings);
      } else {
        setMeetings([]);
      }

      setActionItems([]);
      setNotifications([]);
    } catch (error) {
      log.error('Failed to load communications data:', error);
      setMeetings([]);
      setActionItems([]);
      setNotifications([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      default: return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'pending': return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
      case 'overdue': return 'bg-red-100 text-red-800';
      case 'scheduled': return 'bg-purple-100 text-purple-800';
      case 'cancelled': return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
      default: return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
    }
  };

  // Calculate stats - show total meetings and completed count
  const stats: CommunicationsStats = {
    upcomingMeetings: meetings.length, // Total meetings (most are from Fireflies)
    pendingActions: actionItems.filter(a => a.status === 'pending').length,
    unreadNotifications: notifications.filter(n => !n.read).length,
    overdueItems: meetings.filter(m => m.status === 'completed').length // Completed meetings
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
    getPriorityColor,
    getStatusColor,
    refetch: loadData
  };
}