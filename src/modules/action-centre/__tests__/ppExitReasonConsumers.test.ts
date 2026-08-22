/**
 * Every query that counts OPEN pre-provisions must know about the exit path.
 *
 * Migration 524 let a pre-provision leave the list without activating. The first
 * cut added `exit_reason IS NULL` to two queries and missed five others, so a row
 * an operator had just classified vanished from the Action Centre queue while
 * still being counted by the Action Centre overview tile, the non-invoiceables
 * queue and its counts, Billing status, and the stale-PP alert scanner. Five
 * screens over one table, disagreeing.
 *
 * A reviewer found four of them by hand. This test exists so the sixth is found
 * by CI instead: it scans the source for any query filtering pre-provisions to
 * the not-activated set and fails unless that same query also excludes exited
 * rows. It is deliberately a source scan rather than a database assertion —
 * the failure mode is a developer adding a consumer, which no runtime test of
 * the existing consumers would ever see.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOTS = ['pages/api', 'src/modules', 'src/lib'];

/**
 * The ways this repo selects pre-provisions that have not activated.
 *
 * BOTH forms matter, and missing the second is how three consumers were wrongly
 * exempted from the first version of this test: a query can express "still open"
 * as `resolution_status != 'activated'` OR as `resolution_status = 'not_found'`,
 * and the second reads nothing like the first. An exited row keeps whatever
 * resolution_status the import gave it — usually 'not_found' — so it matches the
 * second form just as strongly.
 */
const OPEN_PP_FILTER =
  /resolution_status\s*(?:!=|<>)\s*'activated'|resolution_status\s*=\s*'not_found'/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Files that legitimately touch open pre-provisions WITHOUT excluding exited
 * rows. Every entry needs a reason: this list is the place a future reader looks
 * to understand why a consumer is exempt, so "it was failing" is not one.
 */
const EXEMPT: Record<string, string> = {
  'pages/api/activate/import-pp-data.ts':
    'The importer WRITES the list; it must see every row, including exited ones, or a re-listed serial would be inserted twice.',
  'pages/api/activate/pp-data-resolve.ts':
    'The resolver acts on a specific row the user named; it is not a count of open work.',
  'pages/api/activate/pp-data-tickets.ts':
    'Ticket creation operates on explicitly selected rows, not on the open backlog.',
  'pages/api/activate/non-invoiceables/billing-crossref.ts':
    'Cross-reference against billing must see historical rows regardless of exit state.',
  'pages/api/billing/reconcile.ts':
    'Reconciliation is historical: an exited row may still carry billing consequences.',
  'src/modules/activate/services/oes/oesImportService.ts':
    'Import-side upsert; see import-pp-data.ts.',
  'src/modules/activate/services/oes/oesPostImportService.ts':
    'Post-import lifecycle, including retireSupersededPpSerials, operates on activated rows.',
  'src/modules/activate/services/oes/oesSerialLifecycle.ts':
    'Serial lifecycle is per-serial, not a backlog count.',
  'src/modules/activate/services/cascadePpResolution.ts':
    'Cascade acts on a named drop, not on the open list.',
  'src/modules/noc/services/dataSyncResolution.ts':
    'Sync resolution targets specific rows by serial.',
  'src/modules/velocity-review/candidateRepository.ts':
    'Review candidates are drawn from activated rows.',
  'src/modules/billing/services/reconcileBillingWeek.ts':
    'Historical billing reconciliation; see billing/reconcile.ts.',
  'src/lib/oes-report/queries.ts':
    'The OES report mirrors the vendor sheet as-imported.',
  'src/lib/oes-report/ppSheetsV2.ts':
    'See oes-report/queries.ts.',
  'src/modules/non-invoiceables/types.ts':
    'Type declarations only — the string appears in a doc comment.',
};

describe('pre-provision exit path — every open-PP consumer honours it', () => {
  it('finds no query that counts open pre-provisions without excluding exited rows', () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const src = readFileSync(file, 'utf8');
        if (!src.includes('oes_pp_data')) continue;
        if (!OPEN_PP_FILTER.test(src)) continue;
        if (src.includes('exit_reason')) continue;
        if (EXEMPT[file]) continue;
        offenders.push(file);
      }
    }

    expect(
      offenders,
      `These filter pre-provisions to the not-activated set but do not exclude exited ` +
        `rows, so they will disagree with the Action Centre queue. Add ` +
        `\`exit_reason IS NULL\`, or add the file to EXEMPT with a reason:\n` +
        offenders.map((o) => `  - ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps the exemption list honest — every entry still exists and still matches', () => {
    // An exemption for a file that no longer qualifies is dead weight that hides
    // the next real offender behind a stale name.
    for (const [file, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(20);
      const src = readFileSync(file, 'utf8');
      expect(src.includes('oes_pp_data'), `${file} no longer touches oes_pp_data`).toBe(true);
    }
  });
});
