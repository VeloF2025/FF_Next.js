/**
 * recordings.test.ts
 *
 * Guards the memory fix: recordings must be STREAMED to disk, never buffered.
 *
 * `Buffer.from(await response.arrayBuffer())` held the entire MP4 in memory
 * (~100 MB+ each). On 2026-08-05, 75 concurrent downloads stalling against a slow
 * Graph endpoint exhausted production's 16 GB cgroup. If someone reintroduces
 * arrayBuffer() here, the first test below fails.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'stream';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const graphFetch = vi.fn();
vi.mock('./auth', () => ({ graphFetch: (...a: unknown[]) => graphFetch(...a) }));

const written: Record<string, Buffer[]> = {};
const renames: Array<[string, string]> = [];
const unlinked: string[] = [];

vi.mock('fs', () => {
  const mod = {
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn((p: string) => {
      written[p] = [];
      return new Writable({
        write(chunk, _enc, cb) { written[p]!.push(Buffer.from(chunk)); cb(); },
      });
    }),
    renameSync: vi.fn((a: string, b: string) => { renames.push([a, b]); }),
    unlinkSync: vi.fn((p: string) => { unlinked.push(p); }),
    statSync: vi.fn((p: string) => {
      const src = renames.find(([, to]) => to === p)?.[0] ?? p;
      return { size: (written[src] ?? []).reduce((n, b) => n + b.length, 0) };
    }),
  };
  return { ...mod, default: mod };
});

import { downloadRecordingToDisk } from './recordings';

/** A real web ReadableStream so the production `pipeline` path actually runs. */
function webBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe('downloadRecordingToDisk — streams instead of buffering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(written)) delete written[k];
    renames.length = 0;
    unlinked.length = 0;
    process.env.MEETING_RECORDINGS_PATH = '/tmp/test-recordings';
  });

  it('streams the body to disk and never calls arrayBuffer()', async () => {
    const arrayBuffer = vi.fn();
    graphFetch.mockResolvedValue({
      ok: true,
      body: webBody([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]),
      arrayBuffer,
    });

    const res = await downloadRecordingToDisk('user-1', 'meet-1', 'rec-1', 77);

    // The whole point: buffering the response is what caused the OOM.
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(res.sizeBytes).toBe(5);
    expect(res.filePath).toMatch(/77\.mp4$/);
  });

  it('writes to a .part file and renames, so an interruption leaves no truncated mp4', async () => {
    graphFetch.mockResolvedValue({
      ok: true,
      body: webBody([new Uint8Array([9])]),
      arrayBuffer: vi.fn(),
    });

    await downloadRecordingToDisk('user-1', 'meet-1', 'rec-1', 88);

    expect(renames).toHaveLength(1);
    const [from, to] = renames[0]!;
    // Scratch name is unique per download (pid + random) so concurrent
    // downloads of the same meeting cannot clobber each other's partial.
    expect(from).toMatch(new RegExp(`^${to.replace(/[.]/g, '\\.')}\\.\\d+\\.[0-9a-f]{8}\\.part$`));
    expect(to).toMatch(/88\.mp4$/);
  });

  it('gives each download a distinct .part path so concurrent writers cannot collide', async () => {
    // A fresh body per call — a single ReadableStream can only be consumed once.
    graphFetch.mockImplementation(async () => ({
      ok: true,
      body: webBody([new Uint8Array([9])]),
      arrayBuffer: vi.fn(),
    }));

    await downloadRecordingToDisk('user-1', 'meet-1', 'rec-1', 88);
    await downloadRecordingToDisk('user-1', 'meet-1', 'rec-1', 88);

    expect(renames).toHaveLength(2);
    const [firstFrom, firstTo] = renames[0]!;
    const [secondFrom, secondTo] = renames[1]!;
    expect(firstTo).toBe(secondTo);          // same final destination
    expect(firstFrom).not.toBe(secondFrom);  // but different scratch files
  });

  it('cleans up the .part file when the stream fails mid-download', async () => {
    const failing = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.error(new Error('connection reset'));
      },
    });
    graphFetch.mockResolvedValue({ ok: true, body: failing, arrayBuffer: vi.fn() });

    await expect(downloadRecordingToDisk('u', 'm', 'r', 99)).rejects.toThrow();
    expect(renames).toHaveLength(0);              // never promoted to the final path
    expect(unlinked.some((p) => p.endsWith('.part'))).toBe(true);
  });

  it('throws when the response carries no body', async () => {
    graphFetch.mockResolvedValue({ ok: true, body: null, arrayBuffer: vi.fn() });
    await expect(downloadRecordingToDisk('u', 'm', 'r', 100)).rejects.toThrow(/no body/);
  });
});
