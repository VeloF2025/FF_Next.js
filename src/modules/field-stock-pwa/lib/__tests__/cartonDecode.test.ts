/**
 * End-to-end decode regression: a photograph of a real Nokia G-0126G-A carton
 * label must still yield all nine serials through zxing-wasm + parseScanPayload.
 *
 * This is the guard on the boxScan fixtures — those are hand-typed strings, this
 * proves they are what the decoder actually produces.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { parseScanPayload } from '../boxScan';
import type { ScanPayload } from '../boxScan';

const FIXTURE = path.join(__dirname, 'fixtures', 'nokia-ont-carton-label.jpg');

const EXPECTED_SERIALS = [
  'ALCLB49486FF', 'ALCLB4948758', 'ALCLB4948779', 'ALCLB49488FC', 'ALCLB4949054',
  'ALCLB4949388', 'ALCLB4949DEF', 'ALCLB4949F2F', 'ALCLB4949F3C',
];

/**
 * Decode every symbol on the fixture and classify each payload.
 *
 * zxing-wasm renders ISO 15434 control bytes as Unicode Control Pictures
 * (U+241D/241E/2404) rather than raw bytes — normalise them back so the
 * envelope parser sees real separators, exactly as the extract endpoint does.
 */
async function payloadsFromFixture(): Promise<ScanPayload[]> {
  const { readBarcodes } = await import('zxing-wasm/full');
  const buf = await readFile(FIXTURE);
  const { data, info } = await sharp(buf).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const imageData = {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  } as unknown as ImageData;

  const results = await readBarcodes(imageData, {
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    maxNumberOfSymbols: 40,
  });

  return results.map((r) =>
    parseScanPayload(
      r.text.replace(/␝/g, '\x1d').replace(/␞/g, '\x1e').replace(/␄/g, '\x04'),
    ),
  );
}

describe('Nokia carton label decode', () => {
  it('yields all nine serials from the box DataMatrix', async () => {
    const boxes = (await payloadsFromFixture()).filter(
      (p): p is { kind: 'box'; serials: string[] } => p.kind === 'box',
    );

    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.serials).toEqual(EXPECTED_SERIALS);
  }, 60_000);

  it('yields the package-data code with a quantity matching the serial count', async () => {
    const pkg = (await payloadsFromFixture()).find((p) => p.kind === 'package-data');

    expect(pkg).toBeDefined();
    expect(pkg!.kind === 'package-data' && pkg!.quantity).toBe(EXPECTED_SERIALS.length);
  }, 60_000);
});
