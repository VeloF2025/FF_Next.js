/**
 * Repo-wide ratchet: a placeholder compared against a string literal must not
 * also be bound to a `character varying` column in the same statement.
 *
 * PostgreSQL deduces a parameter's type from every use. When one $N is used
 * against a varchar column AND compared to a string literal, it deduces
 * `character varying` from one and `text` from the other, and rejects the whole
 * statement at parse time:
 *
 *     42P08  inconsistent types deduced for parameter $1
 *            text versus character varying
 *
 * Nothing in this repo catches that. Tests here mock the driver, so the
 * statement is never sent anywhere and nothing decides its types. Three live
 * 500s shipped this way and were found only by hitting the deployed app:
 *
 *   hs_worker_training.verification_status        varchar(16)
 *   offline_devices.mismatch_status               varchar(50)
 *   dr_photo_unified_reviews.serial_swap_status   varchar(50)  (twice in one file)
 *
 * The check is intentionally blunt — it cannot resolve a column's type from
 * source, so it flags the SHAPE and carries an allowlist of sites confirmed
 * harmless because their column is `text` (where text-vs-text cannot conflict).
 * Each allowlist entry names the column and was verified against the live
 * database, not assumed. Anything new fails, which is the point: the fix is one
 * `::text` per use, and it is harmless even where it is unnecessary.
 *
 * KNOWN LIMITATION — the allowlist is trusted, not re-verified. This test has no
 * database access, so an entry is believed because it is present. The claim next
 * to each is a promise a human checked `information_schema.columns`, not
 * something CI can confirm. Adding an entry to silence a failure without
 * checking the column type defeats the guard entirely. The stale-entry test
 * below catches entries that no longer match any risky shape; it cannot catch
 * one that is simply untrue.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

/**
 * Sites whose target column is `text`, so the deduction cannot conflict.
 * Verified by querying information_schema on the shared database 2026-07-31.
 */
const VERIFIED_TEXT_COLUMNS: Record<string, string> = {
  'src/modules/activate/services/disputeActions.ts':
    'ft_billing_deductions.resolution_status is text',
  'src/modules/sitecam/services/appealsVlmStore.ts': 'sitecam_appeals.status is text',
  'pages/api/activate/sitecam-appeals/[id]/decision.ts': 'sitecam_appeals.status is text',
  'src/modules/construction-qa/zone-delivery/repositories/zoneDeliveryEvidenceWriteRepository.ts':
    'zone_delivery_documents.document_type is text',
};

/**
 * This file itself, which carries the vulnerable shape on purpose as a fixture
 * for its own unit tests. Listed separately from VERIFIED_TEXT_COLUMNS because
 * the reason is different — it is not a safe column, it is not SQL at all.
 */
const SELF = 'tests/sql/parameter-type-deduction.test.ts';

export interface Offence {
  param: string;
  snippet: string;
}

/**
 * Statement-shaped windows anchored on each UPDATE keyword.
 *
 * Deliberately NOT "pair backticks across the file". That approach desyncs on
 * any odd backtick appearing earlier in the source — a stray one in a comment,
 * or a regex literal containing them (this very file has one) — after which
 * every later block is mispaired and the scan can silently find NOTHING. A
 * guard that quietly stops looking is worse than no guard, because the green
 * run reads as proof. Anchoring on UPDATE cannot desync: each window is found
 * independently of every other.
 *
 * The window runs to the statement's natural end — a closing backtick, a
 * semicolon, or a hard cap for safety — which is ample for a SET list.
 */
function sqlBlocks(source: string): string[] {
  const blocks: string[] = [];
  // Matches both `UPDATE <table>` and the `DO UPDATE SET` of an upsert.
  const anchor = /\bUPDATE\s+(?:SET\b|[a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(source)) !== null) {
    const rest = source.slice(m.index, m.index + 4000);
    const end = rest.search(/`|;\s*$|\n\s*`/m);
    const window = end > 0 ? rest.slice(0, end) : rest;
    if (/\$\d/.test(window)) blocks.push(window);
  }
  return blocks;
}

/**
 * A placeholder is risky when an UNCAST occurrence is bound to a column
 * (`col = $N`, in a SET or a WHERE — both give it the column's type) AND it is
 * compared to a string literal anywhere in the same statement.
 *
 * The comparison's own cast state is deliberately NOT part of the test. Only
 * the bound occurrence decides whether the statement parses — verified against
 * the database:
 *
 *   SET col = $1,        WHEN $1::text IN (…)   -> 42P08   (still broken)
 *   SET col = $1::text,  WHEN $1 IN (…)         -> parses
 *   SET col = $1::text,  WHEN $1::text IN (…)   -> parses
 *
 * An earlier version required the comparison to be uncast too, which made a
 * half-fixed statement — the most likely state after a careless edit — invisible.
 *
 * Only param-first comparisons are matched. `'resolved' = $1` was tested and
 * does NOT trigger 42P08; deduction is sensitive to operand order, so matching
 * it would be a false positive.
 */
export function findOffences(source: string): Offence[] {
  const out: Offence[] = [];
  for (const block of sqlBlocks(source)) {
    const bound = new Set(
      Array.from(block.matchAll(/\b[a-z_]+\s*=\s*\$(\d+)(?!\s*::)/gi)).map((m) => m[1])
    );
    for (const param of bound) {
      const compared = new RegExp(`\\$${param}(?:::\\w+)?\\s*(?:=|<>|!=|\\bIN\\b)\\s*\\(?\\s*'`, 'i');
      const m = compared.exec(block);
      if (m) {
        out.push({
          param: `$${param}`,
          snippet: block.slice(Math.max(0, m.index - 55), m.index + 55).replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  return out;
}

/**
 * Every tracked file containing an UPDATE in any form.
 *
 * Case-insensitive and NOT requiring a lowercase table name after the keyword:
 * the previous pattern (`UPDATE[[:space:]]+[a-z_]+`) silently skipped every
 * `INSERT … ON CONFLICT … DO UPDATE SET` in the repo, because there the keyword
 * is followed by `SET` and the table was named back in the INSERT. Upsert is a
 * common idiom here, so that was a repo-wide blind spot rather than an edge case.
 */
function trackedFilesWithUpdates(): string[] {
  return execFileSync('git', ['grep', '-liE', '\\bUPDATE\\b', '--', '*.ts', '*.tsx'], {
    encoding: 'utf8',
    cwd: process.cwd(),
  })
    .split('\n')
    .filter(Boolean);
}

describe('the detector recognises the shape', () => {
  const BEFORE = [
    'const q = `UPDATE offline_devices',
    '  SET mismatch_status = $1,',
    "      mismatch_resolved_at = CASE WHEN $1 IN ('resolved') THEN NOW() ELSE NULL END",
    '  WHERE id = $4`;',
  ].join('\n');

  const AFTER = BEFORE.replace(/\$1(?!\d)/g, '$1::text');

  it('fires on the statement that actually returned 500', () => {
    const found = findOffences(BEFORE);
    expect(found).toHaveLength(1);
    expect(found[0].param).toBe('$1');
  });

  it('goes quiet once every use is cast', () => {
    expect(findOffences(AFTER)).toEqual([]);
  });

  it('ignores a placeholder that is bound but never compared to a literal', () => {
    expect(findOffences('const q = `UPDATE t SET a = $1, b = $2 WHERE id = $3`;')).toEqual([]);
  });

  it('is not blinded by a stray backtick earlier in the file', () => {
    // The failure mode of the first version of this detector, found in review:
    // it paired backticks left-to-right across the whole file, so ONE unmatched
    // backtick in a comment desynced everything after it and the scan silently
    // returned zero blocks — a green run over a file containing a live bug.
    const withStrayBacktick = [
      '// Note: strip a leading ` before comparing',
      'const q = `UPDATE offline_devices',
      '  SET mismatch_status = $1,',
      "      mismatch_resolved_at = CASE WHEN $1 IN ('resolved') THEN NOW() ELSE NULL END",
      '  WHERE id = $4`;',
    ].join('\n');

    const found = findOffences(withStrayBacktick);
    expect(found).toHaveLength(1);
    expect(found[0].param).toBe('$1');
  });

  it('still fires when only the comparison was cast (the half-fixed statement)', () => {
    // Verified against the database: SET uncast + CASE cast is STILL 42P08.
    // The first version of this detector required BOTH sides uncast, so the
    // most likely state after a careless edit was the one it could not see.
    const halfFixed = [
      'const q = `UPDATE offline_devices',
      '  SET mismatch_status = $1,',
      "      mismatch_resolved_at = CASE WHEN $1::text IN ('resolved') THEN NOW() ELSE NULL END",
      '  WHERE id = $4`;',
    ].join('\n');
    expect(findOffences(halfFixed)).toHaveLength(1);
  });

  it('goes quiet when the BOUND occurrence is cast, which is what actually fixes it', () => {
    // The mirror of the case above: casting the SET side alone parses cleanly,
    // so it must not be reported.
    const boundCast = [
      'const q = `UPDATE offline_devices',
      '  SET mismatch_status = $1::text,',
      "      mismatch_resolved_at = CASE WHEN $1 IN ('resolved') THEN NOW() ELSE NULL END",
      '  WHERE id = $4`;',
    ].join('\n');
    expect(findOffences(boundCast)).toEqual([]);
  });

  it('sees an ON CONFLICT DO UPDATE SET upsert', () => {
    // The file-selection grep used to require a lowercase table name straight
    // after UPDATE, so every upsert in the repo was invisible — the keyword is
    // followed by SET and the table was named back in the INSERT.
    const upsert = [
      'const q = `INSERT INTO offline_devices (id, mismatch_status)',
      '  VALUES ($2, $1)',
      '  ON CONFLICT (id) DO UPDATE SET mismatch_status = $1,',
      "      mismatch_resolved_at = CASE WHEN $1 IN ('resolved') THEN NOW() ELSE NULL END`;",
    ].join('\n');
    expect(findOffences(upsert)).toHaveLength(1);
  });

  it('finds every statement in a file that has several', () => {
    // serial-swaps carries the same statement twice; missing the second copy
    // would have left half the bug in place.
    const twice = [
      'const a = `UPDATE t1 SET s = $1',
      "  , at = CASE WHEN $1 IN ('x') THEN NOW() END WHERE id = $2`;",
      'const b = `UPDATE t2 SET s = $1',
      "  , at = CASE WHEN $1 IN ('y') THEN NOW() END WHERE id = $2`;",
    ].join('\n');
    expect(findOffences(twice)).toHaveLength(2);
  });
});

describe('no new 42P08-shaped statement enters the repo', () => {
  it('every flagged site is a known text column', () => {
    const unexpected: string[] = [];

    for (const file of trackedFilesWithUpdates()) {
      if (file === SELF) continue;
      const found = findOffences(readFileSync(file, 'utf8'));
      if (found.length === 0) continue;
      if (VERIFIED_TEXT_COLUMNS[file]) continue;
      unexpected.push(
        `${file}  ${found.map((f) => f.param).join(', ')}\n      …${found[0].snippet}…`
      );
    }

    expect(
      unexpected,
      'New statement(s) where one placeholder is bound to a column AND compared to a ' +
        'literal. If the column is varchar this is a live 500 (42P08); cast every use ' +
        'to ::text. If the column is text, verify it against the database and add it to ' +
        `VERIFIED_TEXT_COLUMNS with the column named:\n\n    ${unexpected.join('\n    ')}\n`
    ).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    // An entry that no longer matches means the code was fixed or moved; drop
    // it so the list stays evidence, not decoration.
    const stale = Object.keys(VERIFIED_TEXT_COLUMNS).filter((file) => {
      try {
        return findOffences(readFileSync(file, 'utf8')).length === 0;
      } catch {
        return true; // file gone
      }
    });
    expect(stale, `stale allowlist entries: ${stale.join(', ')}`).toEqual([]);
  });
});
