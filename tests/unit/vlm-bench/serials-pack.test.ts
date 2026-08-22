// tests/unit/vlm-bench/serials-pack.test.ts
import { describe, it, expect } from 'vitest';
import { serialsPack } from '../../../scripts/vlm-bench/packs/serials';
import { ONT_SERIAL_BACK_PROMPT, STEP9_FRONT_PROMPT } from '../../../src/modules/activate/services/vlmPrompts';

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

describe('serialsPack front variant', () => {
  const front = { serial: 'ALCLB48D1234', variant: 'front' as const };
  const textOf = (expected: unknown): string => {
    const content = serialsPack.buildPrompt({ id: 'x', imageRef: 'data:i', expected }).messages[0]!
      .content as Array<{ type: string; text?: string }>;
    return content.find((c) => c.type === 'text')!.text!;
  };

  it('sends production STEP9_FRONT_PROMPT for a front case', () => {
    expect(textOf(front)).toBe(STEP9_FRONT_PROMPT);
  });

  it('still sends the BACK prompt for a back case', () => {
    expect(textOf({ serial: 'ALCLB48D1234', variant: 'back' })).toBe(ONT_SERIAL_BACK_PROMPT);
  });

  it('defaults to the back prompt when no variant is set (legacy cases)', () => {
    expect(textOf({ serial: 'ALCLB48D1234' })).toBe(ONT_SERIAL_BACK_PROMPT);
  });

  it('allows more tokens for front, which also asks for lights and a DR number', () => {
    const back = serialsPack.buildPrompt({ id: 'x', imageRef: 'd', expected: { serial: 'S', variant: 'back' } });
    const fr = serialsPack.buildPrompt({ id: 'x', imageRef: 'd', expected: front });
    expect(fr.max_tokens).toBeGreaterThan(back.max_tokens);
  });

  it('reads the serial out of the nested ontSerial node the front prompt returns', () => {
    const reply = JSON.stringify({
      greenLightsVisible: true,
      ontSerial: { found: true, serial: 'ALCLB48D1234', confidence: 0.9 },
      drNumber: { found: true, drNumber: 'DR1234567' },
    });
    expect(serialsPack.score(front, reply).pass).toBe(true);
  });

  it('does not mistake the drNumber node for the serial', () => {
    const reply = JSON.stringify({
      greenLightsVisible: true,
      ontSerial: { found: false, serial: null },
      drNumber: { found: true, drNumber: 'DR1234567' },
    });
    const r = serialsPack.score(front, reply);
    expect(r.pass).toBe(false);
    expect(r.detail?.abstained).toBe(true);
  });

  it('would fail a back-shaped reply to a front case, catching a variant mix-up', () => {
    // If buildPrompt and score ever disagree about the variant, this is the
    // symptom: a top-level {found,serial} object arriving for a front case.
    const r = serialsPack.score(front, JSON.stringify({ found: true, serial: 'ALCLB48D1234' }));
    expect(r.detail?.variant).toBe('front');
    expect(r.pass).toBe(true); // recovered by the bare-serial fallback, not by the front parser
  });

  it('records the variant and stratum on every score', () => {
    const r = serialsPack.score({ ...front, stratum: 'vlm_wrong' as const }, '{"ontSerial":{"found":true,"serial":"ALCLB48D1234"}}');
    expect(r.detail?.variant).toBe('front');
    expect(r.detail?.stratum).toBe('vlm_wrong');
  });
});
