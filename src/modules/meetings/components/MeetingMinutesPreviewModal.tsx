/**
 * Meeting Minutes Preview Modal
 * Shows generated PDF in an iframe preview with options to:
 *   - Download the PDF
 *   - Select participants and distribute via email
 */

import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Download,
  Send,
  CheckSquare,
  Square,
  CheckCircle,
  AlertCircle,
  Mail,
  Users,
} from 'lucide-react';
import type { Meeting, MeetingAttendee } from '../types/meeting.types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

interface MeetingMinutesPreviewModalProps {
  meeting: Meeting;
  pdfBlob: Blob;
  isOpen: boolean;
  onClose: () => void;
}

type DistributeStatus = 'idle' | 'sending' | 'success' | 'partial' | 'error';

interface DistributeResult {
  sent: number;
  failed: number;
  total: number;
  results: { email: string; status: string; error?: string }[];
}

export function MeetingMinutesPreviewModal({
  meeting,
  pdfBlob,
  isOpen,
  onClose,
}: MeetingMinutesPreviewModalProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [distributeStatus, setDistributeStatus] = useState<DistributeStatus>('idle');
  const [distributeResult, setDistributeResult] = useState<DistributeResult | null>(null);
  const [showDistributePanel, setShowDistributePanel] = useState(false);

  // Build participant list with emails
  const participants: MeetingAttendee[] = useMemo(() => {
    if (meeting.rawParticipants?.length) {
      return meeting.rawParticipants.filter(p => p.email);
    }
    return [];
  }, [meeting.rawParticipants]);

  // Create blob URL for iframe preview
  useEffect(() => {
    if (!isOpen || !pdfBlob) return;
    const url = URL.createObjectURL(pdfBlob);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [isOpen, pdfBlob]);

  // Pre-select all participants with emails
  useEffect(() => {
    if (participants.length > 0) {
      setSelectedEmails(new Set(participants.map(p => p.email)));
    }
  }, [participants]);

  if (!isOpen) return null;

  const safeName = meeting.title.replace(/[^a-zA-Z0-9 -]/g, '').replace(/\s+/g, '_');
  const dateStr = meeting.date
    ? new Date(meeting.date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }).replace(/\s+/g, '-')
    : 'Unknown';
  const fileName = `Minutes_${safeName}_${dateStr}.pdf`;

  const handleDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const toggleEmail = (email: string) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedEmails.size === participants.length) {
      setSelectedEmails(new Set());
    } else {
      setSelectedEmails(new Set(participants.map(p => p.email)));
    }
  };

  const handleDistribute = async () => {
    if (selectedEmails.size === 0) return;
    setDistributeStatus('sending');
    setDistributeResult(null);

    try {
      // Convert blob to base64
      const buffer = await pdfBlob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i] as number);
      }
      const pdfBase64 = btoa(binary);

      const recipients = participants
        .filter(p => selectedEmails.has(p.email))
        .map(p => ({ email: p.email, name: p.displayName || p.name }));

      const meetingDate = meeting.date
        ? new Date(meeting.date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })
        : 'Unknown date';

      const response = await fetch('/api/meetings/distribute-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          meetingDate,
          recipients,
          pdfBase64,
          fileName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Distribution failed');
      }

      const result = data.data as DistributeResult;
      setDistributeResult(result);

      if (result.failed === 0) {
        setDistributeStatus('success');
      } else if (result.sent > 0) {
        setDistributeStatus('partial');
      } else {
        setDistributeStatus('error');
      }
    } catch (err) {
      log.error('Meeting minutes distribution failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      setDistributeStatus('error');
      setDistributeResult(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-[var(--ff-bg-primary)] rounded-xl shadow-2xl max-w-6xl w-full max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Meeting Minutes Preview</h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">{meeting.title}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => setShowDistributePanel(!showDistributePanel)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
              Distribute
              {participants.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-blue-500 rounded-full">
                  {participants.length}
                </span>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            </button>
          </div>
        </div>

        {/* Body: PDF preview + optional distribute panel */}
        <div className="flex flex-1 min-h-0">
          {/* PDF Preview */}
          <div className="flex-1 p-4">
            {pdfUrl ? (
              <iframe
                src={`${pdfUrl}#toolbar=1&navpanes=0`}
                title="Meeting Minutes PDF Preview"
                className="w-full h-full rounded-lg border border-[var(--ff-border-light)]"
                style={{ minHeight: '600px' }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-[var(--ff-text-tertiary)]">
                <InlineSpinner size="md" className="mr-2" />
                Loading preview...
              </div>
            )}
          </div>

          {/* Distribute Panel (slide-in) */}
          {showDistributePanel && (
            <div className="w-80 border-l border-[var(--ff-border-light)] flex flex-col bg-[var(--ff-bg-secondary)]">
              <div className="p-4 border-b border-[var(--ff-border-light)]">
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="w-4 h-4 text-blue-500" />
                  <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">
                    Distribute to Participants
                  </h3>
                </div>
                <p className="text-xs text-[var(--ff-text-secondary)]">
                  Select recipients to email the minutes PDF.
                </p>
              </div>

              {/* Participant list */}
              <div className="flex-1 overflow-y-auto p-3">
                {participants.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-8 h-8 mx-auto text-[var(--ff-text-tertiary)] mb-2" />
                    <p className="text-sm text-[var(--ff-text-secondary)]">
                      No participants with email addresses found.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Select all toggle */}
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded transition-colors mb-1"
                    >
                      {selectedEmails.size === participants.length ? (
                        <CheckSquare className="w-3.5 h-3.5 text-blue-500" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                      {selectedEmails.size === participants.length ? 'Deselect All' : 'Select All'}
                      <span className="ml-auto text-[var(--ff-text-tertiary)]">
                        {selectedEmails.size}/{participants.length}
                      </span>
                    </button>

                    <div className="space-y-0.5">
                      {participants.map((p) => (
                        <button
                          key={p.email}
                          type="button"
                          onClick={() => toggleEmail(p.email)}
                          className="flex items-start gap-2 w-full px-2 py-2 rounded hover:bg-[var(--ff-bg-hover)] transition-colors text-left"
                        >
                          {selectedEmails.has(p.email) ? (
                            <CheckSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-[var(--ff-text-tertiary)] mt-0.5 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                              {p.displayName || p.name}
                            </p>
                            <p className="text-xs text-[var(--ff-text-secondary)] truncate">
                              {p.email}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Distribution status + send button */}
              <div className="p-4 border-t border-[var(--ff-border-light)]">
                {distributeStatus === 'success' && (
                  <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <p className="text-xs text-green-400">
                      Sent to {distributeResult?.sent} participant{distributeResult?.sent !== 1 ? 's' : ''}.
                    </p>
                  </div>
                )}
                {distributeStatus === 'partial' && (
                  <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                    <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                    <p className="text-xs text-yellow-400">
                      Sent {distributeResult?.sent}, failed {distributeResult?.failed}.
                    </p>
                  </div>
                )}
                {distributeStatus === 'error' && (
                  <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-400">
                      Distribution failed. Please try again.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleDistribute}
                  disabled={selectedEmails.size === 0 || distributeStatus === 'sending'}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {distributeStatus === 'sending' ? (
                    <>
                      <InlineSpinner size="sm" />
                      Sending to {selectedEmails.size} recipient{selectedEmails.size !== 1 ? 's' : ''}...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send to {selectedEmails.size} Participant{selectedEmails.size !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
