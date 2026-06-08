/**
 * ingestToQdrant.test.ts
 *
 * Verifies the embedding backend migration: WA-digest ingestion embeds via the
 * local Ollama-compatible endpoint (nomic-embed-text, 768-dim) — matching the
 * chat read side — instead of OpenAI, and upserts 768-dim vectors to Qdrant.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('fs', () => {
  const mod = {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '# Section One\nSome digest content.\n\n# Section Two\nMore content.'),
  };
  return { ...mod, default: mod };
});

import { ingestToQdrant } from './ingestToQdrant';

const DIM = 768;
const vec = () => Array.from({ length: DIM }, () => 0.01);

interface FetchCall {
  url: string;
  init: { headers?: Record<string, string>; body?: string };
}

function setupFetch(): FetchCall[] {
  const calls: FetchCall[] = [];
  global.fetch = vi.fn(async (url: string, init: FetchCall['init']) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/v1/embeddings')) {
      const body = JSON.parse(init.body as string);
      const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
      return {
        ok: true,
        json: async () => ({ data: inputs.map((_, index) => ({ embedding: vec(), index })) }),
      };
    }
    // Qdrant upsert
    return { ok: true, json: async () => ({ status: 'ok' }) };
  }) as unknown as typeof fetch;
  return calls;
}

describe('ingestToQdrant — local embedding backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.EMBED_URL;
    delete process.env.QDRANT_URL;
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('embeds via the local /v1/embeddings endpoint (nomic, no OpenAI, no auth header)', async () => {
    const calls = setupFetch();

    const result = await ingestToQdrant({
      filePath: '/tmp/digest.md',
      project: 'velocity',
      groupType: 'ops',
      date: '2026-06-03',
      messageCount: 10,
      photoCount: 0,
    });

    const embedCalls = calls.filter((c) => c.url.includes('/v1/embeddings'));
    expect(embedCalls.length).toBeGreaterThan(0);
    for (const c of embedCalls) {
      // local endpoint, never OpenAI
      expect(c.url).toBe('http://localhost:11435/v1/embeddings');
      expect(c.url).not.toContain('openai.com');
      // no bearer auth — local server needs none
      expect(c.init.headers?.Authorization).toBeUndefined();
      expect(JSON.parse(c.init.body as string).model).toBe('nomic-embed-text');
    }

    // Qdrant upsert carries 768-dim vectors (matches the collection)
    const upsertCall = calls.find((c) => c.url.includes('/collections/'));
    expect(upsertCall).toBeDefined();
    const points = JSON.parse(upsertCall!.init.body as string).points;
    expect(points[0].vector).toHaveLength(DIM);

    expect(result.chunksIngested).toBeGreaterThan(0);
  });

  it('rejects when ANY vector in a batch has the wrong dimension (not just the first)', async () => {
    // First vector correct (768), second truncated (767) — would slip past a
    // first-only guard. ingestToQdrant must throw.
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/v1/embeddings')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { embedding: vec(), index: 0 },
              { embedding: Array.from({ length: DIM - 1 }, () => 0.01), index: 1 },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ status: 'ok' }) };
    }) as unknown as typeof fetch;

    await expect(
      ingestToQdrant({
        filePath: '/tmp/digest.md',
        project: 'velocity',
        groupType: 'ops',
        date: '2026-06-03',
        messageCount: 2,
        photoCount: 0,
      }),
    ).rejects.toThrow(/Embedder returned 767-dim/);
  });

  it('does NOT require OPENAI_API_KEY (it is unset here and ingestion still runs)', async () => {
    setupFetch();
    const result = await ingestToQdrant({
      filePath: '/tmp/digest.md',
      project: 'velocity',
      groupType: 'ops',
      date: '2026-06-03',
      messageCount: 1,
      photoCount: 0,
    });
    expect(result.chunksIngested).toBeGreaterThan(0);
  });
});
