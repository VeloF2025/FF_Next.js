// tests/unit/vlm-bench/runner.test.ts
import { describe, it, expect } from 'vitest';
import { runPack } from '../../../scripts/vlm-bench/engine/runner';
import type { VlmTestPack } from '../../../scripts/vlm-bench/types';

const fakePack: VlmTestPack = {
  id: 'fake',
  async loadCases() {
    return [
      { id: 'a', imageRef: 'x', expected: { serial: 'AAA' } },
      { id: 'b', imageRef: 'y', expected: { serial: 'BBB' } },
    ];
  },
  buildPrompt(c) {
    return { model: 'm', max_tokens: 10, messages: [{ role: 'user', content: c.id }] };
  },
  score(expected, actual) {
    const want = (expected as { serial: string }).serial;
    return { pass: want === actual, score: want === actual ? 1 : 0 };
  },
};

describe('runPack', () => {
  it('scores each case via the injected caller and aggregates', async () => {
    const answers: Record<string, string> = { a: 'AAA', b: 'WRONG' };
    const result = await runPack(fakePack, 'golden', { goldenRoot: '/tmp' }, async (req) => answers[req.messages[0].content as string]);
    expect(result.total).toBe(2);
    expect(result.passed).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.scorePct).toBe(50);
  });

  it('records caller errors without counting them in scorePct', async () => {
    const result = await runPack(fakePack, 'golden', { goldenRoot: '/tmp' }, async (req) => {
      if ((req.messages[0].content as string) === 'a') throw new Error('timeout');
      return 'BBB';
    });
    expect(result.errors).toBe(1);
    expect(result.scored).toBe(1);
    expect(result.scorePct).toBe(100); // the one scored case passed
  });
});
