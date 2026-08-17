#!/usr/bin/env node
/**
 * Fail when a NEW migration reuses a version number.
 *
 * Two files numbered 493 are not a naming quibble. `scripts/migrations/run.ts`
 * resolves a rollback by version prefix, so `rollback 493` has to pick between
 * `493_manco_comment_source_meeting` and `493_stock_take_location_scoped`.
 * That function now throws on ambiguity rather than guessing — which is the
 * right behaviour, and also means a genuine emergency rollback stops dead until
 * somebody works out the exact filename by hand. The cheapest place to prevent
 * that is here, when the second 493 is still an unmerged file.
 *
 * Why the existing 15 are grandfathered rather than renamed
 * --------------------------------------------------------
 * `schema_migrations` is keyed by FILENAME, not by version. Renaming an applied
 * migration therefore makes the runner treat it as brand new and apply it again
 * — against the single Postgres that dev and production share. Every one of the
 * 15 pairs below is already applied, so renaming them would re-run 15 applied
 * migrations on live data to tidy up a naming convention. Not worth it. They
 * stay, listed explicitly, and the gate stops the 16th.
 *
 * An explicit list rather than a count: a count of 15 would stay green if
 * someone added a new collision in the same PR that resolved an old one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
  'sql',
);

/**
 * Version numbers that already collided when this gate was introduced
 * (2026-08-17). Applied, therefore unrenameable. Never add to this list — a new
 * entry here is the exact thing the gate exists to prevent. Entries may only be
 * REMOVED, and only if the collision genuinely goes away.
 */
export const GRANDFATHERED = new Set([
  '320', '333', '335', '343', '346', '347', '357', '365',
  '401', '409', '411', '425', '479', '493', '495',
]);

/** version -> filenames, for forward migrations only (rollbacks mirror them). */
export function collisions(filenames) {
  const byVersion = new Map();
  for (const file of filenames) {
    if (!file.endsWith('.sql') || file.startsWith('rollback_')) continue;
    const match = /^(\d+)_/.exec(file);
    if (!match) continue;
    const version = match[1];
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version).push(file);
  }

  const found = new Map();
  for (const [version, files] of byVersion) {
    if (files.length > 1) found.set(version, files.sort());
  }
  return found;
}

/** Collisions that are NOT grandfathered — i.e. the ones that fail the build. */
export function newCollisions(filenames, allowed = GRANDFATHERED) {
  return new Map([...collisions(filenames)].filter(([v]) => !allowed.has(v)));
}

/** Run only when executed directly, so the test can import the functions. */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const offenders = newCollisions(fs.readdirSync(MIGRATIONS_DIR));

  if (offenders.size > 0) {
    console.error('\n  Migration version collision:\n');
    for (const [version, files] of offenders) {
      console.error(`  ${version} is used by ${files.length} migrations:`);
      for (const file of files) console.error(`    - ${file}`);
    }
    console.error(
      '\n  Renumber the NEW migration to the next free version. A rollback is\n' +
        '  resolved by version prefix, so a duplicate leaves `rollback ' +
        `${[...offenders.keys()][0]}\` unable to\n` +
        '  tell which migration you meant.\n',
    );
    process.exit(1);
  }

  const stale = [...GRANDFATHERED].filter((v) => !collisions(fs.readdirSync(MIGRATIONS_DIR)).has(v));
  if (stale.length > 0) {
    console.log(`  ✓ No new migration collisions (${stale.length} grandfathered entries now resolvable: ${stale.join(', ')})`);
  } else {
    console.log(`  ✓ No new migration version collisions (${GRANDFATHERED.size} grandfathered)`);
  }
}
