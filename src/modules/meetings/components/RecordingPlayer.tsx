import { ExternalLink, Film } from 'lucide-react';

interface RecordingPlayerProps {
  meetingId: string;
  hasRecording: boolean;
  /** Fireflies transcript URL — contains the recording player */
  transcriptUrl?: string;
  source?: string;
}

export function RecordingPlayer({ meetingId, hasRecording, transcriptUrl, source }: RecordingPlayerProps) {
  // Fireflies: recording lives on their platform — link to their player
  if (source === 'fireflies' && transcriptUrl) {
    return (
      <div className="space-y-4">
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-6 text-center">
          <Film className="w-10 h-10 mx-auto mb-3 text-orange-400" />
          <p className="text-[var(--ff-text-primary)] font-medium mb-2">Recording available on Fireflies</p>
          <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
            Open the Fireflies player to listen to the recording with speaker attribution and timestamps.
          </p>
          <a
            href={transcriptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Open in Fireflies
          </a>
        </div>
      </div>
    );
  }

  // Teams: local recording file
  if (hasRecording) {
    return (
      <div className="space-y-2">
        <video
          controls
          className="w-full rounded-lg bg-black"
          preload="metadata"
        >
          <source src={`/api/meetings/${meetingId}/recording`} type="video/mp4" />
          Your browser does not support video playback.
        </video>
        <p className="text-xs text-[var(--ff-text-tertiary)]">
          Tip: Click the video to play/pause. Use the seek bar to jump to specific moments.
        </p>
      </div>
    );
  }

  return (
    <div className="text-center py-8">
      <Film className="w-10 h-10 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
      <p className="text-[var(--ff-text-secondary)]">No recording available for this meeting</p>
    </div>
  );
}
