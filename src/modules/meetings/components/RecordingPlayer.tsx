import { Film } from 'lucide-react';

interface RecordingPlayerProps {
  meetingId: string;
  hasRecording: boolean;
  source?: string;
}

export function RecordingPlayer({ meetingId, hasRecording, source }: RecordingPlayerProps) {
  if (!hasRecording) {
    return (
      <div className="text-center py-8">
        <Film className="w-10 h-10 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
        <p className="text-[var(--ff-text-secondary)]">No recording available for this meeting</p>
      </div>
    );
  }

  // Fireflies recordings are MP3 audio; Teams recordings are MP4 video
  const isAudio = source === 'fireflies';

  if (isAudio) {
    return (
      <div className="space-y-2">
        <audio
          controls
          className="w-full"
          preload="metadata"
        >
          <source src={`/api/meetings/${meetingId}/recording`} type="audio/mpeg" />
          Your browser does not support audio playback.
        </audio>
        <p className="text-xs text-[var(--ff-text-tertiary)]">
          Tip: Use the seek bar to jump to specific moments in the recording.
        </p>
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
