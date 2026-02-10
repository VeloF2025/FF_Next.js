export interface MeetingAttendee {
  name: string;
  email: string;
  displayName?: string;
}

export interface Meeting {
  id: string;
  title: string;
  type: 'team' | 'client' | 'board' | 'standup' | 'review';
  date: Date;
  time: string;
  duration: string;
  location: string;
  isVirtual: boolean;
  meetingLink?: string;
  organizer: string;
  participants: string[];
  rawParticipants: MeetingAttendee[];
  agenda: string[];
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  notes?: string;
  actionItems: ActionItem[];
  summary?: {
    keywords?: string[];
    action_items?: string[];
    outline?: string[];
    overview?: string;
  };
  firefliesId?: string;
}

export interface ActionItem {
  id: string;
  task: string;
  assignee: string;
  dueDate: Date;
  completed: boolean;
  meetingId: string;
}

export interface Participant {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
}

export interface UpcomingMeeting {
  id: string;
  title: string;
  time: string;
  type: string;
  participants: number;
}