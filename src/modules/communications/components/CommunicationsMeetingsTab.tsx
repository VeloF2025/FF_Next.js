import { Video, Users, MoreVertical } from 'lucide-react';
import { Meeting, Status } from '@/types/communications.types';

interface CommunicationsMeetingsTabProps {
  meetings: Meeting[];
  getStatusColor: (status: Status) => string;
}

export function CommunicationsMeetingsTab({ meetings, getStatusColor }: CommunicationsMeetingsTabProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Meeting
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Date & Time
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Type
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Attendees
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {meetings.map((meeting) => (
            <tr key={meeting.id}>
              <td className="px-6 py-4">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {meeting.title}
                  </div>
                  <div className="text-sm text-gray-500">
                    {meeting.agenda.length} agenda items
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900">
                  {meeting.date.toISOString().split('T')[0]}
                </div>
                <div className="text-sm text-gray-500">
                  {meeting.time} ({meeting.duration})
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  {meeting.type === 'virtual' ? (
                    <Video className="w-4 h-4 mr-2 text-blue-500" />
                  ) : (
                    <Users className="w-4 h-4 mr-2 text-green-500" />
                  )}
                  <span className="text-sm text-gray-900">
                    {meeting.type}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="flex -space-x-2">
                  {meeting.attendees.slice(0, 3).map((attendee, i) => (
                    <div key={i} className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium text-gray-700 border-2 border-white">
                      {attendee.split(' ').map(n => n[0]).join('')}
                    </div>
                  ))}
                  {meeting.attendees.length > 3 && (
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600 border-2 border-white">
                      +{meeting.attendees.length - 3}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(meeting.status)}`}>
                  {meeting.status}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button className="text-gray-400 hover:text-gray-600">
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