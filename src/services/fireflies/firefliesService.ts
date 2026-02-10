/**
 * Fireflies.ai API Service
 * Fetches meeting transcripts and summaries
 */

const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql';

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

export async function syncFirefliesToNeon(apiKey: string, sql: any) {
  const transcripts = await fetchFirefliesTranscripts(apiKey);

  for (const transcript of transcripts) {
    const merged = mergeParticipants(transcript);

    await sql`
      INSERT INTO meetings (
        fireflies_id,
        title,
        meeting_date,
        duration,
        transcript_url,
        summary,
        participants,
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
    `;
  }

  return transcripts.length;
}
