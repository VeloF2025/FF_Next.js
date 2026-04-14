/**
 * Meeting Summary Panel - extracted from MeetingDetailModal
 * Displays meeting details, attendees, AI summary, decisions, keywords, outline
 * Includes editable user notes section
 */

import { useState, useEffect, useRef } from 'react';
import { Calendar, Clock, Video, MapPin, User, Users, Save } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import type { Meeting } from '../types/meeting.types';

interface MeetingSummaryPanelProps {
  meeting: Meeting;
}

export function MeetingSummaryPanel({ meeting }: MeetingSummaryPanelProps) {
  const [notes, setNotes] = useState(meeting.userNotes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const notesRef = useRef(meeting.userNotes || '');

  useEffect(() => {
    setNotes(meeting.userNotes || '');
    notesRef.current = meeting.userNotes || '';
  }, [meeting.id, meeting.userNotes]);

  const handleSaveNotes = async () => {
    if (notes === notesRef.current) return;
    setIsSaving(true);
    setSaveStatus('idle');
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) {
        notesRef.current = notes;
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      log.error('Failed to save meeting notes:', { error: err });
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* Meeting Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="font-medium text-[var(--ff-text-primary)] mb-3">Meeting Details</h3>
          <div className="space-y-2 text-sm text-[var(--ff-text-secondary)]">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <span>{meeting.date instanceof Date ? meeting.date.toISOString().split('T')[0] : String(meeting.date).split('T')[0]}</span>
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

      {/* User Notes (editable) */}
      <div className="mt-6 pt-6 border-t border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-[var(--ff-text-primary)]">Your Notes</h3>
          <div className="flex items-center gap-2">
            {saveStatus === 'saved' && (
              <span className="text-xs text-green-400">Saved</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-xs text-red-400">Failed to save</span>
            )}
            <button
              type="button"
              onClick={handleSaveNotes}
              disabled={isSaving || notes === notesRef.current}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? <InlineSpinner size="sm" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={handleSaveNotes}
          placeholder="Add your personal notes about this meeting..."
          className="w-full min-h-[100px] px-3 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] resize-y focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
        />
      </div>
    </>
  );
}
