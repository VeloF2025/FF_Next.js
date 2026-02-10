/**
 * Fireflies.ai API Service
 * Fetches meeting transcripts and summaries
 */

const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql';

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
  meeting_attendees: Array<{
    name: string;
    email: string;
    displayName?: string;
  }>;
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
    // Insert or update in Neon using tagged template syntax
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
        ${JSON.stringify(transcript.meeting_attendees)},
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
        participants = ${JSON.stringify(transcript.meeting_attendees)},
        updated_at = NOW()
    `;
  }

  return transcripts.length;
}
