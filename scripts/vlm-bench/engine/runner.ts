// scripts/vlm-bench/engine/runner.ts
import type { CaseScore, LoadOpts, PackResult, VlmRequest, VlmTestPack } from '../types';

/** Caller signature so tests can inject a stub instead of hitting the GPU. */
export type Caller = (req: VlmRequest) => Promise<string>;

export async function runPack(
  pack: VlmTestPack,
  mode: 'golden' | 'live',
  opts: LoadOpts,
  call: Caller,
): Promise<PackResult> {
  const cases = await pack.loadCases(mode, opts);
  const scores: CaseScore[] = [];
  for (const c of cases) {
    try {
      const actual = await call(pack.buildPrompt(c));
      const s = pack.score(c.expected, actual);
      scores.push({ caseId: c.id, pass: s.pass, score: s.score, detail: s.detail });
    } catch (e) {
      scores.push({ caseId: c.id, pass: false, score: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const scored = scores.filter((s) => !s.error);
  const errors = scores.length - scored.length;
  const passed = scored.filter((s) => s.pass).length;
  const scorePct =
    scored.length === 0 ? 0 : (100 * scored.reduce((a, s) => a + s.score, 0)) / scored.length;
  return { packId: pack.id, total: cases.length, scored: scored.length, errors, passed, scorePct, cases: scores };
}
