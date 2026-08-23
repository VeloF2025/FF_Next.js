// tests/unit/construction-qa/no-fewshot.test.ts
// Few-shot is deliberately disabled for construction QA — it cost 3.3 points on
// 150 representative civil photos and collapsed step 1 recall from 0.316 to
// 0.053. Nothing in the type system stops someone re-adding it, and the damage
// is invisible without re-running the benchmark, so pin it here.
//
// This guards the IMPORT SURFACE rather than behaviour: driving the real
// service needs a live DB and a VLM, so a behavioural test here would be a
// mock asserting against itself. An import-level guard cannot be satisfied
// accidentally — re-adding few-shot to this module requires importing it.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SERVICE = path.join(
  __dirname,
  '../../../src/modules/construction-qa/services/vlmConstructionService.ts',
);

const source = (): string => fs.readFileSync(SERVICE, 'utf8');

/** Import statements only — comments mentioning these names are fine. */
const importedNames = (src: string): string[] => {
  const names: string[] = [];
  for (const m of src.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"][^'"]+['"];?/gm)) {
    for (const raw of m[1]!.split(',')) {
      const n = raw.trim().split(/\s+as\s+/)[0]?.trim();
      if (n) names.push(n);
    }
  }
  return names;
};

describe('construction QA does not use few-shot', () => {
  it('imports neither few-shot helper', () => {
    const imported = importedNames(source());
    expect(imported).not.toContain('getVlmFewShotExamples');
    expect(imported).not.toContain('buildVlmFewShotPrompt');
  });

  it('still imports recordCorrectExtraction', () => {
    // The learning signal is still WRITTEN — only the read-back into the prompt
    // is disabled. If this disappears, corrections stop being recorded and a
    // future re-enable would have nothing to learn from.
    expect(importedNames(source())).toContain('recordCorrectExtraction');
  });

  it('passes an empty few-shot section to the prompt builder', () => {
    const src = source();
    expect(src).toMatch(/const fewShotSection = '';/);
    // buildPhotoPrompt's 4th argument must be that constant, not a rebuilt value.
    expect(src).toMatch(/buildPhotoPrompt\(discipline, step, stepDef \?\? null, fewShotSection\)/);
  });

  it('records why, so the next person does not silently re-enable it', () => {
    // A bare `= ''` with no rationale invites "cleanup". The measurement is the
    // reason this line exists; keep them together.
    const src = source();
    expect(src).toContain('civil-rep');
    expect(src).toMatch(/65\.7|66\.0/);
  });
});
