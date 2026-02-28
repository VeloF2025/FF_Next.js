import { useState, useEffect, useMemo } from 'react';
import { Search, MessageSquare, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

interface TranscriptUtterance {
  startMs: number;
  speaker: string;
  text: string;
}

interface TranscriptViewProps {
  meetingId: string;
}

const SPEAKER_COLORS = [
  'text-blue-400', 'text-green-400', 'text-purple-400',
  'text-yellow-400', 'text-pink-400', 'text-cyan-400',
  'text-orange-400', 'text-red-400',
];

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function TranscriptView({ meetingId }: TranscriptViewProps) {
  const [utterances, setUtterances] = useState<TranscriptUtterance[]>([]);
  const [rawText, setRawText] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadTranscript();
  }, [meetingId]);

  const loadTranscript = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/transcript`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error?.message || 'Transcript not available');
        return;
      }

      const payload = data.data || data;
      if (payload.structured && payload.structured.length > 0) {
        setUtterances(payload.structured);
      }
      setRawText(payload.transcript || '');
    } catch (err) {
      log.error('Failed to load transcript', { meetingId }, 'TranscriptView');
      setError('Failed to load transcript');
    } finally {
      setIsLoading(false);
    }
  };

  const speakerColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const speakers = [...new Set(utterances.map(u => u.speaker))];
    speakers.forEach((s, i) => map.set(s, SPEAKER_COLORS[i % SPEAKER_COLORS.length] || 'text-gray-400'));
    return map;
  }, [utterances]);

  const filteredUtterances = useMemo(() => {
    if (!searchQuery.trim()) return utterances;
    const q = searchQuery.toLowerCase();
    return utterances.filter(u =>
      u.text.toLowerCase().includes(q) || u.speaker.toLowerCase().includes(q)
    );
  }, [utterances, searchQuery]);

  const highlightText = (text: string): React.ReactNode => {
    if (!searchQuery.trim()) return text;
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{part}</mark> : part
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">Loading transcript...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <MessageSquare className="w-10 h-10 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
        <p className="text-[var(--ff-text-secondary)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
        <input
          type="text"
          placeholder="Search transcript..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
        />
      </div>

      <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-2">
        {filteredUtterances.length > 0 ? (
          filteredUtterances.map((u, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-xs text-[var(--ff-text-tertiary)] whitespace-nowrap pt-1 w-14 text-right flex-shrink-0">
                {formatTimestamp(u.startMs)}
              </span>
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${speakerColorMap.get(u.speaker) || 'text-gray-400'}`}>
                  {u.speaker}
                </span>
                <p className="text-sm text-[var(--ff-text-secondary)] mt-0.5">{highlightText(u.text)}</p>
              </div>
            </div>
          ))
        ) : rawText ? (
          <pre className="text-sm text-[var(--ff-text-secondary)] whitespace-pre-wrap font-mono">{rawText}</pre>
        ) : (
          <p className="text-center text-[var(--ff-text-tertiary)]">No transcript content</p>
        )}
      </div>
    </div>
  );
}
