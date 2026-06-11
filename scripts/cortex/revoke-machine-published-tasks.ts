// Phase 5 bulk-revoke — the kill-switch's companion for Cortex machine-published tasks.
//
// Auto-publish creates FibreFlow action_items from auto-sealed Cortex meetings with NO human
// gate, tagged `machine_published=true`. If capture quality goes bad, this script revokes them
// in one shot. Pair it with the env kill-switch (CORTEX_DELIVERY_ENABLED=false), which stops
// NEW deliveries; this cleans up what already landed.
//
// Default = DRY-RUN (counts only). `--execute` cancels (status='cancelled') every still-open
// (pending/in_progress) machine-published task — reversible + audit-friendly. `--delete` hard-
// deletes instead (irreversible; only for genuine noise). `--since=ISO` limits to tasks created
// at/after a timestamp.
//
//   npx tsx scripts/cortex/revoke-machine-published-tasks.ts                 # dry-run
//   npx tsx scripts/cortex/revoke-machine-published-tasks.ts --execute       # cancel them
//   npx tsx scripts/cortex/revoke-machine-published-tasks.ts --delete        # hard delete
//   npx tsx scripts/cortex/revoke-machine-published-tasks.ts --execute --since=2026-06-11

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
if (!process.env.DATABASE_URL) dotenv.config({ path: '.env.production' });
// The velo prod deploy keeps DATABASE_URL in .env (the systemd EnvironmentFile), not
// .env.local — load it too so this standalone script works in prod without an explicit
// DATABASE_URL= prefix.
if (!process.env.DATABASE_URL) dotenv.config({ path: '.env' });

const out = (m: string) => process.stdout.write(m + '\n');
const err = (m: string) => process.stderr.write(m + '\n');

async function main(): Promise<number> {
  const args = new Set<string>(process.argv.slice(2));
  const execute = args.has('--execute');
  const hardDelete = args.has('--delete');
  const sinceArg = [...args].find((a) => a.startsWith('--since='))?.split('=')[1] ?? null;

  // Reject the ambiguous combo rather than silently picking the harder (irreversible)
  // action: --execute means cancel, --delete means hard-delete. They are mutually exclusive.
  if (execute && hardDelete) {
    err('Pass EITHER --execute (cancel open tasks) OR --delete (hard delete), not both.');
    return 1;
  }
  if (!process.env.DATABASE_URL) {
    err('DATABASE_URL is not set');
    return 1;
  }

  const { sql } = await import('@/lib/db-pool');
  const since = sinceArg ?? '1970-01-01T00:00:00Z';

  // Count first so a dry-run (and the operator) always sees the blast radius.
  const counts = (await sql`
    SELECT
      COUNT(*)                                                    AS total,
      COUNT(*) FILTER (WHERE status IN ('pending', 'in_progress')) AS open
    FROM action_items
    WHERE machine_published = TRUE AND created_at >= ${since}
  `) as { total: number; open: number }[];
  const { total, open } = counts[0] ?? { total: 0, open: 0 };
  out(`machine-published tasks since ${since}: ${total} total, ${open} still open (pending/in_progress)`);

  if (!execute && !hardDelete) {
    out('DRY-RUN — no changes. Re-run with --execute (cancel) or --delete (hard delete).');
    return 0;
  }

  if (hardDelete) {
    const del = (await sql`
      DELETE FROM action_items
      WHERE machine_published = TRUE AND created_at >= ${since}
      RETURNING id
    `) as { id: string }[];
    out(`DELETED ${del.length} machine-published task(s).`);
    return 0;
  }

  // Default execute path: cancel only the still-open ones (don't disturb completed history).
  const cancelled = (await sql`
    UPDATE action_items
    SET status = 'cancelled', updated_at = NOW()
    WHERE machine_published = TRUE
      AND status IN ('pending', 'in_progress')
      AND created_at >= ${since}
    RETURNING id
  `) as { id: string }[];
  out(`CANCELLED ${cancelled.length} open machine-published task(s).`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    err(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(1);
  });
