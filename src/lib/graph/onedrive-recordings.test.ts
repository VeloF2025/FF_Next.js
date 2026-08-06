/**
 * onedrive-recordings.test.ts
 *
 * Guards downloadDriveItem's memory behaviour.
 *
 * `Buffer.from(await response.arrayBuffer())` held each ENTIRE recording in memory
 * (one observed download was 138.9 MB). This file previously had no test at all, so
 * a revert to arrayBuffer() would have gone unnoticed — its only caller-side test
 * mocks downloadDriveItem wholesale.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'stream';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const graphFetch = vi.fn();
vi.mock('./auth', () => ({ graphFetch: (...a: unknown[]) => graphFetch(...a) }));
vi.mock('./auto-recording', () => ({ getInternalUsers: vi.fn() }));
vi.mock('@/lib/llm/meeting-processor', () => ({ processWithLLM: vi.fn() }));

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

import { downloadDriveItem } from './onedrive-recordings';

function webBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe('downloadDriveItem — streams instead of buffering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(written)) delete written[k];
    renames.length = 0;
    unlinked.length = 0;
  });

  it('streams the direct download URL to disk without calling arrayBuffer()', async () => {
    const arrayBuffer = vi.fn();
    graphFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ '@microsoft.graph.downloadUrl': 'https://cdn.example/file.mp4' }),
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: webBody([new Uint8Array([1, 2, 3, 4])]),
      arrayBuffer,
    }) as never;

    const size = await downloadDriveItem('user-1', 'item-1', '/tmp/x/out.mp4');

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(size).toBe(4);
    // direct downloadUrl is used unauthenticated, not routed back through graphFetch
    expect(global.fetch).toHaveBeenCalledWith('https://cdn.example/file.mp4');
    expect(graphFetch).toHaveBeenCalledTimes(1);
  });

  it('writes to .part and renames, never leaving a truncated mp4 at destPath', async () => {
    graphFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })            // no downloadUrl
      .mockResolvedValueOnce({ ok: true, body: webBody([new Uint8Array([7])]), arrayBuffer: vi.fn() });

    await downloadDriveItem('user-1', 'item-1', '/tmp/x/out.mp4');

    expect(renames).toEqual([['/tmp/x/out.mp4.part', '/tmp/x/out.mp4']]);
  });

  it('cleans up the .part file when the download fails mid-stream', async () => {
    graphFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ '@microsoft.graph.downloadUrl': 'https://cdn.example/file.mp4' }),
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(c) { c.enqueue(new Uint8Array([1])); c.error(new Error('connection reset')); },
      }),
      arrayBuffer: vi.fn(),
    }) as never;

    await expect(downloadDriveItem('u', 'i', '/tmp/x/out.mp4')).rejects.toThrow();
    expect(renames).toHaveLength(0);
    expect(unlinked).toContain('/tmp/x/out.mp4.part');
  });

  it('throws when the metadata lookup fails', async () => {
    graphFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(downloadDriveItem('u', 'i', '/tmp/x/out.mp4')).rejects.toThrow(/download URL: 404/);
  });
});
