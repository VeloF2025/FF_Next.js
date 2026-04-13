import { Clock, User } from 'lucide-react';
import type { Meeting, UpcomingMeeting } from '../types/meeting.types';
import { getMeetingTypeColor } from '../utils/meetingUtils';

interface MeetingsSidebarProps {
  upcomingMeetings: UpcomingMeeting[];
  meetings: Meeting[];
  onScheduleMeeting: () => void;
}

export function MeetingsSidebar({ upcomingMeetings, meetings }: MeetingsSidebarProps) {
  const recentActionItems = meetings.flatMap(m => m.actionItems).slice(0, 3);

  // Don't render if no data
  if (upcomingMeetings.length === 0 && recentActionItems.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Today's Schedule - only show if there are upcoming meetings */}
      {upcomingMeetings.length > 0 && (
        <div className="ff-card">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-500" />
              Today&apos;s Schedule
            </h3>
            <div className="space-y-3">
              {upcomingMeetings.map((meeting) => (
                <div key={meeting.id} className="flex items-center justify-between p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                  <div>
                    <p className="font-medium text-sm text-[var(--ff-text-primary)]">{meeting.title}</p>
                    <p className="text-xs text-[var(--ff-text-secondary)]">{meeting.time} • {meeting.participants} participants</p>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full ${getMeetingTypeColor(meeting.type)}`}>
                    {meeting.type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent Action Items - only show if there are action items */}
      {recentActionItems.length > 0 && (
        <div className="ff-card">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">Recent Action Items</h3>
            <div className="space-y-3">
              {recentActionItems.map((item) => (
                <div key={item.id} className="border-l-2 border-blue-500 pl-3">
                  <p className="text-sm font-medium text-[var(--ff-text-primary)]">{item.task}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <User className="w-3 h-3 text-[var(--ff-text-tertiary)]" />
                    <span className="text-xs text-[var(--ff-text-secondary)]">{item.assignee}</span>
                    <span className="text-xs text-[var(--ff-text-tertiary)]">•</span>
                    <span className="text-xs text-[var(--ff-text-secondary)]">Due {item.dueDate.toISOString().split('T')[0]}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}