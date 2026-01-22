import { Calendar, Clock, Users, User } from 'lucide-react';
import { Meeting, ActionItem, Status, Priority } from '@/types/communications.types';

interface CommunicationsOverviewTabProps {
  meetings: Meeting[];
  actionItems: ActionItem[];
  getStatusColor: (status: Status) => string;
  getPriorityColor: (priority: Priority) => string;
}

export function CommunicationsOverviewTab({ 
  meetings, 
  actionItems, 
  getStatusColor, 
  getPriorityColor 
}: CommunicationsOverviewTabProps) {
  const upcomingMeetings = meetings.filter(m => m.status === 'scheduled').slice(0, 3);
  const recentActionItems = actionItems.slice(0, 3);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Recent Meetings */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Upcoming Meetings</h3>
        <div className="space-y-3">
          {upcomingMeetings.map(meeting => (
            <div key={meeting.id} className="ff-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium">{meeting.title}</h4>
                  <div className="flex items-center mt-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4 mr-1" />
                    {meeting.date.toISOString().split('T')[0]}
                    <Clock className="w-4 h-4 ml-3 mr-1" />
                    {meeting.time}
                    <Users className="w-4 h-4 ml-3 mr-1" />
                    {meeting.attendees.length}
                  </div>
                </div>
                <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(meeting.status)}`}>
                  {meeting.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Action Items */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Recent Action Items</h3>
        <div className="space-y-3">
          {recentActionItems.map(item => (
            <div key={item.id} className="ff-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{item.description}</p>
                  <div className="flex items-center mt-2 text-sm text-gray-600">
                    <User className="w-4 h-4 mr-1" />
                    {item.assignee}
                    <Calendar className="w-4 h-4 ml-3 mr-1" />
                    {item.dueDate.toISOString().split('T')[0]}
                  </div>
                </div>
                <span className={`px-2 py-1 text-xs rounded-full ${getPriorityColor(item.priority)}`}>
                  {item.priority}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}