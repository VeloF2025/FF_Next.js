'use client';

import { Calendar, Clock, Users, User, Video, ExternalLink } from 'lucide-react';
import type { Meeting } from '@/modules/meetings/types/meeting.types';
import { ActionItem } from '@/types/communications.types';

interface CommunicationsOverviewTabProps {
  meetings: Meeting[];
  actionItems: ActionItem[];
  getStatusColor: (status: string) => string;
  getPriorityColor: (priority: string) => string;
}

export function CommunicationsOverviewTab({
  meetings,
  actionItems,
  getStatusColor,
  getPriorityColor
}: CommunicationsOverviewTabProps) {
  // Show recent meetings (completed ones from Fireflies)
  const recentMeetings = meetings.slice(0, 5);
  const recentActionItems = actionItems.slice(0, 3);

  // Format date safely
  const formatDate = (date: Date | string): string => {
    try {
      const d = date instanceof Date ? date : new Date(date);
      return d.toLocaleDateString();
    } catch {
      return 'Unknown date';
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Recent Meetings */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Recent Meetings</h3>
        {recentMeetings.length === 0 ? (
          <div className="ff-card p-6 text-center">
            <Calendar className="w-8 h-8 mx-auto mb-2 text-[var(--ff-text-tertiary)]" />
            <p className="text-[var(--ff-text-secondary)]">No meetings yet. Sync from Fireflies to import.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentMeetings.map(meeting => (
              <div key={meeting.id} className="ff-card p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-[var(--ff-text-primary)] truncate">{meeting.title}</h4>
                    <div className="flex flex-wrap items-center gap-x-3 mt-2 text-sm text-[var(--ff-text-secondary)]">
                      <span className="flex items-center">
                        <Calendar className="w-4 h-4 mr-1" />
                        {formatDate(meeting.date)}
                      </span>
                      <span className="flex items-center">
                        <Clock className="w-4 h-4 mr-1" />
                        {meeting.duration}
                      </span>
                      <span className="flex items-center">
                        <Users className="w-4 h-4 mr-1" />
                        {meeting.participants.length}
                      </span>
                    </div>

                    {/* Keywords/Agenda preview */}
                    {meeting.agenda && meeting.agenda.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {meeting.agenda.slice(0, 3).map((item, idx) => (
                          <span key={idx} className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                            {item}
                          </span>
                        ))}
                        {meeting.agenda.length > 3 && (
                          <span className="text-xs text-[var(--ff-text-tertiary)]">
                            +{meeting.agenda.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2 ml-2">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(meeting.status)}`}>
                      {meeting.status}
                    </span>
                    {meeting.meetingLink && (
                      <a
                        href={meeting.meetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center text-xs text-blue-500 hover:text-blue-600"
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Transcript
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Action Items */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Recent Action Items</h3>
        {recentActionItems.length === 0 ? (
          <div className="ff-card p-6 text-center">
            <User className="w-8 h-8 mx-auto mb-2 text-[var(--ff-text-tertiary)]" />
            <p className="text-[var(--ff-text-secondary)]">No action items yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentActionItems.map(item => (
              <div key={item.id} className="ff-card p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-[var(--ff-text-primary)]">{item.description}</p>
                    <div className="flex items-center mt-2 text-sm text-[var(--ff-text-secondary)]">
                      <User className="w-4 h-4 mr-1" />
                      {item.assignee}
                      <Calendar className="w-4 h-4 ml-3 mr-1" />
                      {formatDate(item.dueDate)}
                    </div>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full ${getPriorityColor(item.priority)}`}>
                    {item.priority}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
