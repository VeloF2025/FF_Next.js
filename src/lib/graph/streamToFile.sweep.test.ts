/**
 * Stale-partial sweep.
 *
 * The scratch name is unique per download, so a SIGKILL/OOM mid-stream leaves an
 * orphan behind. The old shared `<dest>.part` self-corrected (the next attempt
 * reused it); unique names would instead accumulate one orphan per crash on the
 * volume holding ~104GB of recordings.
 *
 * The sweep must be narrow: only this destination's partials, only ones old
 * enough to be dead, and it must never throw — a failed sweep must not fail the
 * download it was making room for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const files: Record<string, number> = {};   // name -> mtimeMs
const unlinked: string[] = [];
let readdirThrows = false;

vi.mock('fs', () => {
  const mod = {
    readdirSync: vi.fn(() => {
      if (readdirThrows) throw new Error('EACCES');
      return Object.keys(files);
    }),
    statSync: vi.fn((full: string) => {
      const name = full.split('/').pop()!;
      if (!(name in files)) throw new Error('ENOENT');
      return { mtimeMs: files[name]! };
    }),
    unlinkSync: vi.fn((full: string) => {
      const name = full.split('/').pop()!;
      unlinked.push(name);
      delete files[name];
    }),
  };
  return { ...mod, default: mod };
});

import { sweepStalePartials, STALE_PARTIAL_MS } from './streamToFile';

const NOW = 1_700_000_000_000;
const DEST = '/rec/2026/08/42.mp4';

describe('sweepStalePartials', () => {
  beforeEach(() => {
    for (const k of Object.keys(files)) delete files[k];
    unlinked.length = 0;
    readdirThrows = false;
    vi.clearAllMocks();
  });

  it('removes this destination\'s partials older than the cutoff', () => {
    files['42.mp4.111.aaaaaaaa.part'] = NOW - STALE_PARTIAL_MS - 1;

    expect(sweepStalePartials(DEST, NOW)).toBe(1);
    expect(unlinked).toEqual(['42.mp4.111.aaaaaaaa.part']);
  });

  it('leaves a partial that is still young — it may be a live download', () => {
    files['42.mp4.222.bbbbbbbb.part'] = NOW - 60_000;

    expect(sweepStalePartials(DEST, NOW)).toBe(0);
    expect(unlinked).toEqual([]);
  });

  it('never touches the finished recording or another meeting\'s partial', () => {
    files['42.mp4'] = NOW - STALE_PARTIAL_MS - 1;              // the real file
    files['43.mp4.333.cccccccc.part'] = NOW - STALE_PARTIAL_MS - 1; // another meeting

    expect(sweepStalePartials(DEST, NOW)).toBe(0);
    expect(unlinked).toEqual([]);
  });

  it('returns 0 instead of throwing when the directory cannot be read', () => {
    readdirThrows = true;

    expect(() => sweepStalePartials(DEST, NOW)).not.toThrow();
    expect(sweepStalePartials(DEST, NOW)).toBe(0);
  });
});
