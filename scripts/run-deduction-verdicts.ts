/**
 * Ops script: run the FT deduction auto-verifier.
 *
 *   ./node_modules/.bin/tsx scripts/run-deduction-verdicts.ts             # latest week, all projects
 *   ./node_modules/.bin/tsx scripts/run-deduction-verdicts.ts 2026-06-07  # specific week_ending
 *
 * Requires DATABASE_URL in the environment (.env.local is loaded).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

async function main(): Promise<void> {
  const { default: pool } = await import('../src/lib/db');
  const { computeVerdictsForWeek } = await import(
    '../src/modules/billing/services/deductionVerdictService'
  );

  const weekArg = process.argv[2] ?? null;
  const { rows } = weekArg
    ? await pool.query<{ id: string; project: string; week_ending: string }>(
        `SELECT id, project, week_ending::text FROM ft_weekly_billing WHERE week_ending = $1::date`,
        [weekArg],
      )
    : await pool.query<{ id: string; project: string; week_ending: string }>(
        `SELECT id, project, week_ending::text FROM ft_weekly_billing
          WHERE week_ending = (SELECT MAX(week_ending) FROM ft_weekly_billing)`,
      );

  if (rows.length === 0) {
    process.stdout.write('No billing weeks found for the given criteria\n');
    process.exit(1);
  }

  for (const w of rows) {
    const s = await computeVerdictsForWeek(w.id);
    process.stdout.write(
      `${w.week_ending} ${w.project.padEnd(20)} total=${s.total} judged=${s.judged} ` +
      `disputable=${s.disputable} legitimate=${s.legitimate} insufficient=${s.insufficientEvidence} skipped=${s.skipped}\n`,
    );
  }

  await pool.end();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
