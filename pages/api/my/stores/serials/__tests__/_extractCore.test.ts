/**
 * _extractCore — serial extraction pipeline units.
 *
 * Barcode tests write a real Code128/DataMatrix with zxing-wasm's writer and
 * decode it back — no image fixtures, no mocked decoder (DGTS-proof).
 *
 * Implementation note: zxing-wasm's writeBarcode returns `image` as a Blob,
 * but in the vitest/jsdom environment the Blob polyfill does not expose
 * `.arrayBuffer()`. We use `symbol.data` (grayscale Uint8ClampedArray) +
 * sharp to produce a real PNG buffer instead — same decode path, no fixture.
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  decodeSerialFromImage,
  decodeSerialsFromImage,
  validateSerialCandidate,
  parseVlmSerialResponse,
} from '../_extractCore';

/** Convert a zxing-wasm symbol (grayscale pixels) to a PNG Buffer. */
async function symbolToPng(symbol: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): Promise<Buffer> {
  return sharp(Buffer.from(symbol.data), {
    raw: { width: symbol.width, height: symbol.height, channels: 1 },
  })
    .png()
    .toBuffer();
}

describe('decodeSerialFromImage', () => {
  it('decodes a Code128 Gizzu serial from PNG bytes', async () => {
    const { writeBarcode } = await import('zxing-wasm/full');
    const written = await writeBarcode('GU18W12V2599990001', { format: 'Code128' });
    const buf = await symbolToPng(written.symbol!);
    expect(await decodeSerialFromImage(buf)).toBe('GU18W12V2599990001');
  });

  it('unwraps an ISO 15434 DataMatrix envelope to the bare serial', async () => {
    const { writeBarcode } = await import('zxing-wasm/full');
    const payload = '[)>\x1e06\x1d1P3TN01414BA\x1dSALCLB4918842\x1e\x04';
    const written = await writeBarcode(payload, { format: 'DataMatrix' });
    const buf = await symbolToPng(written.symbol!);
    expect(await decodeSerialFromImage(buf)).toBe('ALCLB4918842');
  });

  it('returns null for a non-barcode image', async () => {
    const blank = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#888888' },
    })
      .jpeg()
      .toBuffer();
    expect(await decodeSerialFromImage(blank)).toBeNull();
  });
});

describe('validateSerialCandidate', () => {
  it.each([
    ['ALCLB4918842', 'ont'],
    ['GU18W12V2512041330', 'gizzu'],
  ])('accepts %s as %s', (serial, family) => {
    expect(validateSerialCandidate(serial)).toEqual({ serial, family });
  });

  it('accepts a generic S/N-looking value with family generic', () => {
    expect(validateSerialCandidate('AB12-CD3456')).toEqual({ serial: 'AB12-CD3456', family: 'generic' });
  });

  it.each([
    [''], ['ALHN-1234'], ['x'],
    ['ALCLB4923FA8'], // VLM prompt example — hallucination guard
    ['STN1234567'], ['3TN01414BA'],
    // Near-miss rejections: family prefix present but wrong length → mis-read, not generic
    ['ALCLB4918842A'],   // 13 chars — one extra
    ['ALCLB491884'],     // 11 chars — one short
    ['GU18W12V251204133'], // 17 chars — one short
  ])('rejects %s', (bad) => {
    expect(validateSerialCandidate(bad)).toBeNull();
  });

  it('uppercases and trims input', () => {
    expect(validateSerialCandidate('  alclb4918842 ')).toEqual({
      serial: 'ALCLB4918842',
      family: 'ont',
    });
  });
});

describe('parseVlmSerialResponse', () => {
  it('parses a fenced JSON answer', () => {
    expect(
      parseVlmSerialResponse(
        '```json\n{"serial":"GU18W12V2512041330","confidence":0.93}\n```',
      ),
    ).toEqual({ serial: 'GU18W12V2512041330', confidence: 0.93 });
  });

  it('returns null serial on NOT_FOUND style answer', () => {
    expect(parseVlmSerialResponse('{"serial":null,"confidence":0}')).toEqual({
      serial: null,
      confidence: 0,
    });
  });

  it('returns null on non-JSON garbage', () => {
    expect(parseVlmSerialResponse('I cannot see a serial')).toBeNull();
  });

  it('clamps confidence > 1 down to 1', () => {
    expect(
      parseVlmSerialResponse('{"serial":"GU18W12V2512041330","confidence":1.5}'),
    ).toEqual({ serial: 'GU18W12V2512041330', confidence: 1 });
  });
});

/**
 * Carton labels: one photo of a Nokia box yields every serial inside it.
 *
 * NOTE: ALCLB4923FA8 is in PROMPT_EXAMPLE_SERIALS (a VLM hallucination guard)
 * and is therefore rejected by validateSerialCandidate — never use it here.
 */
describe('decodeSerialsFromImage — carton labels', () => {
  const BOX_SERIALS = [
    'ALCLB49486FF', 'ALCLB4948758', 'ALCLB4948779', 'ALCLB49488FC', 'ALCLB4949054',
    'ALCLB4949388', 'ALCLB4949DEF', 'ALCLB4949F2F', 'ALCLB4949F3C',
  ];

  async function pngFor(payload: string, format = 'DataMatrix'): Promise<Buffer> {
    const { writeBarcode } = await import('zxing-wasm/full');
    const written = await writeBarcode(payload, { format });
    return symbolToPng(written.symbol!);
  }

  it('returns all nine serials from a carton box DataMatrix', async () => {
    expect(await decodeSerialsFromImage(await pngFor(BOX_SERIALS.join(';')))).toEqual(BOX_SERIALS);
  });

  it('returns a one-element list for a single-unit ISO envelope', async () => {
    const payload = '[)>\x1e06\x1d1P3TN01414BA\x1dSALCLB4918842\x1e\x04';
    expect(await decodeSerialsFromImage(await pngFor(payload))).toEqual(['ALCLB4918842']);
  });

  it('returns an empty list when nothing decodes', async () => {
    const blank = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#888888' },
    }).jpeg().toBuffer();
    expect(await decodeSerialsFromImage(blank)).toEqual([]);
  });

  it('drops carton members that fail the serial-family check', async () => {
    // 3TN… is a part number, explicitly rejected by validateSerialCandidate.
    const buf = await pngFor('ALCLB49486FF;3TN01414BA;ALCLB4948758');
    expect(await decodeSerialsFromImage(buf)).toEqual(['ALCLB49486FF', 'ALCLB4948758']);
  });

  it('keeps decodeSerialFromImage returning just the first serial', async () => {
    expect(await decodeSerialFromImage(await pngFor(BOX_SERIALS.join(';')))).toBe('ALCLB49486FF');
  });
});
