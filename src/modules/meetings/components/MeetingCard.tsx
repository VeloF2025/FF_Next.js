import {
  Calendar, Clock, MapPin, Video, Users,
  CheckCircle, Edit, Trash2, ExternalLink, FileText
} from 'lucide-react';
import { cn } from '@/src/utils/cn';
import type { Meeting } from '../types/meeting.types';

interface MeetingCardProps {
  meeting: Meeting;
  onEdit: (meeting: Meeting) => void;
  onDelete: (meetingId: string) => void;
  onJoin: (meeting: Meeting) => void;
}

export function MeetingCard({ meeting, onEdit, onDelete, onJoin }: MeetingCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'text-blue-400 bg-blue-500/20';
      case 'in_progress': return 'text-green-400 bg-green-500/20';
      case 'completed': return 'text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)]';
      case 'cancelled': return 'text-red-400 bg-red-500/20';
      default: return 'text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)]';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'team': return <Users className="w-4 h-4" />;
      case 'client': return <Users className="w-4 h-4" />;
      case 'board': return <Users className="w-4 h-4" />;
      case 'standup': return <Users className="w-4 h-4" />;
      case 'review': return <CheckCircle className="w-4 h-4" />;
      default: return <Users className="w-4 h-4" />;
    }
  };

  const isToday = new Date().toDateString() === meeting.date.toDateString();
  const canJoin = meeting.status === 'scheduled' && isToday;
  const isInProgress = meeting.status === 'in_progress';

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-2">
          {getTypeIcon(meeting.type)}
          <span className={cn(
            "text-xs font-medium px-2 py-1 rounded-full capitalize",
            getStatusColor(meeting.status)
          )}>
            {meeting.status.replace('_', ' ')}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => onEdit(meeting)}
            className="p-1 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(meeting.id)}
            className="p-1 text-[var(--ff-text-tertiary)] hover:text-red-600"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <h3 className="font-medium text-[var(--ff-text-primary)] mb-2">{meeting.title}</h3>

      <div className="space-y-2 text-sm text-[var(--ff-text-secondary)] mb-3">
        <div className="flex items-center">
          <Calendar className="w-4 h-4 mr-2" />
          <span>{meeting.date.toISOString().split('T')[0]}</span>
        </div>
        
        <div className="flex items-center">
          <Clock className="w-4 h-4 mr-2" />
          <span>{meeting.time} ({meeting.duration})</span>
        </div>
        
        <div className="flex items-center">
          {meeting.isVirtual ? (
            <>
              <Video className="w-4 h-4 mr-2" />
              <span>Virtual Meeting</span>
            </>
          ) : (
            <>
              <MapPin className="w-4 h-4 mr-2" />
              <span>{meeting.location}</span>
            </>
          )}
        </div>
        
        <div className="flex items-center">
          <Users className="w-4 h-4 mr-2 flex-shrink-0" />
          <span>
            {meeting.participants.length} attendee{meeting.participants.length !== 1 ? 's' : ''}
            {meeting.participants.length > 0 && (
              <span className="text-[var(--ff-text-tertiary)]">
                {' '}&middot; {meeting.participants.slice(0, 3).join(', ')}
                {meeting.participants.length > 3 && ` +${meeting.participants.length - 3}`}
              </span>
            )}
          </span>
        </div>
      </div>

      {meeting.agenda.length > 0 && (
        <div className="mb-3">
          <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-1">Keywords:</h4>
          <div className="flex flex-wrap gap-1">
            {meeting.agenda.slice(0, 4).map((item, index) => (
              <span key={index} className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">
                {item}
              </span>
            ))}
            {meeting.agenda.length > 4 && (
              <span className="text-xs text-[var(--ff-text-secondary)] px-2 py-1">
                +{meeting.agenda.length - 4} more
              </span>
            )}
          </div>
        </div>
      )}

      {meeting.notes && (
        <div className="mb-3">
          <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-1 flex items-center">
            <FileText className="w-3 h-3 mr-1" />
            Action Items:
          </h4>
          <p className="text-xs text-[var(--ff-text-secondary)] line-clamp-2">{meeting.notes.split('\n')[0]}</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-[var(--ff-border-light)]">
        <div className="text-xs text-[var(--ff-text-secondary)]">
          Organized by {meeting.organizer}
        </div>

        <div className="flex items-center gap-2">
          {meeting.meetingLink && (
            <a
              href={meeting.meetingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center px-3 py-1 rounded-md text-sm font-medium bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]"
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              View Transcript
            </a>
          )}

          {(canJoin || isInProgress) && meeting.isVirtual && (
            <button
              onClick={() => onJoin(meeting)}
              className={cn(
                "flex items-center px-3 py-1 rounded-md text-sm font-medium",
                isInProgress
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              )}
            >
              <Video className="w-4 h-4 mr-1" />
              {isInProgress ? 'Rejoin' : 'Join'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}