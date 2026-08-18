/**
 * Vitest config options that this vitest version does not understand.
 *
 * `vitest.migrations.config.ts` carried `fileParallelism: false` with a comment
 * explaining that its tests share one Postgres container and must not run in parallel.
 * The option landed in vitest 1.0; this repo is on 0.34.6, where it is not a known key
 * and is accepted in silence. So the tests ran in parallel for as long as that line
 * existed, and the comment above it read as a guarantee.
 *
 * It surfaced as 497 and 498 both running `CREATE EXTENSION IF NOT EXISTS btree_gist`
 * concurrently — check-then-insert, not atomic — and one losing with 23505 on
 * pg_extension_name_index. It failed on CI twice while passing locally.
 *
 * A wrong option name is invisible: nothing warns, and the config keeps working in the
 * weaker mode. This pins the class rather than the one instance.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Options introduced in vitest 1.x. Harmless-looking in a 0.34 config and completely
 * inert. Extend this list when a config is written against newer docs than the
 * installed version.
 */
const UNSUPPORTED_IN_V0 = ['fileParallelism', 'poolOptions', 'pool:'] as const;

function vitestConfigs(): string[] {
  return readdirSync(ROOT).filter((f) => /^vitest\..*\.config\.ts$/.test(f) || f === 'vitest.config.ts');
}

function installedMajor(): number {
  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, 'node_modules', 'vitest', 'package.json'), 'utf8'),
  ) as { version: string };
  return Number(pkg.version.split('.')[0]);
}

describe('vitest config options match the installed vitest', () => {
  it('finds the config files at all', () => {
    // Guards the guard: a wrong ROOT would make every assertion below vacuous.
    const configs = vitestConfigs();
    expect(configs.length).toBeGreaterThanOrEqual(5);
    expect(configs).toContain('vitest.migrations.config.ts');
  });

  it.each(vitestConfigs())('%s uses no option newer than the installed vitest', (file) => {
    if (installedMajor() >= 1) return; // the options below are valid from 1.0 onward

    const source = readFileSync(path.join(ROOT, file), 'utf8');
    // Strip comments: this file and the migrations config both NAME these options while
    // explaining why they are not used, and matching prose would be a false positive.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    for (const option of UNSUPPORTED_IN_V0) {
      expect(code, `${file} uses ${option}, which vitest ${installedMajor()}.x ignores silently`)
        .not.toContain(option);
    }
  });

  it('the migrations config serialises its files by a means this vitest HONOURS', () => {
    // The mirror. Without it, deleting the option entirely would satisfy every
    // assertion above while leaving the tests parallel — which is the actual defect.
    const source = readFileSync(path.join(ROOT, 'vitest.migrations.config.ts'), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).toContain('threads: false');
  });

  it('every config that shares one database container serialises', () => {
    // These four all point at a single Postgres. Any one of them running files in
    // parallel races the others' schemas and migration order.
    for (const file of [
      'vitest.migrations.config.ts',
      'vitest.db.config.ts',
      'vitest.db.sprinte.config.ts',
      'vitest.velocity-review-db.config.ts',
    ]) {
      const code = readFileSync(path.join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
      expect(code, `${file} does not serialise its test files`).toContain('threads: false');
    }
  });
});
