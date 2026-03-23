/**
 * Meeting Transcript Processor
 *
 * Orchestrates the full LLM-powered meeting analysis pipeline:
 *   1. Load raw transcript from `meetings.raw_transcript` (or `meeting_transcripts` fallback).
 *   2. Chunk the transcript to respect the model's context window.
 *   3. Call OpenAI GPT-4o for each chunk and merge the structured results.
 *   4. Persist the summary back to `meetings.summary` and upsert action items.
 *
 * // WORKING: single-chunk and multi-chunk paths; graceful no-transcript fallback
 */

import { getOpenAIClient } from './client';
import { chunkTranscript } from './chunker';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Priority levels for a meeting action item. */
export type ActionPriority = 'high' | 'medium' | 'low';

/** A single action item extracted from the meeting transcript. */
export interface ActionItem {
  description: string;
  assignee: string;
  due_hint: string;
  priority: ActionPriority;
}

/**
 * Structured summary produced by the LLM for a single meeting.
 * All fields map directly to the JSON schema requested in SYSTEM_PROMPT.
 */
export interface MeetingSummary {
  suggested_title: string;
  overview: string;
  keywords: string[];
  outline: string[];
  decisions: string[];
  action_items: ActionItem[];
}

// ---------------------------------------------------------------------------
// Internal DB row types
// ---------------------------------------------------------------------------

interface MeetingRow {
  id: number;
  title: string | null;
  meeting_date: string | null;
  participants: Array<{ displayName?: string; name?: string; email?: string }> | null;
  raw_transcript: string | null;
  organizer_name: string | null;
}

interface TranscriptRow {
  content: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a meeting analyst for Velocity Fibre, a fibre-optic network infrastructure company in South Africa.
Analyze the provided meeting transcript and output ONLY valid JSON with no markdown code fences.

IMPORTANT — Language handling:
- Meetings may be conducted in Afrikaans, English, or a mix of both.
- ALL output MUST be in English regardless of the transcript language.
- Translate Afrikaans content accurately to English, preserving technical terms and proper nouns.
- Fibre/telecom domain terms (e.g. PON, OLT, splice, trench, duct, drop) should use their standard English forms.
- Person names and company names must NOT be translated — keep them exactly as spoken.

Output schema:
{
  "suggested_title": "Short descriptive meeting title (5-8 words, e.g. 'Operations Targets Dashboard Review')",
  "overview": "2-4 sentence executive summary",
  "keywords": ["keyword1", "keyword2"],
  "outline": ["Topic 1: brief description", "Topic 2: brief description"],
  "decisions": ["Decision 1", "Decision 2"],
  "action_items": [
    {
      "description": "What needs to be done",
      "assignee": "Person name or 'Unassigned'",
      "due_hint": "Timeline mentioned or 'Not specified'",
      "priority": "high|medium|low"
    }
  ]
}

Guidelines:
- Extract concrete action items with specific owners when mentioned
- Note decisions that affect project timelines or budget
- Keywords should reflect fibre/telecom domain terms discussed
- If no transcript is available, return minimal JSON with overview "No transcript available for analysis"`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process a meeting with the LLM and persist the structured summary.
 *
 * @param meetingId - Primary key of the row in the `meetings` table.
 * @returns         The MeetingSummary written to the database.
 * @throws          When the meeting row does not exist or the LLM returns invalid JSON.
 */
export async function processWithLLM(meetingId: number): Promise<MeetingSummary> {
  const logger = 'LLMMeetingProcessor';

  // ------------------------------------------------------------------
  // 1. Load meeting row
  // ------------------------------------------------------------------
  const rows = (await sql`
    SELECT id, title, meeting_date, participants, raw_transcript, organizer_name
    FROM meetings
    WHERE id = ${meetingId}
  `) as MeetingRow[];
  const meeting = rows[0];

  if (!meeting) {
    throw new Error(`Meeting ${meetingId} not found`);
  }

  // ------------------------------------------------------------------
  // 2. Resolve transcript (primary column → fallback table)
  // ------------------------------------------------------------------
  let transcript: string | null = meeting.raw_transcript ?? null;

  if (!transcript) {
    const fallback = (await sql`
      SELECT content
      FROM meeting_transcripts
      WHERE meeting_id = ${meetingId}
      ORDER BY created_at DESC
      LIMIT 1
    `) as TranscriptRow[];
    transcript = fallback[0]?.content ?? null;
  }

  // ------------------------------------------------------------------
  // 3. No transcript → return minimal summary immediately
  // ------------------------------------------------------------------
  if (!transcript) {
    log.warn('No transcript available', { meetingId }, logger);
    const minimal: MeetingSummary = {
      suggested_title: '',
      overview: 'No transcript available for analysis.',
      keywords: [],
      outline: [],
      decisions: [],
      action_items: [],
    };
    await writeSummary(meetingId, minimal);
    return minimal;
  }

  // ------------------------------------------------------------------
  // 4. Build participant context string
  // ------------------------------------------------------------------
  const participants = Array.isArray(meeting.participants)
    ? meeting.participants
        .map((p) => p.displayName ?? p.name ?? p.email ?? 'Unknown')
        .join(', ')
    : '';

  // ------------------------------------------------------------------
  // 5. Chunk + call GPT-4o for each chunk
  // ------------------------------------------------------------------
  const chunks = chunkTranscript(transcript);
  log.info('Processing meeting', { meetingId, chunks: chunks.length, transcriptLength: transcript.length }, logger);

  const client = getOpenAIClient();
  let combinedSummary: MeetingSummary | null = null;

  for (const chunk of chunks) {
    const userMessage = [
      `Meeting: ${meeting.title ?? 'Untitled'}`,
      `Date: ${meeting.meeting_date ?? 'Unknown'}`,
      `Organizer: ${meeting.organizer_name ?? 'Unknown'}`,
      `Participants: ${participants || 'Unknown'}`,
      chunks.length > 1 ? `[Chunk ${chunk.index + 1}/${chunks.length}]` : '',
      '',
      'TRANSCRIPT:',
      chunk.text,
    ]
      .filter(Boolean)
      .join('\n');

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const responseText = response.choices[0]?.message?.content ?? '';

    let parsed: MeetingSummary;
    try {
      parsed = JSON.parse(responseText) as MeetingSummary;
    } catch {
      log.error(
        'Failed to parse LLM response',
        { meetingId, chunk: chunk.index, responsePreview: responseText.slice(0, 200) },
        logger,
      );
      throw new Error(`LLM returned invalid JSON for meeting ${meetingId} chunk ${chunk.index}`);
    }

    if (!combinedSummary) {
      combinedSummary = parsed;
    } else {
      // Merge multi-chunk results — deduplicate keywords, append the rest
      // Keep the first chunk's suggested_title (most likely to capture the meeting topic)
      combinedSummary.overview += ' ' + parsed.overview;
      combinedSummary.keywords = [...new Set([...combinedSummary.keywords, ...parsed.keywords])];
      combinedSummary.outline.push(...parsed.outline);
      combinedSummary.decisions.push(...parsed.decisions);
      combinedSummary.action_items.push(...parsed.action_items);
    }
  }

  if (!combinedSummary) {
    throw new Error(`No summary produced for meeting ${meetingId}`);
  }

  // ------------------------------------------------------------------
  // 6. Persist results
  // ------------------------------------------------------------------
  await writeSummary(meetingId, combinedSummary);
  await writeActionItems(meetingId, combinedSummary.action_items);

  log.info(
    'Meeting processed',
    { meetingId, actionItems: combinedSummary.action_items.length, decisions: combinedSummary.decisions.length },
    logger,
  );

  return combinedSummary;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Persist the merged summary JSON to the meetings row.
 * If the LLM provided a suggested_title and the current title is still generic
 * ("Teams Meeting - ..."), update the title too.
 */
async function writeSummary(meetingId: number, summary: MeetingSummary): Promise<void> {
  const suggestedTitle = summary.suggested_title?.trim();

  if (suggestedTitle) {
    // Only override generic auto-generated titles, not calendar subjects
    await sql`
      UPDATE meetings
      SET summary            = ${JSON.stringify(summary)},
          title              = CASE
                                 WHEN title LIKE 'Teams Meeting -%' THEN ${suggestedTitle}
                                 ELSE title
                               END,
          processing_status  = 'completed',
          processed_at       = NOW(),
          updated_at         = NOW()
      WHERE id = ${meetingId}
    `;
  } else {
    await sql`
      UPDATE meetings
      SET summary            = ${JSON.stringify(summary)},
          processing_status  = 'completed',
          processed_at       = NOW(),
          updated_at         = NOW()
      WHERE id = ${meetingId}
    `;
  }
}

/**
 * Replace action items of a given source for a meeting with the latest set.
 * Only deletes items matching the source type so visual items are preserved
 * when re-processing transcripts and vice versa.
 */
async function writeActionItems(
  meetingId: number,
  items: ActionItem[],
  source: string = 'transcript'
): Promise<void> {
  // Delete previous items of this source type only (preserves other sources)
  await sql`DELETE FROM meeting_action_items WHERE meeting_id = ${meetingId} AND (source = ${source} OR source IS NULL)`;

  if (items.length === 0) return;

  for (const item of items) {
    await sql`
      INSERT INTO meeting_action_items (meeting_id, description, assignee_name, status, priority, source)
      VALUES (${meetingId}, ${item.description}, ${item.assignee}, 'pending', ${item.priority}, ${source})
    `;
  }
}
