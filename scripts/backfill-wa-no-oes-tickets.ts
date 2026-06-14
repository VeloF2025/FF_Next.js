#!/usr/bin/env tsx
/**
 * Gated per-project backfill driver for wa_no_oes auto-tickets (audit rec #5, part B).
 *
 * Hits POST /api/cron/wa-no-oes-tickets so ticket creation runs INSIDE the Next.js
 * server (createTicket + UID sequence + dedup index) — this process only drives it,
 * so it never touches the DB directly (avoids the tsx/neon-shim pitfall).
 *
 * Dry-run by DEFAULT (prints what WOULD be created). `--commit` actually creates and
 * REQUIRES `--project`, so historical tickets are only ever created one deliberate
 * project at a time (flood control — see rec #5B handoff).
 *
 * Usage:
 *   CRON_SECRET=... ./node_modules/.bin/tsx scripts/backfill-wa-no-oes-tickets.ts \
 *     [--project "Mohadin"] [--commit] [--base http://localhost:3000] [--limit 5000]
 *
 * Examples:
 *   # dry-run, all real projects (totals + sample):
 *   CRON_SECRET=$SECRET tsx scripts/backfill-wa-no-oes-tickets.ts
 *   # dry-run a single project:
 *   CRON_SECRET=$SECRET tsx scripts/backfill-wa-no-oes-tickets.ts --project "Lawley"
 *   # COMMIT a single project (after reviewing its dry-run):
 *   CRON_SECRET=$SECRET tsx scripts/backfill-wa-no-oes-tickets.ts --project "Lawley" --commit
 */

interface CliArgs {
  project: string | null;
  commit: boolean;
  base: string;
  limit: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    project: null,
    commit: false,
    base: process.env.WA_NO_OES_BASE_URL ?? 'http://localhost:3000',
    limit: 5000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') args.commit = true;
    else if (a === '--project') args.project = argv[++i] ?? null;
    else if (a === '--base') args.base = argv[++i] ?? args.base;
    else if (a === '--limit') args.limit = Number(argv[++i]) || args.limit;
  }
  return args;
}

interface RunResult {
  scanned: number;
  created: number;
  skippedExisting: number;
  unassigned: number;
  dryRun: boolean;
  resolved?: number;
  preview?: Array<{ drop_number: string; project: string; assigned_team_id: string | null; title: string }>;
}

async function callEndpoint(
  args: CliArgs,
  secret: string,
  dryRun: boolean
): Promise<RunResult> {
  const res = await fetch(`${args.base}/api/cron/wa-no-oes-tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({
      project: args.project ?? undefined,
      sinceDays: null, // backfill = full history
      dryRun,
      limit: args.limit,
    }),
  });
  const json = (await res.json()) as { success?: boolean; data?: RunResult; error?: unknown };
  if (!res.ok || !json.success) {
    throw new Error(`endpoint ${res.status}: ${JSON.stringify(json.error ?? json)}`);
  }
  if (!json.data) throw new Error('endpoint returned no data');
  return json.data;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET env var is required.');
    process.exit(1);
  }
  if (args.commit && !args.project) {
    console.error(
      'Refusing to --commit without --project. Backfill one project at a time (flood control).'
    );
    process.exit(1);
  }

  const scope = args.project ?? 'ALL real projects';
  console.log(`\nwa_no_oes backfill — scope: ${scope} — base: ${args.base}`);

  // Always dry-run first and show the preview.
  const dry = await callEndpoint(args, secret, true);
  console.log(
    `\n[DRY-RUN] scanned=${dry.scanned} would-create=${dry.preview?.length ?? 0} ` +
      `skip-existing=${dry.skippedExisting} would-be-unassigned=${dry.unassigned}`
  );
  const byProject = new Map<string, number>();
  for (const p of dry.preview ?? []) byProject.set(p.project, (byProject.get(p.project) ?? 0) + 1);
  for (const [proj, n] of [...byProject.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${proj.padEnd(24)} ${n}`);
  }
  for (const p of (dry.preview ?? []).slice(0, 5)) {
    console.log(`   e.g. ${p.drop_number} → team=${p.assigned_team_id ?? 'UNASSIGNED'} | ${p.title}`);
  }

  if (!args.commit) {
    console.log('\nDry-run only. Re-run with --project "<name>" --commit to create.\n');
    return;
  }

  console.log(`\n[COMMIT] creating tickets for "${args.project}" …`);
  const run = await callEndpoint(args, secret, false);
  console.log(
    `[COMMIT] created=${run.created} skip-existing=${run.skippedExisting} ` +
      `unassigned=${run.unassigned} auto-resolved=${run.resolved ?? 0}\n`
  );
}

main().catch((err) => {
  console.error('backfill failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
