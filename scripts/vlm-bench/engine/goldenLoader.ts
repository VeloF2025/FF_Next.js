// scripts/vlm-bench/engine/goldenLoader.ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { BenchCase } from '../types';

/**
 * Read a sealed golden manifest and verify every image against its sha256.
 *
 * The spec requires a hash mismatch to hard-fail the run rather than warn: a
 * benchmark whose images silently changed reports a score for a different
 * dataset than the one it names, and that number then travels as if it were
 * comparable to earlier runs.
 */
export function loadGolden(dir: string): BenchCase[] {
  const manifestPath = path.join(dir, 'cases.json');
  const cases = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BenchCase[];
  for (const c of cases) {
    if (!c.sha256) throw new Error(`golden case ${c.id} has no sha256 — manifest is not sealed`);
    const file = path.join(dir, c.imageRef);
    if (!fs.existsSync(file)) throw new Error(`golden case ${c.id}: missing image ${c.imageRef}`);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== c.sha256) {
      throw new Error(`golden case ${c.id}: sha256 mismatch for ${c.imageRef} (manifest ${c.sha256}, on disk ${actual})`);
    }
  }
  return cases;
}
