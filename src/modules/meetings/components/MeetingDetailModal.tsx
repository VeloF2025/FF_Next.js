/**
 * Meeting Detail Modal
 * 4 tabs: Summary, Action Items, Transcript, Recording
 * Includes export buttons + Generate Minutes in footer
 */

import { useState } from 'react';
import { X, FileText, MessageSquare, Film, CheckCircle, AlertCircle, Download, FileDown, Link2, Check, RefreshCw } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { toast } from 'react-hot-toast';
import type { Meeting } from '../types/meeting.types';
import { getSourceColor, getSourceLabel, getProcessingStatusLabel } from '../utils/meetingUtils';
import { generateMeetingMinutesPdf } from '../utils/generateMeetingMinutesPdf';
import { TranscriptView } from './TranscriptView';
import { RecordingPlayer } from './RecordingPlayer';
import { MeetingSummaryPanel } from './MeetingSummaryPanel';
import { MeetingActionItemsPanel } from './MeetingActionItemsPanel';
import { MeetingMinutesPreviewModal } from './MeetingMinutesPreviewModal';
import { log } from '@/lib/logger';

interface MeetingDetailModalProps {
  meeting: Meeting | null;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

type DetailTab = 'summary' | 'action_items' | 'transcript' | 'recording';

export function MeetingDetailModal({ meeting, isOpen, onClose, onRefresh }: MeetingDetailModalProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('summary');
  const [isGeneratingMinutes, setIsGeneratingMinutes] = useState(false);
  const [isResyncing, setIsResyncing] = useState(false);
  const [minutesBlob, setMinutesBlob] = useState<Blob | null>(null);
  const [showMinutesPreview, setShowMinutesPreview] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  if (!isOpen || !meeting) return null;

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/communications?tab=meetings&meeting=${meeting.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      toast.success('Meeting link copied');
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const tabs: { key: DetailTab; label: string; icon: typeof FileText; disabled?: boolean }[] = [
    { key: 'summary', label: 'Summary', icon: FileText },
    { key: 'action_items', label: 'Action Items', icon: CheckCircle },
    { key: 'transcript', label: 'Transcript', icon: MessageSquare, disabled: !meeting.hasTranscript },
    { key: 'recording', label: 'Recording', icon: Film, disabled: !meeting.hasRecording },
  ];

  const handleExport = (type: 'summary' | 'transcript' | 'action-items') => {
    window.open(`/api/meetings/${meeting.id}/export?type=${type}`, '_blank');
  };

  const handleGenerateMinutes = async () => {
    if (!meeting) return;
    setIsGeneratingMinutes(true);
    try {
      const blob = await generateMeetingMinutesPdf(meeting);
      setMinutesBlob(blob);
      setShowMinutesPreview(true);
    } catch (err) {
      log.error('Failed to generate meeting minutes PDF', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsGeneratingMinutes(false);
    }
  };

  const handleResync = async () => {
    if (!meeting) return;
    setIsResyncing(true);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/resync`, { method: 'POST' });
      if (res.ok || res.status === 202) {
        toast.success('Re-sync started — transcript and recording will be fetched from Teams');
        // Give the background job time to complete before refreshing
        setTimeout(() => {
          onRefresh?.();
        }, 8000);
      } else {
        const data = await res.json();
        toast.error(data.error?.message || 'Re-sync failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Re-sync failed: ${msg}`);
      log.error('Meeting re-sync failed', { meetingId: meeting.id, error: msg });
    } finally {
      setIsResyncing(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b border-[var(--ff-border-light)] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">{meeting.title}</h2>
              <span className={`px-2 py-1 text-xs rounded-full ${getSourceColor(meeting.source)}`}>
                {getSourceLabel(meeting.source)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopyLink}
                className="p-2 hover:bg-[var(--ff-bg-hover)] rounded text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
                title="Copy meeting link"
              >
                {linkCopied ? <Check className="w-5 h-5 text-green-400" /> : <Link2 className="w-5 h-5" />}
              </button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-[var(--ff-bg-hover)] rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
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
                <InlineSpinner size="sm" className="flex-shrink-0" />
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
            {activeTab === 'summary' && <MeetingSummaryPanel meeting={meeting} />}
            {activeTab === 'action_items' && <MeetingActionItemsPanel meeting={meeting} />}
            {activeTab === 'transcript' && (
              <TranscriptView meetingId={meeting.id} transcriptUrl={meeting.transcriptUrl} />
            )}
            {activeTab === 'recording' && (
              <RecordingPlayer meetingId={meeting.id} hasRecording={meeting.hasRecording} source={meeting.source} />
            )}
          </div>

          <div className="p-6 border-t border-[var(--ff-border-light)] flex gap-3 justify-between">
            <div className="flex gap-2">
              {meeting.summary && (
                <button
                  type="button"
                  onClick={() => handleExport('summary')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Summary
                </button>
              )}
              {meeting.hasTranscript && (
                <button
                  type="button"
                  onClick={() => handleExport('transcript')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Transcript
                </button>
              )}
              <button
                type="button"
                onClick={handleGenerateMinutes}
                disabled={isGeneratingMinutes}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--ff-primary)] hover:bg-[var(--ff-primary-hover)] rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isGeneratingMinutes ? (
                  <InlineSpinner size="sm" />
                ) : (
                  <FileDown className="w-3.5 h-3.5" />
                )}
                {isGeneratingMinutes ? 'Generating...' : 'Generate Minutes'}
              </button>
              {meeting.source === 'teams' && (
                <button
                  type="button"
                  onClick={handleResync}
                  disabled={isResyncing}
                  title="Re-fetch transcript and recording from Microsoft Teams"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isResyncing ? (
                    <InlineSpinner size="sm" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  {isResyncing ? 'Re-syncing...' : 'Re-sync from Teams'}
                </button>
              )}
            </div>
            <button
              className="ff-button ff-button-secondary"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Minutes Preview + Distribute Modal */}
      {minutesBlob && (
        <MeetingMinutesPreviewModal
          meeting={meeting}
          pdfBlob={minutesBlob}
          isOpen={showMinutesPreview}
          onClose={() => {
            setShowMinutesPreview(false);
            setMinutesBlob(null);
          }}
        />
      )}
    </>
  );
}
