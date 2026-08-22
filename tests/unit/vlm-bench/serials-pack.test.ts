// tests/unit/vlm-bench/serials-pack.test.ts
import { describe, it, expect } from 'vitest';
import { serialsPack } from '../../../scripts/vlm-bench/packs/serials';
import { ONT_SERIAL_BACK_PROMPT } from '../../../src/modules/activate/services/vlmPrompts';

const reply = (o: Record<string, unknown>): string => JSON.stringify(o);

describe('serialsPack.score', () => {
  it('passes on exact match after normalisation', () => {
    const r = serialsPack.score(
      { serial: 'ALCLB491BAA2' },
      reply({ found: true, serial: ' alclb-491 baa2 ', confidence: 0.9 }),
    );
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });

  it('gives partial credit + reports cer on a single-char error', () => {
    const r = serialsPack.score(
      { serial: 'ALCLB48D1234' },
      reply({ found: true, serial: 'ALCLB48D1235' }),
    );
    expect(r.pass).toBe(false);
    expect(r.score).toBeGreaterThan(0.7);
    expect(r.detail?.cer).toBeCloseTo(1 / 12, 5);
  });

  it('scores 0 for a completely wrong serial', () => {
    const r = serialsPack.score({ serial: 'ALCLB491BAA2' }, reply({ found: true, serial: 'XXXXXXXXXXXX' }));
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
  });

  it('marks found:false as an abstention, not a wrong answer', () => {
    const r = serialsPack.score({ serial: 'ALCLB491BAA2' }, reply({ found: false, serial: null }));
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
    expect(r.detail?.abstained).toBe(true);
    expect(r.detail?.got).toBeNull();
  });

  it('does not credit the SSID field when the model reads the wrong label', () => {
    // Nokia backs carry S/N and SSID; picking SSID is the failure the production
    // prompt exists to prevent, so it must score as a miss, never as an abstention.
    const r = serialsPack.score({ serial: 'ALCLB48D1234' }, reply({ found: true, serial: 'ALHN-C397' }));
    expect(r.pass).toBe(false);
    expect(r.detail?.abstained).toBe(false);
  });

  it('recovers the serial from a truncated, unfenced reply', () => {
    const r = serialsPack.score({ serial: 'ALCLB48D1234' }, '{"found": true, "serial": "ALCLB48D1234", "rawTe');
    expect(r.pass).toBe(true);
  });

  it('scores 0 for a blank VLM response', () => {
    const r = serialsPack.score({ serial: 'ALCLB491BAA2' }, '');
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
  });
});

describe('serialsPack.buildPrompt', () => {
  const req = serialsPack.buildPrompt({ id: 'x', imageRef: 'data:image/jpeg;base64,AAA', expected: {} });
  const content = req.messages[0]!.content as Array<{ type: string; text?: string }>;

  it('sends production ONT_SERIAL_BACK_PROMPT verbatim, not a fork', () => {
    const textPart = content.find((c) => c.type === 'text');
    expect(textPart?.text).toBe(ONT_SERIAL_BACK_PROMPT);
  });

  it('embeds the image ref', () => {
    expect(content.some((c) => c.type === 'image_url')).toBe(true);
  });

  it('allows enough tokens for the JSON object the prompt asks for', () => {
    // The production prompt demands {found, serial, rawText, confidence}; the old
    // 40-token ceiling truncated that mid-object and scored every case as a miss.
    expect(req.max_tokens).toBeGreaterThanOrEqual(150);
  });

  it('uses temperature 0 so golden runs are reproducible', () => {
    expect(req.temperature).toBe(0);
  });
});
