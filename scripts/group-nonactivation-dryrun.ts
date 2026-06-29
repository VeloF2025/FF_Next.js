/* eslint-disable no-console -- CLI dry-run tool: console is the output channel */
/**
 * Dry-run for the per-group non-activation + PP report.
 * Builds one workbook per group and writes them to disk — SENDS NOTHING.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/group-nonactivation-dryrun.ts \
 *     --cohort 2026-06-25 --generated 2026-06-26 [--out ./out]
 */
import { writeFileSync, mkdirSync } from 'fs';
import { buildGroupNonActivationReports } from '@/services/groupNonActivationReport';
import { getConsolidatedNotFound } from '@/lib/group-nonactivation/opsQueries';
import { buildOpsWorkbook } from '@/lib/group-nonactivation/buildOpsWorkbook';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main(): Promise<void> {
  const cohortDate = arg('cohort', '');
  const generatedDate = arg('generated', '');
  const out = arg('out', '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cohortDate) || !/^\d{4}-\d{2}-\d{2}$/.test(generatedDate)) {
    console.error('Usage: --cohort YYYY-MM-DD --generated YYYY-MM-DD [--out dir]');
    process.exit(1);
  }

  const results = await buildGroupNonActivationReports({ cohortDate, generatedDate });

  console.log(`\n${'GROUP'.padEnd(28)}${'cohort'.padStart(6)}${'act'.padStart(5)}${'MISS'.padStart(6)}${'PPtot'.padStart(6)}${'PPnew'.padStart(6)}${'PPnf'.padStart(5)}${'backlog'.padStart(8)}${'typos'.padStart(6)}`);
  console.log('-'.repeat(80));
  for (const r of [...results].sort((a, b) => b.counts.miss - a.counts.miss)) {
    const c = r.counts;
    console.log(
      r.groupName.padEnd(28) +
        String(c.cohort).padStart(6) + String(c.activated).padStart(5) +
        String(c.miss).padStart(6) + String(c.pp).padStart(6) +
        String(c.ppNew).padStart(6) + String(c.ppNotFound).padStart(5) +
        String(c.backlog).padStart(8) + String(c.typos).padStart(6),
    );
    if (out) {
      mkdirSync(out, { recursive: true });
      const safe = r.groupName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
      writeFileSync(`${out}/${safe}_${cohortDate}.xlsx`, r.buffer);
    }
  }
  // Consolidated "Unresolved Pre-Provision" ops worklist (all open not_found).
  const opsRows = await getConsolidatedNotFound(generatedDate);
  const byClass = opsRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.residualClass] = (acc[r.residualClass] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nOps worklist (open not_found): ${opsRows.length} — ${JSON.stringify(byClass)}`);
  if (out && opsRows.length > 0) {
    const opsBuffer = await buildOpsWorkbook(opsRows, generatedDate);
    writeFileSync(`${out}/Unresolved-PreProvision-${generatedDate}.xlsx`, opsBuffer);
  }

  console.log(`\n${results.length} group workbooks + ops worklist built${out ? ` → ${out}` : ''}. Nothing sent.`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
