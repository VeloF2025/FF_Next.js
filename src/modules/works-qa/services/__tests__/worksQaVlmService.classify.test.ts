vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { classifyPhotoToSlot } from '../worksQaVlmService';

const originalFetch = global.fetch;
afterAll(() => { global.fetch = originalFetch; });

function mockVlm(content: string) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  })) as unknown as typeof fetch;
}

function mockHttpError(status: number, body: string) {
  global.fetch = vi.fn(async () => ({
    ok: false,
    status,
    statusText: body,
    text: async () => body,
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

describe('classifyPhotoToSlot', () => {
  it('returns parsed slot + confidence for clean JSON', async () => {
    mockVlm('{"slot_key":"civil_03","confidence":0.87,"reasoning":"depth tape visible"}');
    const r = await classifyPhotoToSlot('http://x/y.jpg');
    expect(r.slot_key).toBe('civil_03');
    expect(r.confidence).toBeCloseTo(0.87);
    expect(r.reasoning).toBe('depth tape visible');
  });

  it('zeroes confidence when slot_key is unknown', async () => {
    mockVlm('{"slot_key":"banana_99","confidence":0.99,"reasoning":"nope"}');
    const r = await classifyPhotoToSlot('http://x/y.jpg');
    expect(r.slot_key).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('accepts null slot_key and clamps confidence', async () => {
    mockVlm('{"slot_key":null,"confidence":1.5,"reasoning":"unclear"}');
    const r = await classifyPhotoToSlot('http://x/y.jpg');
    expect(r.slot_key).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('falls back when response has no JSON', async () => {
    mockVlm('totally unparseable');
    const r = await classifyPhotoToSlot('http://x/y.jpg');
    expect(r.slot_key).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.reasoning).toMatch(/failed/);
  });

  it('falls back on HTTP error from VLM', async () => {
    mockHttpError(500, 'GPU OOM');
    const r = await classifyPhotoToSlot('http://x/y.jpg');
    expect(r.slot_key).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.reasoning).toMatch(/failed/);
  });

  it('strips think tags before JSON parsing', async () => {
    mockVlm('<think>let me look carefully</think>\n{"slot_key":"dome_02","confidence":0.71,"reasoning":"label visible"}');
    const r = await classifyPhotoToSlot('http://x/y.jpg');
    expect(r.slot_key).toBe('dome_02');
    expect(r.confidence).toBeCloseTo(0.71);
  });
});
