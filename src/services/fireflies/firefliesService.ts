/**
 * Fireflies.ai API Service
 * Fetches meeting transcripts, sentences, and media URLs
 */

import { log } from '@/lib/logger';

const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql';
const LOGGER = 'FirefliesService';

interface FirefliesSpeaker {
  id: number;
  name: string;
}

interface FirefliesAttendee {
  name: string | null;
  email: string | null;
  displayName: string | null;
}

interface FirefliesSentence {
  text: string;
  speaker_name: string;
  start_time: number;
  end_time: number;
}

interface FirefliesTranscript {
  id: string;
  title: string;
  date: string;
  duration: number;
  transcript_url: string;
  audio_url: string | null;
  video_url: string | null;
  summary: {
    keywords: string[];
    action_items: string[];
    outline: string[];
  };
  speakers: FirefliesSpeaker[];
  participants: string[];
  meeting_attendees: FirefliesAttendee[];
  sentences: FirefliesSentence[] | null;
}

export interface MergedParticipant {
  name: string;
  email: string;
  displayName: string;
}

/**
 * Merge speakers, meeting_attendees, and participants into a single deduplicated list.
 * Priority: speakers (have names from voice recognition) > meeting_attendees > participants (emails only)
 */
function mergeParticipants(transcript: FirefliesTranscript): MergedParticipant[] {
  const seen = new Set<string>();
  const result: MergedParticipant[] = [];

  // 1. Add unique speakers (deduplicated by name)
  if (transcript.speakers?.length) {
    for (const speaker of transcript.speakers) {
      const name = speaker.name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ name, email: '', displayName: name });
    }
  }

  // 2. Add meeting_attendees not already covered by speakers
  if (transcript.meeting_attendees?.length) {
    for (const attendee of transcript.meeting_attendees) {
      const email = attendee.email?.trim() || '';
      const name = attendee.name?.trim() || '';
      const displayName = attendee.displayName?.trim() || '';
      const key = (name || email || displayName).toLowerCase();
      if (!key || seen.has(key)) continue;
      // Also check if email matches a known key
      if (email && seen.has(email.toLowerCase())) continue;
      seen.add(key);
      if (email) seen.add(email.toLowerCase());
      result.push({ name, email, displayName });
    }
  }

  // 3. Add participant emails not already covered
  if (transcript.participants?.length) {
    for (const email of transcript.participants) {
      const trimmed = email?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ name: '', email: trimmed, displayName: '' });
    }
  }

  return result;
}

/**
 * Build raw_transcript text from Fireflies sentences.
 * Format: "[Speaker Name] (MM:SS): text" per sentence, one per line.
 */
function buildTranscriptText(sentences: FirefliesSentence[]): string {
  return sentences.map(s => {
    const totalSec = Math.floor((s.start_time || 0) / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const ts = `${min}:${String(sec).padStart(2, '0')}`;
    return `[${s.speaker_name || 'Unknown'}] (${ts}): ${s.text}`;
  }).join('\n');
}

/**
 * Fetch all transcripts from Fireflies with pagination (API default limit is 50).
 */
export async function fetchFirefliesTranscripts(apiKey: string): Promise<FirefliesTranscript[]> {
  const PAGE_SIZE = 50;
  const allTranscripts: FirefliesTranscript[] = [];
  let skip = 0;

  while (true) {
    const query = `
      query {
        transcripts(limit: ${PAGE_SIZE}, skip: ${skip}) {
          id
          title
          date
          duration
          transcript_url
          audio_url
          video_url
          summary {
            keywords
            action_items
            outline
          }
          speakers {
            id
            name
          }
          participants
          meeting_attendees {
            name
            email
            displayName
          }
          sentences {
            text
            speaker_name
            start_time
            end_time
          }
        }
      }
    `;

    const response = await fetch(FIREFLIES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Fireflies API error: ${response.statusText}`);
    }

    const data = await response.json();
    const batch = data.data.transcripts as FirefliesTranscript[];
    allTranscripts.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  log.info(`Fetched ${allTranscripts.length} transcripts from Fireflies API`, { pages: Math.ceil(allTranscripts.length / PAGE_SIZE) }, LOGGER);
  return allTranscripts;
}

export async function syncFirefliesToNeon(apiKey: string, sql: any) {
  const transcripts = await fetchFirefliesTranscripts(apiKey);

  let synced = 0;
  for (const transcript of transcripts) {
    const merged = mergeParticipants(transcript);
    const rawTranscript = transcript.sentences?.length
      ? buildTranscriptText(transcript.sentences)
      : null;

    await sql`
      INSERT INTO meetings (
        fireflies_id,
        title,
        meeting_date,
        duration,
        transcript_url,
        summary,
        participants,
        raw_transcript,
        audio_url,
        video_url,
        source,
        created_at,
        updated_at
      ) VALUES (
        ${transcript.id},
        ${transcript.title},
        TO_TIMESTAMP(${transcript.date} / 1000.0),
        ${Math.floor(transcript.duration || 0)},
        ${transcript.transcript_url},
        ${JSON.stringify(transcript.summary)},
        ${JSON.stringify(merged)},
        ${rawTranscript},
        ${transcript.audio_url || null},
        ${transcript.video_url || null},
        'fireflies',
        NOW(),
        NOW()
      )
      ON CONFLICT (fireflies_id)
      DO UPDATE SET
        title = ${transcript.title},
        meeting_date = TO_TIMESTAMP(${transcript.date} / 1000.0),
        duration = ${Math.floor(transcript.duration || 0)},
        transcript_url = ${transcript.transcript_url},
        summary = ${JSON.stringify(transcript.summary)},
        participants = ${JSON.stringify(merged)},
        raw_transcript = COALESCE(${rawTranscript}, meetings.raw_transcript),
        audio_url = COALESCE(${transcript.audio_url || null}, meetings.audio_url),
        video_url = COALESCE(${transcript.video_url || null}, meetings.video_url),
        updated_at = NOW()
    `;
    synced++;
  }

  log.info(`Synced ${synced} meetings from Fireflies`, { total: synced }, LOGGER);
  return synced;
}
