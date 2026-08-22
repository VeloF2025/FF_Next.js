// tests/unit/vlm-bench/golden-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { loadGolden } from '../../../scripts/vlm-bench/engine/goldenLoader';

let dir: string;
const IMAGE = Buffer.from('not-really-a-jpeg-but-bytes-are-bytes');

function write(cases: unknown): void {
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
}

const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
  fs.writeFileSync(path.join(dir, 'a.jpg'), IMAGE);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('loadGolden', () => {
  it('returns the cases when every hash matches', () => {
    write([{ id: 'a', imageRef: 'a.jpg', sha256: sha(IMAGE), expected: { step: 4 } }]);
    const cases = loadGolden(dir);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.expected).toEqual({ step: 4 });
  });

  it('hard-fails when an image no longer matches its sealed hash', () => {
    // The guard's whole purpose: a changed image means the run scores a
    // different dataset than the one it names, and that number then travels as
    // if it were comparable to earlier runs.
    write([{ id: 'a', imageRef: 'a.jpg', sha256: sha(IMAGE), expected: {} }]);
    fs.writeFileSync(path.join(dir, 'a.jpg'), Buffer.from('tampered'));
    expect(() => loadGolden(dir)).toThrow(/sha256 mismatch/);
  });

  it('hard-fails on an unsealed case rather than scoring it unverified', () => {
    write([{ id: 'a', imageRef: 'a.jpg', expected: {} }]);
    expect(() => loadGolden(dir)).toThrow(/not sealed/);
  });

  it('hard-fails when the image is missing', () => {
    write([{ id: 'b', imageRef: 'missing.jpg', sha256: sha(IMAGE), expected: {} }]);
    expect(() => loadGolden(dir)).toThrow(/missing image/);
  });

  it('names the offending case so a failure is actionable', () => {
    write([
      { id: 'ok', imageRef: 'a.jpg', sha256: sha(IMAGE), expected: {} },
      { id: 'bad-one', imageRef: 'a.jpg', sha256: 'f'.repeat(64), expected: {} },
    ]);
    expect(() => loadGolden(dir)).toThrow(/bad-one/);
  });
});
