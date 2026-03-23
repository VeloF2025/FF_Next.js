/**
 * Backfill script: re-run LLM enrichment for meetings with transcripts but stale/empty summaries
 *
 * For each meeting that has a transcript but summary = "No transcript available" or empty,
 * calls GPT-4o to generate summary, action items, decisions, keywords.
 *
 * Usage:
 *   node scripts/backfill-meeting-summaries.js [--dry-run] [--limit N] [--min-duration N]
 *
 * Requires: DATABASE_URL, OPENAI_API_KEY
 */

const { neon } = require('@neondatabase/serverless');
const OpenAI = require('openai');

const sql = neon(process.env.DATABASE_URL);
const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 50;
const minDurIdx = args.indexOf('--min-duration');
const MIN_DURATION = minDurIdx >= 0 ? parseInt(args[minDurIdx + 1], 10) : 2;

const CHUNK_SIZE = 80000; // chars per chunk (~20k tokens)

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
  "suggested_title": "Short descriptive meeting title (5-8 words)",
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
- If transcript is too short or unintelligible, provide best-effort summary`;

function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks;
}

async function processOneMeeting(meeting) {
  const { id, title, meeting_date, participants, organizer_name } = meeting;
  const prefix = `[${id}] ${(title || '').substring(0, 45).padEnd(45)}`;

  // Get transcript
  let transcript = meeting.raw_transcript;
  if (!transcript) {
    const fallback = await sql`
      SELECT content FROM meeting_transcripts WHERE meeting_id = ${id} ORDER BY created_at DESC LIMIT 1
    `;
    transcript = fallback[0]?.content;
  }

  if (!transcript || transcript.length < 50) {
    console.log(`${prefix} SKIP: transcript too short (${transcript?.length || 0} chars)`);
    return 'skip';
  }

  if (DRY_RUN) {
    console.log(`${prefix} DRY RUN: would process ${(transcript.length / 1024).toFixed(0)}KB transcript`);
    return 'dry_run';
  }

  const participantStr = Array.isArray(participants)
    ? participants.map(p => p.displayName || p.name || p.email || 'Unknown').join(', ')
    : '';

  const chunks = chunkText(transcript, CHUNK_SIZE);
  let combined = null;

  for (let ci = 0; ci < chunks.length; ci++) {
    const userMessage = [
      `Meeting: ${title || 'Untitled'}`,
      `Date: ${meeting_date || 'Unknown'}`,
      `Organizer: ${organizer_name || 'Unknown'}`,
      `Participants: ${participantStr || 'Unknown'}`,
      chunks.length > 1 ? `[Chunk ${ci + 1}/${chunks.length}]` : '',
      '',
      'TRANSCRIPT:',
      chunks[ci],
    ].filter(Boolean).join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const text = response.choices[0]?.message?.content || '';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.log(`${prefix} ERROR: invalid JSON from LLM (chunk ${ci})`);
      return 'error';
    }

    if (!combined) {
      combined = parsed;
    } else {
      combined.overview += ' ' + parsed.overview;
      combined.keywords = [...new Set([...combined.keywords, ...parsed.keywords])];
      combined.outline.push(...(parsed.outline || []));
      combined.decisions.push(...(parsed.decisions || []));
      combined.action_items.push(...(parsed.action_items || []));
    }
  }

  if (!combined) {
    console.log(`${prefix} ERROR: no summary produced`);
    return 'error';
  }

  // Write summary
  const suggestedTitle = combined.suggested_title?.trim();
  if (suggestedTitle) {
    await sql`
      UPDATE meetings
      SET summary = ${JSON.stringify(combined)},
          title = CASE WHEN title LIKE 'Teams Meeting -%' THEN ${suggestedTitle} ELSE title END,
          processing_status = 'completed',
          processed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
    `;
  } else {
    await sql`
      UPDATE meetings
      SET summary = ${JSON.stringify(combined)},
          processing_status = 'completed',
          processed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  // Write action items (idempotent — delete + re-insert)
  await sql`DELETE FROM meeting_action_items WHERE meeting_id = ${id}`;
  for (const item of (combined.action_items || [])) {
    await sql`
      INSERT INTO meeting_action_items (meeting_id, description, assignee_name, status, priority)
      VALUES (${id}, ${item.description}, ${item.assignee || 'Unassigned'}, 'pending', ${item.priority || 'medium'})
    `;
  }

  const aiCount = (combined.action_items || []).length;
  const decCount = (combined.decisions || []).length;
  console.log(`${prefix} OK: ${chunks.length} chunk(s), ${aiCount} actions, ${decCount} decisions`);
  return 'success';
}

async function main() {
  console.log(`\n=== Meeting Summary Backfill ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Limit: ${LIMIT} | Min duration: ${MIN_DURATION}min\n`);

  const candidates = await sql`
    SELECT m.id, m.title, m.meeting_date::text as meeting_date, m.duration,
           m.participants, m.organizer_name, m.raw_transcript,
           LENGTH(m.raw_transcript) as tx_size
    FROM meetings m
    WHERE (m.raw_transcript IS NOT NULL OR EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = m.id))
      AND (
        m.summary IS NULL
        OR m.summary->>'overview' = 'No transcript available for analysis.'
        OR m.summary->>'overview' IS NULL
        OR m.summary = '{}'::jsonb
      )
      AND m.duration >= ${MIN_DURATION}
    ORDER BY m.meeting_date DESC
    LIMIT ${LIMIT}
  `;

  console.log(`Found ${candidates.length} candidates\n`);

  const results = { success: 0, skip: 0, dry_run: 0, error: 0 };

  for (let i = 0; i < candidates.length; i++) {
    try {
      const status = await processOneMeeting(candidates[i]);
      results[status] = (results[status] || 0) + 1;
    } catch (err) {
      console.log(`[${candidates[i].id}] FATAL: ${err.message}`);
      results.error++;
    }

    // Progress update every 10
    if (i > 0 && i % 10 === 0) {
      console.log(`\n--- Progress: ${i}/${candidates.length} | success: ${results.success} | errors: ${results.error} ---\n`);
    }

    // Rate limit: 200ms between calls to avoid OpenAI throttling
    if (!DRY_RUN) await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== Results ===`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
