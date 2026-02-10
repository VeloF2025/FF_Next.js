import { X, Calendar, Clock, Video, MapPin, User, Users } from 'lucide-react';
import type { Meeting } from '../types/meeting.types';

interface MeetingDetailModalProps {
  meeting: Meeting | null;
  isOpen: boolean;
  onClose: () => void;
}

export function MeetingDetailModal({ meeting, isOpen, onClose }: MeetingDetailModalProps) {
  if (!isOpen || !meeting) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">{meeting.title}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-hover)] rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6">
          {/* Meeting Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Meeting Details</h3>
              <div className="space-y-2 text-sm text-[var(--ff-text-secondary)]">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                  <span>{meeting.date.toISOString().split('T')[0]}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                  <span>{meeting.time} ({meeting.duration})</span>
                </div>
                <div className="flex items-center gap-2">
                  {meeting.isVirtual ? (
                    <>
                      <Video className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <a href={meeting.meetingLink} className="text-blue-500 hover:underline">
                        Join Meeting
                      </a>
                    </>
                  ) : (
                    <>
                      <MapPin className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <span>{meeting.location}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                  <span>Organized by {meeting.organizer}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                Attendees ({meeting.rawParticipants?.length || meeting.participants.length})
              </h3>
              <div className="space-y-2">
                {(meeting.rawParticipants && meeting.rawParticipants.length > 0
                  ? meeting.rawParticipants
                  : meeting.participants.map(name => ({ name, email: '', displayName: '' }))
                ).map((attendee, index) => (
                  <div key={index} className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-tertiary)] rounded">
                    <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-medium text-blue-400">
                      {(attendee.displayName || attendee.name || attendee.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                        {attendee.displayName || attendee.name || attendee.email || 'Unknown'}
                      </p>
                      {attendee.email && (
                        <p className="text-xs text-[var(--ff-text-tertiary)] truncate">{attendee.email}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Agenda */}
          <div className="mb-6">
            <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Agenda</h3>
            <ol className="space-y-2">
              {meeting.agenda.map((item, index) => (
                <li key={index} className="flex gap-2 text-sm text-[var(--ff-text-secondary)]">
                  <span className="font-medium text-[var(--ff-text-primary)]">{index + 1}.</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Action Items */}
          {meeting.actionItems.length > 0 && (
            <div>
              <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Action Items</h3>
              <div className="space-y-2">
                {meeting.actionItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 bg-[var(--ff-bg-tertiary)] rounded">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={item.completed} readOnly />
                      <div>
                        <p className="text-sm font-medium text-[var(--ff-text-primary)]">{item.task}</p>
                        <p className="text-xs text-[var(--ff-text-secondary)]">
                          Assigned to {item.assignee} • Due {item.dueDate.toISOString().split('T')[0]}
                        </p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      item.completed ? 'bg-green-500/20 text-green-400' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
                    }`}>
                      {item.completed ? 'completed' : 'pending'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fireflies Summary */}
          {(meeting as any).summary && (
            <div className="mt-6 space-y-6">
              {/* Overview */}
              {(meeting as any).summary.overview && (
                <div>
                  <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Meeting Summary</h3>
                  <p className="text-sm text-[var(--ff-text-secondary)] whitespace-pre-wrap">{(meeting as any).summary.overview}</p>
                </div>
              )}

              {/* Keywords */}
              {(meeting as any).summary.keywords && Array.isArray((meeting as any).summary.keywords) && (meeting as any).summary.keywords.length > 0 && (
                <div>
                  <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Keywords</h3>
                  <div className="flex flex-wrap gap-2">
                    {(meeting as any).summary.keywords.map((keyword: string, index: number) => (
                      <span key={index} className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Outline */}
              {(meeting as any).summary.outline && Array.isArray((meeting as any).summary.outline) && (meeting as any).summary.outline.length > 0 && (
                <div>
                  <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Detailed Outline</h3>
                  <ol className="space-y-2">
                    {(meeting as any).summary.outline.map((item: string, index: number) => (
                      <li key={index} className="flex gap-2 text-sm text-[var(--ff-text-secondary)]">
                        <span className="font-medium text-[var(--ff-text-tertiary)]">{index + 1}.</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Action Items from Fireflies */}
              {(meeting as any).summary.action_items && (
                <div>
                  <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">AI-Detected Action Items</h3>
                  <div className="p-4 bg-amber-500/10 rounded-lg border-l-4 border-amber-400">
                    <div className="text-sm text-[var(--ff-text-primary)] leading-relaxed space-y-2">
                      {(() => {
                        const rawText = Array.isArray((meeting as any).summary.action_items)
                          ? (meeting as any).summary.action_items.join(' ')
                          : String((meeting as any).summary.action_items);

                        // Format the text to be more readable:
                        // 1. Add line breaks before person names (**Name**)
                        // 2. Add bullet points for each action item
                        const formatted = rawText
                          .replace(/\*\*([^*]+)\*\*/g, '\n\n**$1**\n')  // Line breaks around names
                          .replace(/(\([0-9:]+\))\s+([A-Z])/g, '$1\n• $2')  // Bullet before new actions
                          .trim();

                        return formatted.split('\n').map((line, idx) => {
                          const trimmed = line.trim();
                          if (!trimmed) return null;

                          // Bold person names
                          if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
                            return (
                              <div key={idx} className="font-semibold text-amber-900 mt-3 first:mt-0">
                                {trimmed.replace(/\*\*/g, '')}
                              </div>
                            );
                          }

                          return <div key={idx}>{trimmed}</div>;
                        });
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Transcript Link */}
              {meeting.meetingLink && (
                <div className="p-4 bg-[var(--ff-bg-tertiary)] rounded border border-[var(--ff-border-light)]">
                  <a
                    href={meeting.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-2"
                  >
                    <Video className="w-4 h-4" />
                    View Full Transcript on Fireflies →
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Fallback Notes */}
          {!((meeting as any).summary) && meeting.notes && (
            <div className="mt-6">
              <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Meeting Notes</h3>
              <p className="text-sm text-[var(--ff-text-secondary)]">{meeting.notes}</p>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-[var(--ff-border-light)] flex gap-3 justify-end">
          <button 
            className="ff-button ff-button-secondary"
            onClick={onClose}
          >
            Close
          </button>
          <button className="ff-button ff-button-primary">
            Edit Meeting
          </button>
        </div>
      </div>
    </div>
  );
}