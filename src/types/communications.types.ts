/**
 * Communications Module Type Definitions
 * All types for meetings, action items, notifications
 */

// Re-export Meeting types from meetings module to avoid duplication
export type { Meeting, ActionItem as MeetingActionItem } from '@/modules/meetings/types/meeting.types';
import type { Meeting } from '@/modules/meetings/types/meeting.types';

// Communications-specific ActionItem (different from meeting ActionItem)
export interface ActionItem {
  id: string;
  description: string;
  assignee: string;
  dueDate: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  priority: 'low' | 'medium' | 'high' | 'critical';
  meetingId?: string;
}

export interface Notification {
  id: string;
  type: 'meeting' | 'action' | 'deadline' | 'update' | 'alert';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  priority: 'low' | 'medium' | 'high';
}

export interface CommunicationsStats {
  upcomingMeetings: number;
  pendingActions: number;
  unreadNotifications: number;
  overdueItems: number;
}

export interface CommunicationsData {
  meetings: Meeting[];
  actionItems: ActionItem[];
  notifications: Notification[];
}

export type CommunicationsTab = 0 | 1 | 2 | 3;

export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type Status = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'pending' | 'overdue';