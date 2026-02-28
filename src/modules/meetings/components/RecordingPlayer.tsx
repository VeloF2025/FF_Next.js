import { Film } from 'lucide-react';

interface RecordingPlayerProps {
  meetingId: string;
  hasRecording: boolean;
}

export function RecordingPlayer({ meetingId, hasRecording }: RecordingPlayerProps) {
  if (!hasRecording) {
    return (
      <div className="text-center py-8">
        <Film className="w-10 h-10 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
        <p className="text-[var(--ff-text-secondary)]">No recording available for this meeting</p>
      </div>
    );
  }

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
