/**
 * PRD-062 Phase 3 — Backfill ai_summary rows for tickets that pre-date the
 * Phase 1 hook in createTicket().
 *
 * Selects maintenance_tickets that:
 *   - have a non-null dr_number,
 *   - were created within the last N days (default 90),
 *   - have no maintenance_activities row with activity_type='ai_summary'.
 *
 * For each ticket, calls the same drHistoryService.summarizeAndAttachDrHistory
 * the live createTicket hook uses. Errors per ticket are logged and skipped;
 * the script never throws and is safely re-runnable (the unique partial index
 * on (ticket_id) WHERE activity_type='ai_summary' from migration 333 makes
 * concurrent inserts safe).
 *
 * Usage:
 *   DATABASE_URL=... FF_AI_TICKET_SUMMARY=1 \
 *   VLM_API_URL=http://100.96.203.105:8100 \
 *   npx tsx scripts/backfill-ai-ticket-summaries.ts \
 *     [--max-age-days 90] [--limit 100] [--concurrency 3] \
 *     [--batch-pause-ms 500] [--dry-run] [--ticket-id <uuid>]
 *
 * Resumability: tickets that already have an ai_summary are excluded by the
 * SELECT, so re-running picks up exactly where the previous run stopped.
 */

import { Pool } from 'pg';

interface Args {
  maxAgeDays: number;
  limit: number | null;
  concurrency: number;
  batchPauseMs: number;
  dryRun: boolean;
  ticketId: string | null;
}

function parseArgs(argv: string[]): Args {
  const present = (flag: string): boolean => argv.indexOf(flag) !== -1;
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      console.error(`Flag ${flag} requires a value`);
      process.exit(1);
    }
    return v;
  };
  const positiveInt = (flag: string, raw: string | null, def: number): number => {
    if (raw === null) return def;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      console.error(`Flag ${flag} must be a positive integer (got "${raw}")`);
      process.exit(1);
    }
    return n;
  };
  const nonNegativeInt = (flag: string, raw: string | null, def: number): number => {
    if (raw === null) return def;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      console.error(`Flag ${flag} must be a non-negative integer (got "${raw}")`);
      process.exit(1);
    }
    return n;
  };

  const concurrencyRaw = positiveInt('--concurrency', get('--concurrency'), 3);
  const concurrency = Math.min(10, concurrencyRaw);
  if (concurrency !== concurrencyRaw) {
    console.warn(`[backfill] --concurrency ${concurrencyRaw} clamped to ${concurrency}`);
  }

  return {
    maxAgeDays: positiveInt('--max-age-days', get('--max-age-days'), 90),
    limit: present('--limit') ? positiveInt('--limit', get('--limit'), 0) : null,
    concurrency,
    batchPauseMs: nonNegativeInt('--batch-pause-ms', get('--batch-pause-ms'), 500),
    dryRun: argv.includes('--dry-run'),
    ticketId: get('--ticket-id'),
  };
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (process.env.FF_AI_TICKET_SUMMARY !== '1') {
  console.error('FF_AI_TICKET_SUMMARY=1 required (matches the live service guard)');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});

interface TicketRow {
  id: string;
  ticket_uid: string;
  dr_number: string;
  ont_serial: string | null;
}

async function selectCandidates(): Promise<TicketRow[]> {
  if (args.ticketId) {
    const r = await pool.query<TicketRow>(
      `SELECT id, ticket_uid, dr_number, ont_serial
         FROM maintenance_tickets
        WHERE id = $1
          AND dr_number IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM maintenance_activities a
             WHERE a.ticket_id = maintenance_tickets.id
               AND a.activity_type = 'ai_summary'
          )`,
      [args.ticketId],
    );
    return r.rows;
  }

  const r = await pool.query<TicketRow>(
    `SELECT t.id, t.ticket_uid, t.dr_number, t.ont_serial
       FROM maintenance_tickets t
      WHERE t.dr_number IS NOT NULL
        AND t.created_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND NOT EXISTS (
          SELECT 1 FROM maintenance_activities a
           WHERE a.ticket_id = t.id
             AND a.activity_type = 'ai_summary'
        )
      ORDER BY t.created_at DESC
      LIMIT $2`,
    [args.maxAgeDays, args.limit ?? null],
  );
  return r.rows;
}

interface Stats {
  attempted: number;
  written: number;
  skipped_no_history: number;
  failed: number;
  total_latency_ms: number;
}

async function processOne(
  summarize: (ticketId: string, dr: string, ont: string | null) => Promise<void>,
  hasAiSummary: (ticketId: string) => Promise<boolean>,
  ticket: TicketRow,
  stats: Stats,
): Promise<void> {
  stats.attempted++;
  const t0 = Date.now();
  try {
    await summarize(ticket.id, ticket.dr_number, ticket.ont_serial);
    const ok = await hasAiSummary(ticket.id);
    const elapsed = Date.now() - t0;
    stats.total_latency_ms += elapsed;
    if (ok) {
      stats.written++;
      console.log(`[ok]   ${ticket.ticket_uid} (${ticket.dr_number}) +${elapsed}ms`);
    } else {
      stats.skipped_no_history++;
      console.log(`[skip] ${ticket.ticket_uid} (${ticket.dr_number}) — no history / LLM declined`);
    }
  } catch (err) {
    stats.failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[err]  ${ticket.ticket_uid} (${ticket.dr_number}): ${msg}`);
  }
}

async function runWorkers(
  candidates: TicketRow[],
  summarize: (ticketId: string, dr: string, ont: string | null) => Promise<void>,
): Promise<Stats> {
  const stats: Stats = {
    attempted: 0,
    written: 0,
    skipped_no_history: 0,
    failed: 0,
    total_latency_ms: 0,
  };

  const hasAiSummary = async (ticketId: string): Promise<boolean> => {
    const r = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM maintenance_activities
          WHERE ticket_id = $1 AND activity_type = 'ai_summary'
       ) AS exists`,
      [ticketId],
    );
    return r.rows[0]?.exists ?? false;
  };

  const queue = [...candidates];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < args.concurrency; i++) {
    workers.push(
      (async () => {
        // Single-threaded JS event loop — queue.shift() is atomic relative
        // to other workers because the only suspension points are awaits.
        for (;;) {
          const ticket = queue.shift();
          if (!ticket) return;
          await processOne(summarize, hasAiSummary, ticket, stats);
          if (args.batchPauseMs > 0) {
            await new Promise((r) => setTimeout(r, args.batchPauseMs));
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
  return stats;
}

async function main(): Promise<void> {
  const candidates = await selectCandidates();
  console.log(
    `[backfill] candidates=${candidates.length} ` +
      `concurrency=${args.concurrency} pause=${args.batchPauseMs}ms ` +
      `dryRun=${args.dryRun} maxAgeDays=${args.maxAgeDays}`,
  );

  if (candidates.length === 0) {
    console.log('[backfill] nothing to do');
    return;
  }
  if (args.dryRun) {
    candidates.slice(0, 10).forEach((t) =>
      console.log(`[dry]  ${t.ticket_uid} ${t.dr_number}`),
    );
    if (candidates.length > 10) console.log(`[dry]  ... +${candidates.length - 10} more`);
    return;
  }

  // Defer the dynamic import of drHistoryService until after the dry-run gate
  // so a misconfigured environment can still print candidate counts.
  const { summarizeAndAttachDrHistory } = await import(
    '../src/modules/noc/services/drHistoryService'
  );

  const startedAt = Date.now();
  const stats = await runWorkers(candidates, summarizeAndAttachDrHistory);
  const elapsed = Date.now() - startedAt;
  const avg =
    stats.attempted > 0 ? Math.round(stats.total_latency_ms / stats.attempted) : 0;

  console.log('');
  console.log('=== summary ===');
  console.log(`attempted:           ${stats.attempted}`);
  console.log(`written:             ${stats.written}`);
  console.log(`skipped (no history): ${stats.skipped_no_history}`);
  console.log(`failed:              ${stats.failed}`);
  console.log(`elapsed:             ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`avg per ticket:      ${avg}ms`);
}

main()
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // drHistoryService imports a separate pg.Pool via @/lib/db-pool which
    // keeps the event loop alive. Close our own pool and force-exit so
    // long-running scripts don't hang at the end.
    await pool.end().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
