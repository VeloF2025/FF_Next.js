#!/usr/bin/env node
/**
 * Batch LLM Reprocessing for Meetings
 *
 * Re-runs GPT-4o analysis on meetings that:
 *   - Have transcripts but no LLM summary (Fireflies backfill)
 *   - Have generic "Teams Meeting -" titles that need renaming
 *   - Were processed with an older prompt version
 *
 * Usage:
 *   npx tsx scripts/reprocess-meetings-llm.ts [--limit N] [--source fireflies|teams|all] [--force]
 *
 * Options:
 *   --limit N      Max meetings to process (default: 50)
 *   --source X     Filter by source (default: all)
 *   --force        Re-process even if already completed
 *   --dry-run      Show what would be processed without running LLM
 */

import { neon } from '@neondatabase/serverless';
import { processWithLLM } from '../src/lib/llm/meeting-processor';
import { log } from '../src/lib/logger';

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!OPENAI_API_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }

const sql = neon(DATABASE_URL);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || '50', 10) : 50;
const sourceIdx = args.indexOf('--source');
const sourceFilter = sourceIdx >= 0 ? args[sourceIdx + 1] || 'all' : 'all';

interface MeetingRow {
  id: number;
  title: string;
  source: string;
  has_transcript: boolean;
  has_summary: boolean;
  summary_has_title: boolean;
}

async function main() {
  console.log(`\nMeeting LLM Reprocessor ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`Source: ${sourceFilter} | Limit: ${limit} | Force: ${force}\n`);

  // Find meetings that need processing
  // Priority: 1) Has transcript but no summary, 2) Generic title needing rename
  const meetings = sourceFilter === 'all'
    ? await sql`
        SELECT id, title, source,
               raw_transcript IS NOT NULL as has_transcript,
               (summary IS NOT NULL AND summary != 'null'::jsonb) as has_summary,
               (summary->>'suggested_title' IS NOT NULL AND summary->>'suggested_title' != '') as summary_has_title
        FROM meetings
        WHERE raw_transcript IS NOT NULL
          AND (
            ${force}
            OR summary IS NULL
            OR summary = 'null'::jsonb
            OR (summary->>'suggested_title' IS NULL AND title LIKE 'Teams Meeting -%')
            OR (summary->>'overview' = 'No transcript available for analysis.')
          )
        ORDER BY meeting_date DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, title, source,
               raw_transcript IS NOT NULL as has_transcript,
               (summary IS NOT NULL AND summary != 'null'::jsonb) as has_summary,
               (summary->>'suggested_title' IS NOT NULL AND summary->>'suggested_title' != '') as summary_has_title
        FROM meetings
        WHERE raw_transcript IS NOT NULL
          AND source = ${sourceFilter}
          AND (
            ${force}
            OR summary IS NULL
            OR summary = 'null'::jsonb
            OR (summary->>'suggested_title' IS NULL AND title LIKE 'Teams Meeting -%')
            OR (summary->>'overview' = 'No transcript available for analysis.')
          )
        ORDER BY meeting_date DESC
        LIMIT ${limit}
      `;

  console.log(`Found ${meetings.length} meetings to process\n`);

  if (meetings.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (dryRun) {
    (meetings as MeetingRow[]).forEach((m, i) => {
      console.log(`  ${i + 1}. [${m.source}] id=${m.id} "${m.title}" (summary=${m.has_summary}, title_gen=${m.summary_has_title})`);
    });
    return;
  }

  let processed = 0;
  let failed = 0;
  let titlesUpdated = 0;

  for (let i = 0; i < meetings.length; i++) {
    const m = meetings[i] as MeetingRow;
    console.log(`[${i + 1}/${meetings.length}] ${m.source} id=${m.id} "${m.title}"`);

    try {
      const result = await processWithLLM(m.id);
      processed++;

      const newTitle = result.suggested_title?.trim();
      if (newTitle && m.title.startsWith('Teams Meeting -')) {
        titlesUpdated++;
        console.log(`  -> "${newTitle}"`);
      }
      console.log(`  ${result.action_items.length} action items, ${result.decisions.length} decisions`);
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${msg}`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results:`);
  console.log(`  Processed:      ${processed}`);
  console.log(`  Titles updated: ${titlesUpdated}`);
  console.log(`  Failed:         ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
