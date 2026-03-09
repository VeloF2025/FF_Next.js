import { useState, useEffect } from 'react';
import { Film, Loader2, Volume2 } from 'lucide-react';
import { log } from '@/lib/logger';

interface RecordingPlayerProps {
  meetingId: string;
  hasRecording: boolean;
}

interface ExternalMedia {
  type: 'external';
  videoUrl: string | null;
  audioUrl: string | null;
}

export function RecordingPlayer({ meetingId, hasRecording }: RecordingPlayerProps) {
  const [externalMedia, setExternalMedia] = useState<ExternalMedia | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!hasRecording) return;

    // Probe the recording endpoint to check if it's external (Fireflies CDN)
    setIsLoading(true);
    fetch(`/api/meetings/${meetingId}/recording`)
      .then(async (res) => {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (data.type === 'external') {
            setExternalMedia(data as ExternalMedia);
          }
        }
        // If content-type is video/mp4, it's a local stream — use default <video> src
      })
      .catch((err) => {
        log.error('Failed to probe recording', { meetingId, error: String(err) }, 'RecordingPlayer');
      })
      .finally(() => {
        setIsLoading(false);
        setChecked(true);
      });
  }, [meetingId, hasRecording]);

  if (!hasRecording) {
    return (
      <div className="text-center py-8">
        <Film className="w-10 h-10 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
        <p className="text-[var(--ff-text-secondary)]">No recording available for this meeting</p>
      </div>
    );
  }

  if (isLoading || !checked) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
        <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">Loading recording...</span>
      </div>
    );
  }

  // External media from Fireflies CDN
  if (externalMedia) {
    return (
      <div className="space-y-3">
        {externalMedia.videoUrl && (
          <div>
            <video
              controls
              className="w-full rounded-lg bg-black"
              preload="metadata"
            >
              <source src={externalMedia.videoUrl} type="video/mp4" />
              Your browser does not support video playback.
            </video>
          </div>
        )}
        {!externalMedia.videoUrl && externalMedia.audioUrl && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Volume2 className="w-8 h-8 text-blue-400" />
            <audio controls className="w-full" preload="metadata">
              <source src={externalMedia.audioUrl} type="audio/mpeg" />
              Your browser does not support audio playback.
            </audio>
          </div>
        )}
        <p className="text-xs text-[var(--ff-text-tertiary)]">
          Tip: Click to play/pause. Use the seek bar to jump to specific moments.
        </p>
      </div>
    );
  }

  // Local file stream (Teams recordings)
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
