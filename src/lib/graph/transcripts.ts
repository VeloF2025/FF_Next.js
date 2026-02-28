// 🟢 WORKING: Microsoft Graph API transcript fetch and VTT parser
import { graphFetch } from './auth';
import { log } from '@/lib/logger';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Metadata record for a single transcript file attached to a meeting */
export interface TranscriptMeta {
  id: string;
  createdDateTime: string;
  contentCorrelationId?: string;
}

/** A single speaker utterance extracted from a VTT transcript */
export interface ParsedUtterance {
  /** Offset in milliseconds from the start of the recording */
  startMs: number;
  /** Speaker display name extracted from the VTT <v> tag */
  speaker: string;
  /** Spoken text with VTT markup stripped */
  text: string;
}

/**
 * Resolves the Graph onlineMeeting ID for a meeting identified by its join URL.
 * Returns null if the meeting cannot be found (e.g. organizer mismatch).
 *
 * @param organizerUserId - Graph user ID of the meeting organizer
 * @param joinUrl - The joinWebUrl from the callRecord
 */
export async function fetchOnlineMeetingId(
  organizerUserId: string,
  joinUrl: string
): Promise<string | null> {
  const encodedUrl = encodeURIComponent(joinUrl);
  const url = `${GRAPH_BASE}/users/${organizerUserId}/onlineMeetings?$filter=joinWebUrl eq '${encodedUrl}'`;

  const response = await graphFetch(url);

  if (!response.ok) {
    log.warn(
      'Failed to fetch online meeting',
      { organizerUserId, status: response.status },
      'GraphTranscripts'
    );
    return null;
  }

  const data = await response.json();
  return (data.value as Array<{ id: string }>)?.[0]?.id ?? null;
}

/**
 * Lists all transcript metadata records for the given online meeting.
 * Returns an empty array if no transcripts exist or the request fails.
 *
 * @param organizerUserId - Graph user ID of the meeting organizer
 * @param onlineMeetingId - Graph onlineMeeting ID (from fetchOnlineMeetingId)
 */
export async function listTranscripts(
  organizerUserId: string,
  onlineMeetingId: string
): Promise<TranscriptMeta[]> {
  const url = `${GRAPH_BASE}/users/${organizerUserId}/onlineMeetings/${onlineMeetingId}/transcripts`;
  const response = await graphFetch(url);

  if (!response.ok) {
    log.warn(
      'No transcripts found',
      { onlineMeetingId, status: response.status },
      'GraphTranscripts'
    );
    return [];
  }

  const data = await response.json();
  return (data.value as TranscriptMeta[]) || [];
}

/**
 * Downloads the raw VTT content for a specific transcript.
 *
 * @param organizerUserId - Graph user ID of the meeting organizer
 * @param meetingId - Graph onlineMeeting ID
 * @param transcriptId - ID of the transcript to download
 * @returns Raw VTT string
 */
export async function downloadTranscriptContent(
  organizerUserId: string,
  meetingId: string,
  transcriptId: string
): Promise<string> {
  const url = [
    `${GRAPH_BASE}/users/${organizerUserId}`,
    `/onlineMeetings/${meetingId}`,
    `/transcripts/${transcriptId}/content?$format=text/vtt`,
  ].join('');

  const response = await graphFetch(url, {
    headers: { Accept: 'text/vtt' },
  });

  if (!response.ok) {
    throw new Error(`Failed to download transcript: ${response.status}`);
  }

  return response.text();
}

/**
 * Parses a VTT string into structured utterances with speaker attribution.
 * Handles the Teams-flavoured VTT dialect that uses <v SpeakerName> inline tags.
 *
 * @param vtt - Raw WebVTT content
 * @returns Ordered array of utterances sorted by startMs
 */
export function parseVttSpeakers(vtt: string): ParsedUtterance[] {
  const utterances: ParsedUtterance[] = [];

  // VTT cue blocks are separated by blank lines
  const blocks = vtt.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');

    // Locate the cue timing line (contains "-->")
    const tsLine = lines.find(l => l.includes('-->'));
    if (!tsLine) continue;

    // Parse HH:MM:SS.mmm from the start timestamp
    const startMatch = tsLine.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
    if (!startMatch) continue;

    // startMatch[1..4] are guaranteed non-undefined because we checked `!startMatch` above
    const startMs =
      parseInt(startMatch[1]!, 10) * 3_600_000 +
      parseInt(startMatch[2]!, 10) * 60_000 +
      parseInt(startMatch[3]!, 10) * 1_000 +
      parseInt(startMatch[4]!, 10);

    // Text payload follows the timestamp line
    const tsIndex = lines.indexOf(tsLine);
    const textLines = lines.slice(tsIndex + 1);
    const fullText = textLines.join(' ').trim();

    // Teams VTT uses <v DisplayName>text</v> markup for speaker attribution
    const speakerMatch = fullText.match(/<v\s+([^>]+)>/);
    // speakerMatch[1] is non-undefined when speakerMatch is truthy (capture group 1 always present)
    const speaker = speakerMatch ? speakerMatch[1]! : 'Unknown';
    const text = fullText.replace(/<\/?v[^>]*>/g, '').trim();

    if (text) {
      utterances.push({ startMs, speaker, text });
    }
  }

  return utterances;
}
