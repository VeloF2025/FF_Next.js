/**
 * Fireflies.ai API Service
 * Fetches meeting transcripts and summaries, downloads recordings
 */

import * as fs from 'fs';
import * as path from 'path';

const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql';
const RECORDINGS_BASE = process.env.MEETING_RECORDINGS_PATH || '/home/velo/meeting-recordings';

interface FirefliesSpeaker {
  id: number;
  name: string;
}

interface FirefliesAttendee {
  name: string | null;
  email: string | null;
  displayName: string | null;
}

interface FirefliesTranscript {
  id: string;
  title: string;
  date: string;
  duration: number;
  transcript_url: string;
  audio_url: string | null;
  summary: {
    keywords: string[];
    action_items: string[];
    outline: string[];
  };
  speakers: FirefliesSpeaker[];
  participants: string[];
  meeting_attendees: FirefliesAttendee[];
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

export async function fetchFirefliesTranscripts(apiKey: string) {
  const query = `
    query {
      transcripts {
        id
        title
        date
        duration
        transcript_url
        audio_url
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
  return data.data.transcripts as FirefliesTranscript[];
}

async function downloadRecording(url: string, destPath: string): Promise<number> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

export async function syncFirefliesToNeon(apiKey: string, sql: any) {
  const transcripts = await fetchFirefliesTranscripts(apiKey);

  let newRecordings = 0;
  for (const transcript of transcripts) {
    const merged = mergeParticipants(transcript);

    // Upsert meeting with source = 'fireflies'
    const rows = await sql`
      INSERT INTO meetings (
        fireflies_id,
        source,
        title,
        meeting_date,
        duration,
        transcript_url,
        summary,
        participants,
        processing_status,
        created_at,
        updated_at
      ) VALUES (
        ${transcript.id},
        'fireflies',
        ${transcript.title},
        TO_TIMESTAMP(${transcript.date} / 1000.0),
        ${Math.floor(transcript.duration || 0)},
        ${transcript.transcript_url},
        ${JSON.stringify(transcript.summary)},
        ${JSON.stringify(merged)},
        'completed',
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
        updated_at = NOW()
      RETURNING id, recording_path, meeting_date
    `;

    // Download recording if not already on disk
    const row = rows[0];
    if (row && !row.recording_path && transcript.audio_url) {
      try {
        const date = new Date(row.meeting_date as string);
        const yyyy = date.getFullYear().toString();
        const mm = (date.getMonth() + 1).toString().padStart(2, '0');
        const filePath = path.join(RECORDINGS_BASE, yyyy, mm, `${row.id}.mp3`);

        if (!fs.existsSync(filePath)) {
          const sizeBytes = await downloadRecording(transcript.audio_url, filePath);
          await sql`
            UPDATE meetings
            SET recording_path = ${filePath}, recording_size_bytes = ${sizeBytes}, updated_at = NOW()
            WHERE id = ${row.id}
          `;
          newRecordings++;
        }
      } catch {
        // Non-fatal — recording download failure shouldn't block sync
      }
    }
  }

  return transcripts.length;
}
