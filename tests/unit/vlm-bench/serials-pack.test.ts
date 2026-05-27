// tests/unit/vlm-bench/serials-pack.test.ts
import { describe, it, expect } from 'vitest';
import { serialsPack } from '../../../scripts/vlm-bench/packs/serials';

describe('serialsPack.score', () => {
  it('passes on exact match after normalisation', () => {
    const r = serialsPack.score({ serial: 'ALCLB491BAA2' }, ' alclb-491 baa2 ');
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });
  it('gives partial credit + reports cer on single-char error (O vs 0)', () => {
    const r = serialsPack.score({ serial: 'ABC0EF' }, 'ABCOEF');
    expect(r.pass).toBe(false);
    expect(r.score).toBeGreaterThan(0.7);
    expect(r.detail?.cer).toBeCloseTo(1 / 6, 5);
  });
  it('scores 0 for a completely wrong serial', () => {
    const r = serialsPack.score({ serial: 'ALCLB491BAA2' }, 'XXXXXXXXXXXX');
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
  });
  it('scores 0 for a blank VLM response', () => {
    const r = serialsPack.score({ serial: 'ALCLB491BAA2' }, '');
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
  });
});

describe('serialsPack.buildPrompt', () => {
  it('embeds the image ref and asks for only the serial', () => {
    const req = serialsPack.buildPrompt({ id: 'x', imageRef: 'data:image/jpeg;base64,AAA', expected: {} });
    const content = req.messages[0].content as Array<{ type: string; text?: string }>;
    expect(content.some((c) => c.type === 'image_url')).toBe(true);
    expect(req.max_tokens).toBeGreaterThan(0);
    const textPart = content.find((c) => c.type === 'text');
    expect(textPart?.text).toMatch(/serial/i);
  });
  it('uses temperature 0 so golden runs are reproducible', () => {
    const req = serialsPack.buildPrompt({ id: 'x', imageRef: 'data:image/jpeg;base64,AAA', expected: {} });
    expect(req.temperature).toBe(0);
  });
});
