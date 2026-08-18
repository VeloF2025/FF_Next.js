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
 *
 * Patterns rather than substrings, so `pool : 'forks'` cannot slip past on a space —
 * the first draft matched the literal `'pool:'` while matching `'fileParallelism'`
 * bare, and that inconsistency is exactly the kind of thing this file exists to stop.
 *
 * KNOWN LIMIT, accepted: this reads the config as TEXT, so an option reached
 * indirectly — a computed key, or a value spread from an imported object — carries no
 * literal to match and would pass. Nothing in this repo writes vitest config that way,
 * and the positive assertions below still fail loudly if the serialisation itself
 * disappears, which is the failure that actually costs something.
 */
const UNSUPPORTED_IN_V0: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'fileParallelism', pattern: /\bfileParallelism\b/ },
  { name: 'poolOptions', pattern: /\bpoolOptions\b/ },
  { name: 'pool', pattern: /\bpool\s*:/ },
];

/**
 * Remove block and line comments so prose naming an option is not a match.
 *
 * `//` is only treated as a comment when it does not follow a colon, so a URL such as
 * `https://vitest.dev/...` in a comment or string keeps its tail. Truncating there
 * could drop real code after it on the same line and turn a broken config into a pass.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

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
    const code = stripComments(source);

    for (const { name, pattern } of UNSUPPORTED_IN_V0) {
      expect(
        pattern.test(code),
        `${file} uses ${name}, which vitest ${installedMajor()}.x ignores silently`,
      ).toBe(false);
    }
  });

  it('the migrations config serialises its files by a means this vitest HONOURS', () => {
    // The mirror. Without it, deleting the option entirely would satisfy every
    // assertion above while leaving the tests parallel — which is the actual defect.
    const code = stripComments(readFileSync(path.join(ROOT, 'vitest.migrations.config.ts'), 'utf8'));
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
      const code = stripComments(readFileSync(path.join(ROOT, file), 'utf8'));
      expect(code, `${file} does not serialise its test files`).toContain('threads: false');
    }
  });
});

describe('the matching itself', () => {
  const match = (name: string, code: string) =>
    UNSUPPORTED_IN_V0.find((o) => o.name === name)!.pattern.test(code);

  it('catches `pool` however it is spaced', () => {
    // The first draft matched the literal 'pool:', so a space before the colon walked
    // straight past it while `fileParallelism` was matched bare.
    expect(match('pool', "pool: 'forks',")).toBe(true);
    expect(match('pool', "pool : 'forks',")).toBe(true);
    expect(match('pool', "pool\t: 'forks',")).toBe(true);
  });

  it('does not fire on a word that merely contains `pool`', () => {
    // The mirror: a pattern that matched everything would satisfy the case above.
    expect(match('pool', 'const poolSize = 4;')).toBe(false);
    expect(match('pool', 'threads: false,')).toBe(false);
  });

  it('catches poolOptions and fileParallelism on a word boundary', () => {
    expect(match('poolOptions', 'poolOptions: { threads: {} },')).toBe(true);
    expect(match('fileParallelism', 'fileParallelism: false,')).toBe(true);
    expect(match('fileParallelism', 'myFileParallelismNote: 1,')).toBe(false);
  });

  it('strips a TRAILING comment, so naming an option in prose is not a failure', () => {
    // Fails closed rather than open, but it would have failed a config that was
    // correct — training whoever hit it to distrust this test.
    const code = stripComments("threads: false, // deliberately not fileParallelism");
    expect(code).toContain('threads: false');
    expect(match('fileParallelism', code)).toBe(false);
  });

  it('keeps code that follows a URL on the same line', () => {
    // `//` inside `https://` must not truncate the line — dropping the tail could hide
    // a real option and turn a broken config into a pass.
    const code = stripComments("url: 'https://vitest.dev', fileParallelism: false,");
    expect(match('fileParallelism', code)).toBe(true);
  });

  it('strips block and whole-line comments', () => {
    expect(match('fileParallelism', stripComments('/* fileParallelism */'))).toBe(false);
    expect(match('fileParallelism', stripComments('  // fileParallelism'))).toBe(false);
  });
});
