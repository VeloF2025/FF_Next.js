import { useState } from 'react';
import { X, Calendar, Clock, Video, MapPin, User, Users, MessageSquare, Film, FileText, Loader2, AlertCircle } from 'lucide-react';
import type { Meeting } from '../types/meeting.types';
import { getSourceColor, getSourceLabel, getProcessingStatusLabel } from '../utils/meetingUtils';
import { TranscriptView } from './TranscriptView';
import { RecordingPlayer } from './RecordingPlayer';

interface MeetingDetailModalProps {
  meeting: Meeting | null;
  isOpen: boolean;
  onClose: () => void;
}

type DetailTab = 'summary' | 'transcript' | 'recording';

export function MeetingDetailModal({ meeting, isOpen, onClose }: MeetingDetailModalProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('summary');

  if (!isOpen || !meeting) return null;

  const tabs: { key: DetailTab; label: string; icon: typeof FileText; disabled?: boolean }[] = [
    { key: 'summary', label: 'Summary', icon: FileText },
    { key: 'transcript', label: 'Transcript', icon: MessageSquare, disabled: !meeting.hasTranscript },
    { key: 'recording', label: 'Recording', icon: Film, disabled: !meeting.hasRecording },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">{meeting.title}</h2>
            <span className={`px-2 py-1 text-xs rounded-full ${getSourceColor(meeting.source)}`}>
              {getSourceLabel(meeting.source)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-hover)] rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Processing Status Banner */}
        {meeting.processingStatus && meeting.processingStatus !== 'completed' && (
          <div className={`mx-6 mt-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
            meeting.processingStatus === 'failed'
              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
              : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
          }`}>
            {meeting.processingStatus === 'failed' ? (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            )}
            {getProcessingStatusLabel(meeting.processingStatus)}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-[var(--ff-border-light)] px-6">
          <nav className="flex gap-6">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => !tab.disabled && setActiveTab(tab.key)}
                disabled={tab.disabled}
                className={`flex items-center gap-2 py-3 border-b-2 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-400'
                    : tab.disabled
                    ? 'border-transparent text-[var(--ff-text-tertiary)] cursor-not-allowed'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'summary' && (
            <>
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
                          <a href={meeting.meetingLink} className="text-blue-400 hover:text-blue-300 hover:underline">
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
                  <div className="space-y-2 max-h-48 overflow-y-auto">
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

              {/* Summary Content */}
              {meeting.summary && (
                <div className="space-y-6">
                  {meeting.summary.overview && (
                    <div>
                      <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Meeting Summary</h3>
                      {meeting.summary.overview.toLowerCase().includes('no transcript available') ? (
                        <p className="text-sm text-[var(--ff-text-tertiary)] italic">
                          No AI summary — transcription was not enabled for this meeting.
                        </p>
                      ) : (
                        <p className="text-sm text-[var(--ff-text-secondary)] whitespace-pre-wrap">{meeting.summary.overview}</p>
                      )}
                    </div>
                  )}

                  {meeting.summary.decisions && Array.isArray(meeting.summary.decisions) && meeting.summary.decisions.length > 0 && (
                    <div>
                      <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Decisions</h3>
                      <ul className="space-y-2">
                        {meeting.summary.decisions.map((decision: string, index: number) => (
                          <li key={index} className="flex gap-2 text-sm text-[var(--ff-text-secondary)]">
                            <span className="text-green-400 flex-shrink-0">-</span>
                            <span>{decision}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {meeting.summary.keywords && Array.isArray(meeting.summary.keywords) && meeting.summary.keywords.length > 0 && (
                    <div>
                      <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Keywords</h3>
                      <div className="flex flex-wrap gap-2">
                        {meeting.summary.keywords.map((keyword: string, index: number) => (
                          <span key={index} className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {meeting.summary.outline && Array.isArray(meeting.summary.outline) && meeting.summary.outline.length > 0 && (
                    <div>
                      <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Detailed Outline</h3>
                      <ol className="space-y-2">
                        {meeting.summary.outline.map((item: string, index: number) => (
                          <li key={index} className="flex gap-2 text-sm text-[var(--ff-text-secondary)]">
                            <span className="font-medium text-[var(--ff-text-tertiary)]">{index + 1}.</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {meeting.summary.action_items && (Array.isArray(meeting.summary.action_items) ? meeting.summary.action_items.length > 0 : String(meeting.summary.action_items).trim().length > 0) && (
                    <div>
                      <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">AI-Detected Action Items</h3>
                      <div className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg border-l-4 border-blue-500">
                        <div className="text-sm text-[var(--ff-text-secondary)] leading-relaxed space-y-2">
                          {(() => {
                            const rawText = Array.isArray(meeting.summary.action_items)
                              ? meeting.summary.action_items.join(' ')
                              : String(meeting.summary.action_items);

                            const formatted = rawText
                              .replace(/\*\*([^*]+)\*\*/g, '\n\n**$1**\n')
                              .replace(/(\([0-9:]+\))\s+([A-Z])/g, '$1\n- $2')
                              .trim();

                            return formatted.split('\n').map((line, idx) => {
                              const trimmed = line.trim();
                              if (!trimmed) return null;

                              if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
                                return (
                                  <div key={idx} className="font-semibold text-blue-400 mt-3 first:mt-0">
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

                  {meeting.source === 'fireflies' && meeting.meetingLink && (
                    <div className="p-4 bg-[var(--ff-bg-tertiary)] rounded border border-[var(--ff-border-light)]">
                      <a
                        href={meeting.meetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-2"
                      >
                        <Video className="w-4 h-4" />
                        View Full Transcript on Fireflies
                      </a>
                    </div>
                  )}
                </div>
              )}

              {!meeting.summary && meeting.notes && (
                <div className="mt-6">
                  <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Meeting Notes</h3>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{meeting.notes}</p>
                </div>
              )}
            </>
          )}

          {activeTab === 'transcript' && (
            <TranscriptView meetingId={meeting.id} />
          )}

          {activeTab === 'recording' && (
            <RecordingPlayer meetingId={meeting.id} hasRecording={meeting.hasRecording} />
          )}
        </div>

        <div className="p-6 border-t border-[var(--ff-border-light)] flex gap-3 justify-end">
          <button
            className="ff-button ff-button-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
