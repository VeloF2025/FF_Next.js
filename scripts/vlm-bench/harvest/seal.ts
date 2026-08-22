// scripts/vlm-bench/harvest/seal.ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { BenchCase } from '../types';

/** One selected case, before its image has been written to disk. */
export interface HarvestItem {
  /** http(s):// for the OneMap proxy, file:// for velo-local storage. */
  fetchUrl: string;
  filename: string;
  expected: Record<string, unknown>;
}

async function readImage(fetchUrl: string): Promise<Buffer> {
  if (fetchUrl.startsWith('file://')) {
    return fs.promises.readFile(fetchUrl.slice('file://'.length));
  }
  const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${fetchUrl}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface SealReport {
  cases: BenchCase[];
  failed: Array<{ id: string; reason: string }>;
}

/**
 * Download each image, write it beside cases.json, and seal the manifest.
 *
 * Cases whose image cannot be fetched are DROPPED, not written with a
 * placeholder: loadGolden hard-fails on a hash mismatch, so a manifest entry
 * without a real image would break every future run rather than skip one case.
 */
export async function seal(
  dir: string,
  idPrefix: string,
  items: readonly HarvestItem[],
): Promise<SealReport> {
  fs.mkdirSync(dir, { recursive: true });
  const cases: BenchCase[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const [i, item] of items.entries()) {
    const id = `${idPrefix}-${String(i + 1).padStart(4, '0')}`;
    const ext = path.extname(item.filename).toLowerCase() || '.jpg';
    const imageRef = `${id}${ext}`;
    try {
      const buf = await readImage(item.fetchUrl);
      if (buf.length === 0) throw new Error('empty image');
      fs.writeFileSync(path.join(dir, imageRef), buf);
      cases.push({
        id,
        imageRef,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        expected: item.expected,
      });
    } catch (e) {
      failed.push({ id, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  fs.writeFileSync(path.join(dir, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`);
  return { cases, failed };
}
