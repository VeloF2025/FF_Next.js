import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { computeDHash, hammingDistance } from '../imageHash';

/** Build a base64 PNG with a left→right brightness gradient or flat fill. */
async function pngB64(opts: { gradient?: boolean; flip?: boolean } = {}): Promise<string> {
  const w = 64, h = 64;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      let v = 128;
      if (opts.gradient) v = Math.round((x / (w - 1)) * 255);
      if (opts.flip) v = 255 - v;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  }
  const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return png.toString('base64');
}

describe('computeDHash', () => {
  it('returns a stable 16-hex-char hash', async () => {
    const h = await computeDHash(await pngB64({ gradient: true }));
    expect(h).not.toBeNull();
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic for the same image', async () => {
    const img = await pngB64({ gradient: true });
    expect(await computeDHash(img)).toBe(await computeDHash(img));
  });

  it('tolerates a data-URL prefix', async () => {
    const b64 = await pngB64({ gradient: true });
    expect(await computeDHash(`data:image/png;base64,${b64}`)).toBe(await computeDHash(b64));
  });

  it('returns null for undecodable input', async () => {
    expect(await computeDHash('not-an-image')).toBeNull();
  });
});

describe('hammingDistance', () => {
  it('is 0 for identical hashes', () => {
    expect(hammingDistance('abcdef0123456789', 'abcdef0123456789')).toBe(0);
  });

  it('counts differing bits', () => {
    // 0x0 vs 0x1 differ by one bit; rest identical.
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistance('0000000000000000', '000000000000000f')).toBe(4);
  });

  it('returns Infinity on length mismatch or garbage', () => {
    expect(hammingDistance('abcd', 'abcdef')).toBe(Infinity);
    expect(hammingDistance('', 'abcd')).toBe(Infinity);
  });

  it('ranks a near-identical image closer than an inverted one', async () => {
    const base = await computeDHash(await pngB64({ gradient: true }));
    const same = await computeDHash(await pngB64({ gradient: true }));
    const inverted = await computeDHash(await pngB64({ gradient: true, flip: true }));
    expect(base).not.toBeNull();
    expect(hammingDistance(base!, same!)).toBeLessThan(hammingDistance(base!, inverted!));
  });
});
