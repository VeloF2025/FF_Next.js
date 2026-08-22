#!/usr/bin/env tsx
/**
 * verify-no-direct-status-writes.ts — Sprint E cutover T-1 readiness gate.
 *
 * Runs the `local/no-direct-serial-status-write` ESLint rule (Track 3) at
 * "error" severity over src/, pages/ and scripts/, regardless of its
 * configured severity.
 * .eslintrc.json has said "error" for this rule since 2026-05-30, but that file
 * is dead config: .eslintrc.cjs wins ESLint 8 precedence and never declares the
 * `local` plugin, so `npm run lint` has never evaluated the rule. (The older
 * wording here — "the rule ships off and flips at cutover" — described a plan,
 * not the file.) This script is therefore the only thing that actually runs it,
 * which is why it loads the rule by bare name and forces "error" rather than
 * trusting any configured severity.
 *
 * Exit codes:
 *   0 — no direct stock_serials.status/holder_id writes outside the rule's
 *       allow-list (serialLifecycle.ts, serialForceCorrectService.ts, and four
 *       operator-invoked scripts — see ALLOWED_FILES in the rule for the list
 *       and the reason each is there). Safe to create __sprint_e_cutover_gate__.
 *   1 — one or more direct writers remain; route them through promoteSerial()
 *       before cutover.
 *   2 — the check itself failed to run (ESLint/config error).
 *
 * mig 387's cutover gate message requires this to exit 0 against origin/master
 * HEAD before the marker table is created. See docs/runbooks/sprint-e-cutover.md.
 *
 * Single source of truth: it executes the SAME rule the cutover PR flips on, so
 * there is no second copy of the detection logic to drift from the rule.
 *
 * Scope note: scans src/, pages/ and scripts/ (TS only). scripts/ was added after
 * it turned out to hold three direct writers that the gate had never examined —
 * "zero direct writers" had been a statement about the search path, not the
 * code. Still outside scope, and deliberately: app/ (0 of its files reference
 * stock_serials today, but it is part of the active hybrid router, so this is a
 * blind spot rather than a guarantee), tests/ (ESLint-ignored; tests legitimately
 * build raw trigger/backfill SQL), .js/.mjs files, and SQL migrations, which
 * carry their own review process.
 *
 * Usage:  npx tsx scripts/verify-no-direct-status-writes.ts
 */
import { ESLint } from 'eslint';
import * as path from 'node:path';

// Load the rule by BARE name via rulePaths (--rulesdir), mirroring how
// scripts/ci-local.sh runs the sibling no-silent-catch rule. The .eslintrc
// "local/"-prefixed copy stays "off"; this bare-id copy is forced to "error".
const RULE_ID = 'no-direct-serial-status-write';
// scripts/ is scanned too. Leaving it out meant the two operator-invoked
// backfills that write stock_serials.status directly were never examined, so
// the gate reported zero direct writers while two sat outside its search path.
const TARGETS = ['src/**/*.{ts,tsx}', 'pages/**/*.{ts,tsx}', 'scripts/**/*.ts'];
const ROOT = path.join(__dirname, '..');

async function main(): Promise<void> {
  const eslint = new ESLint({
    cwd: ROOT,
    // Loads .eslintrc.CJS for the TS parser and ignore patterns — not
    // .eslintrc.json, which this file's own header correctly calls dead config
    // and which ESLint 8 never resolves while .eslintrc.cjs exists. The
    // practical difference: .eslintrc.cjs ignores only `dist`, so the scan is
    // WIDER than the .eslintrc.json ignore list would have made it.
    useEslintrc: true,
    rulePaths: [path.join(ROOT, 'scripts', 'eslint-rules')],
    // Force the rule on irrespective of its "off" pre-cutover setting.
    overrideConfig: { rules: { [RULE_ID]: 'error' } },
    extensions: ['.ts', '.tsx'],
  });

  const results = await eslint.lintFiles(TARGETS);

  // lintFiles applies the whole config; only this rule's messages are relevant.
  const violations = results.flatMap((r) =>
    r.messages
      .filter((m) => m.ruleId === RULE_ID)
      .map((m) => `${path.relative(ROOT, r.filePath)}:${m.line}:${m.column}  ${m.message}`),
  );

  if (violations.length === 0) {
    process.stdout.write(
      `[OK ] ${RULE_ID}: 0 direct stock_serials.status/holder_id writes outside the allow-list.\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `[FAIL] ${RULE_ID}: direct serial status/holder writes must route through promoteSerial():\n`,
  );
  for (const v of violations) process.stderr.write(`  ${v}\n`);
  process.stderr.write(
    `\n${violations.length} violation(s) — fix before creating __sprint_e_cutover_gate__.\n`,
  );
  process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`verify-no-direct-status-writes: ERROR — ${msg}\n`);
  process.exit(2);
});
