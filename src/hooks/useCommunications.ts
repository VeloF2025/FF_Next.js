import { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';
import type { Meeting } from '@/modules/meetings/types/meeting.types';
import {
  ActionItem,
  Notification,
  CommunicationsStats,
  CommunicationsData
} from '@/types/communications.types';

export function useCommunications() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch real meeting data from the meetings API
      const response = await fetch('/api/meetings');
      const data = await response.json();

      if (data.meetings) {
        // Transform Neon data to Meeting format (same as MeetingsDashboard)
        const transformedMeetings: Meeting[] = data.meetings.map((m: Record<string, unknown>) => ({
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
          participants: m.participants
            ? (m.participants as Array<{ name?: string; email?: string }>).map(p => p.name || p.email || 'Unknown')
            : [],
          agenda: (m.summary as Record<string, unknown>)?.outline as string[]
            || (m.summary as Record<string, unknown>)?.keywords as string[]
            || [],
          status: 'completed' as const,
          notes: (m.summary as Record<string, unknown>)?.action_items as string || '',
          actionItems: [],
          // Store full summary for detail view
          summary: m.summary,
          firefliesId: m.fireflies_id
        }));

        setMeetings(transformedMeetings);
      } else {
        setMeetings([]);
      }

      // Action items and notifications remain empty until integrated
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
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'pending': return 'bg-gray-100 text-gray-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      case 'scheduled': return 'bg-purple-100 text-purple-800';
      case 'cancelled': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
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