// Cron endpoint — pull faithful af-en transcripts from Cortex.
//
// Microsoft Teams' English ASR mangles Afrikaans meeting audio into clean-looking
// gibberish. Cortex re-transcribes those meetings on its on-prem whisper service
// (large-v3) and exposes the result over its bridge. This cron pulls that
// transcript for Teams meetings still on the lossy native VTT, replaces
// raw_transcript with it (transcript_source='cortex-whisper'), and re-runs the
// LLM summariser so the summary/action-items reflect what was actually said.
//
// Auth: CRON_SECRET bearer token (same as reprocess-pending-meetings).
//   curl -X POST https://<host>/api/cron/pull-cortex-transcripts \
//        -H "Authorization: Bearer $CRON_SECRET"

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { neon } from '@/lib/db-neon';
import { apiResponse } from '@/lib/apiResponse';
import { processWithLLM } from '@/lib/llm/meeting-processor';

const LOGGER = 'PullCortexTranscripts';
const sql = neon(process.env.DATABASE_URL!);

const BRIDGE_URL = process.env.CORTEX_BRIDGE_URL ?? 'http://localhost:7403';
const API_KEY = process.env.CORTEX_API_KEY ?? '';
const BATCH_LIMIT = 20;
const FETCH_TIMEOUT_MS = 15_000;

interface Candidate {
  id: number;
  teams_call_record_id: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method!, ['POST']);
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET is not configured', {}, LOGGER);
    apiResponse.internalError(res, new Error('Server misconfiguration'));
    return;
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    log.warn('Unauthorized cron attempt', { ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress }, LOGGER);
    apiResponse.unauthorized(res);
    return;
  }
  if (!API_KEY) {
    log.error('CORTEX_API_KEY is not configured', {}, LOGGER);
    apiResponse.internalError(res, new Error('Cortex not configured'));
    return;
  }

  // Teams meetings that have a recording (so Cortex could have re-transcribed) and
  // are still on the lossy native transcript. Already-upgraded meetings are skipped.
  const candidates = await sql`
    SELECT id, teams_call_record_id
    FROM meetings
    WHERE source = 'teams'
      AND teams_call_record_id IS NOT NULL
      AND recording_path IS NOT NULL
      AND (transcript_source IS NULL OR transcript_source IN ('teams-vtt', 'teams'))
    ORDER BY meeting_date DESC
    LIMIT ${BATCH_LIMIT}
  ` as Candidate[];

  log.info('Pull-cortex-transcripts triggered', { count: candidates.length }, LOGGER);
  res.status(202).json({
    message: `Checking ${candidates.length} meetings for a Cortex transcript`,
    meetingIds: candidates.map((c) => c.id),
  });

  setImmediate(async () => {
    let upgraded = 0;
    let skipped = 0;
    let failed = 0;

    for (const m of candidates) {
      try {
        // Key goes in the Authorization header (NOT a query param) so it can't
        // leak into request/proxy logs.
        const url = `${BRIDGE_URL}/api/meetings/by-call-record/${encodeURIComponent(m.teams_call_record_id)}/transcript`;
        const resp = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        });

        // 404 = Cortex hasn't imported/transcribed this meeting (yet) — normal, retry next run.
        if (resp.status === 404) {
          skipped++;
          continue;
        }
        if (!resp.ok) {
          failed++;
          const body = await resp.text().catch(() => '');
          log.warn('Cortex transcript fetch failed', { meetingId: m.id, status: resp.status, body: body.slice(0, 200) }, LOGGER);
          continue;
        }

        const data = (await resp.json()) as { transcript_source?: string; transcript?: string };
        // Only upgrade when Cortex actually has a whisper re-transcription; if it
        // only has the native Teams transcript there is nothing to gain. A source
        // that is neither signals a contract change worth surfacing.
        if (data.transcript_source !== 'cortex-whisper' || !data.transcript?.trim()) {
          if (data.transcript_source && data.transcript_source !== 'teams_native') {
            log.warn('Unexpected Cortex transcript_source', { meetingId: m.id, transcript_source: data.transcript_source }, LOGGER);
          }
          skipped++;
          continue;
        }

        await sql`
          UPDATE meetings
          SET raw_transcript = ${data.transcript},
              transcript_source = 'cortex-whisper',
              updated_at = NOW()
          WHERE id = ${m.id}
        `;
        // Re-summarise from the faithful transcript (LLM-only; no Teams re-fetch).
        await processWithLLM(m.id);

        upgraded++;
        log.info('Upgraded meeting transcript from Cortex whisper', { meetingId: m.id }, LOGGER);
      } catch (error: unknown) {
        failed++;
        const msg = error instanceof Error ? error.message : String(error);
        log.error('Pull failed for meeting', { meetingId: m.id, error: msg }, LOGGER);
      }
    }

    log.info('Pull-cortex-transcripts complete', { upgraded, skipped, failed }, LOGGER);
  });
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default handler;
