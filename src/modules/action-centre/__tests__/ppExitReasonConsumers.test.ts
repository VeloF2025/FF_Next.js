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

// ⚠️ TWO COVERAGE LIMITS, worth knowing before relying on this.
//
// (a) FILE GRANULARITY. The scan asks "does this file contain the clause", not
// "does every open-PP query in it". A file with two such queries where only one
// carries the clause passes — verified by mutation: removing one of the two
// clauses in app/api/analytics/.../pre-provisions/route.ts goes undetected,
// removing both is caught. Per-query checking needs a SQL parser, which is more
// machinery than this is worth; the realistic mistake is a whole consumer
// written without the clause, and that IS caught.
// (b) SELECTION. The PR gate runs AFFECTED tests only (scripts/test-ratchet.sh --changed), and
// vitest selects by static dependency graph. This test reads its targets with
// readFileSync, so it has no static edge to any of them: a PR that adds a ninth
// consumer WITHOUT touching this file will not select it, and the PR will go
// green. The full suite on master push does run it, so the offender is caught
// after merge rather than before.
// Promoting this to a scripts/ci-local.sh gate (like the secret scan) would make
// it a true per-PR gate; it lives here for now because a test is cheaper to keep
// honest than a bash gate.


// BOTH router trees. This repo is hybrid (pages/ and app/), and the first version
// of this list omitted `app` — which hid a live analytics report that counts the
// same backlog. One missing root is one whole tree the guard cannot see.
const ROOTS = ['pages/api', 'app', 'src/modules', 'src/lib', 'scripts'];

/**
 * The ways this repo selects pre-provisions that have not activated.
 *
 * There are FOUR idioms and every one has hidden a consumer during this
 * feature's review:
 *   1. resolution_status != 'activated'                  the obvious one
 *   2. resolution_status <> 'activated'                  same, other operator
 *   3. resolution_status IS DISTINCT FROM 'activated'    NULL-safe variant
 *   4. resolution_status = 'not_found' / IN ('located_')  by membership
 *
 * The first version matched only (1), which let three consumers through AND got
 * them wrongly exempted. (4) hid an App Router analytics report. (3) made the
 * metrics snapshot invisible to its own guard. Before adding a fifth, grep:
 *   grep -rhoiE "resolution_status\\s*(!=|<>|=|IS DISTINCT FROM|IN)" pages app src scripts
 */
const OPEN_PP_FILTER = new RegExp(
  [
    "resolution_status\\s*(?:!=|<>)\\s*'activated'",
    "resolution_status\\s+IS\\s+DISTINCT\\s+FROM\\s+'activated'",
    "resolution_status\\s*=\\s*'not_found'",
    "resolution_status\\s+IN\\s*\\(\\s*'located_",
  ].join('|'),
  'i',
);

/**
 * Strip comments before matching. Twice now this scan has been fooled by prose:
 * a doc comment mentioning `exit_reason` counted as coverage, and a comment
 * saying "933 rows with resolution_status != 'activated'" made a backfill script
 * that only ever selects ACTIVATED rows look like an open-PP consumer. Code is
 * the subject; commentary about code is not.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')  // line comments, not URLs
    .replace(/--[^\n]*/g, ' ');            // SQL comments inside template literals
}

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
    'Reconciled against Fibertime\'s own ft_pre_provisions_count, which FT computes with no knowledge of our internal exit_reason. Filtering here would manufacture a variance against their number rather than remove one. (The earlier reason on this entry — "historical" — was wrong: the query is a live current-state count with no date bound.)',
  'src/modules/activate/services/oes/oesImportService.ts':
    'Import-side upsert; see import-pp-data.ts.',
  'src/modules/activate/services/oes/oesPostImportService.ts':
    'Post-import lifecycle, including retireSupersededPpSerials, operates on activated rows.',
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
  'src/modules/non-invoiceables/types.ts':
    'Declares the table name as a union-type member (a source-kind discriminator); it issues no query, so there is nothing to filter.',
};

describe('pre-provision exit path — every open-PP consumer honours it', () => {
  it('finds no query that counts open pre-provisions without excluding exited rows', () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const src = stripComments(readFileSync(file, 'utf8'));
        if (!src.includes('oes_pp_data')) continue;
        if (!OPEN_PP_FILTER.test(src)) continue;
        // Require the actual CLAUSE, not the word. `includes('exit_reason')` was
        // satisfied by a doc comment mentioning the column, so stripping the real
        // clause from a file that discusses it elsewhere passed clean. Both
        // polarities count: most consumers filter (`IS NULL`), one classifies
        // (`IS NOT NULL THEN 'resolved'`).
        if (/exit_reason\s+IS\s+(?:NOT\s+)?NULL/i.test(src)) continue;
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
      const src = stripComments(readFileSync(file, 'utf8'));
      expect(src.includes('oes_pp_data'), `${file} no longer touches oes_pp_data`).toBe(true);
    }
  });
});
