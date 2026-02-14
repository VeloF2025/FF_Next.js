import { User, MoreVertical } from 'lucide-react';
import { ActionItem, Meeting, Status, Priority } from '@/types/communications.types';

interface CommunicationsActionTabProps {
  actionItems: ActionItem[];
  meetings: Meeting[];
  getStatusColor: (status: Status) => string;
  getPriorityColor: (priority: Priority) => string;
}

export function CommunicationsActionTab({ 
  actionItems, 
  meetings, 
  getStatusColor, 
  getPriorityColor 
}: CommunicationsActionTabProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-background">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
              Action Item
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
              Assignee
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
              Due Date
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
              Priority
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-card divide-y divide-gray-200">
          {actionItems.map((item) => (
            <tr key={item.id}>
              <td className="px-6 py-4">
                <div className="text-sm font-medium text-foreground">
                  {item.description}
                </div>
                {item.meetingId && (
                  <div className="text-sm text-muted-foreground">
                    From: {meetings.find(m => m.id === item.meetingId)?.title}
                  </div>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <User className="w-4 h-4 mr-2 text-gray-400" />
                  <span className="text-sm text-foreground">{item.assignee}</span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-foreground">
                  {item.dueDate.toISOString().split('T')[0]}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getPriorityColor(item.priority)}`}>
                  {item.priority}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(item.status)}`}>
                  {item.status.replace('_', ' ')}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button className="text-gray-400 hover:text-muted-foreground">
                  <MoreVertical className="w-5 h-5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}