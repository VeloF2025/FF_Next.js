// tests/unit/construction-qa/no-fewshot.test.ts
// Few-shot is deliberately disabled for construction QA — it cost 3.3 points on
// 150 representative civil photos and collapsed step 1 recall from 0.316 to
// 0.053. Nothing in the type system stops someone re-adding it, and the damage
// is invisible without re-running the benchmark, so pin it here.
//
// This guards the SOURCE rather than behaviour: driving this service needs a
// live DB and a VLM (it has a top-level `neon(process.env.DATABASE_URL!)`), so
// a behavioural test here would be a mock asserting against itself.
//
// The check is on executable code with comments stripped, NOT on import syntax.
// An import-shape check is defeated by `import * as x` + `x.getVlmFewShotExamples()`
// — a false pass, which is far worse here than a false failure.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SERVICE = path.join(
  __dirname,
  '../../../src/modules/construction-qa/services/vlmConstructionService.ts',
);

/** Source with comments and string literals removed, so prose can't mask or trip a match. */
function executableSource(): string {
  return fs
    .readFileSync(SERVICE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ') // line comments (not protocol-relative URLs)
    .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g, '""'); // double-quoted strings
}

describe('construction QA does not use few-shot', () => {
  // Catches every reintroduction shape: named import, namespace access,
  // default import, alias, dynamic import — all must NAME the function to call it.
  it.each(['getVlmFewShotExamples', 'buildVlmFewShotPrompt'])(
    'never references %s in executable code',
    (name) => {
      expect(executableSource()).not.toContain(name);
    },
  );

  it('still records corrections', () => {
    // The learning signal is still WRITTEN — only the read-back into the prompt
    // is disabled. If this disappears, a future re-enable has nothing to learn
    // from.
    expect(executableSource()).toContain('recordCorrectExtraction');
  });

  it('assigns fewShotSection the empty string and never reassigns it', () => {
    const src = executableSource();
    // Every assignment to fewShotSection must be the empty literal. Tolerant of
    // formatting (const/let, spacing) but not of a value coming from anywhere
    // else — which is the thing that would actually change what the VLM sees.
    const assignments = [...src.matchAll(/\bfewShotSection\s*=\s*([^;]+);/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(assignments.length).toBeGreaterThan(0);
    for (const value of assignments) expect(value).toBe("''");
  });
});
