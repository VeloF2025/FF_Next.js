/**
 * whisper-transcriber.test.ts
 *
 * Verifies the backend-selection cutover:
 *  - When WHISPER_REMOTE_URL is set, both passes hit the on-prem whisper.cpp
 *    /inference endpoint (af via language=af, en via translate=true) and NEVER
 *    OpenAI.
 *  - When WHISPER_REMOTE_URL is unset, it falls back to the OpenAI Whisper API.
 *  - When the remote IS configured but fails, it surfaces the error and does
 *    NOT silently fall back to OpenAI (which would resurrect OpenAI spend).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks (before import of the unit under test) ────────────────────────────
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ffmpeg/ffprobe are shelled out via execSync — no-op them so no real audio is
// processed. Returning '' is fine for the small-file (no-split) path.
vi.mock('child_process', () => {
  const execSync = vi.fn(() => '');
  const execFileSync = vi.fn(() => '');
  return { execSync, execFileSync, default: { execSync, execFileSync } };
});

// fs: small file (no chunk split), readable buffer, cleanup is a no-op.
vi.mock('fs', () => {
  const mod = {
    statSync: vi.fn(() => ({ size: 1000 })),
    readFileSync: vi.fn(() => Buffer.from('fake-audio')),
    existsSync: vi.fn(() => false),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
  return { ...mod, default: mod };
});

import { resolveRemoteTimeoutMs, transcribeWithWhisper } from './whisper-transcriber';

const DEFAULT_TIMEOUT_MS = 1_800_000;

const REMOTE = 'http://mac-mini:8009';

function verboseJson(text: string) {
  return {
    ok: true,
    json: async () => ({
      text,
      language: 'afrikaans',
      duration: 12,
      segments: [{ start: 0, end: 2, text }],
    }),
  };
}

/** Pull the FormData field from a recorded fetch() call. */
function fieldOf(call: unknown[], key: string): unknown {
  const init = call[1] as { body: FormData };
  return init.body.get(key);
}

describe('transcribeWithWhisper — backend selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WHISPER_REMOTE_URL;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    delete process.env.WHISPER_REMOTE_URL;
    delete process.env.OPENAI_API_KEY;
  });

  it('routes both passes to the on-prem /inference endpoint when WHISPER_REMOTE_URL is set', async () => {
    process.env.WHISPER_REMOTE_URL = REMOTE;
    process.env.OPENAI_API_KEY = 'sk-should-not-be-used';

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(verboseJson('goeie middag span'))   // af pass
      .mockResolvedValueOnce(verboseJson('good afternoon team')) // en pass
      ;

    const result = await transcribeWithWhisper('/recordings/x.mp4', 42);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);

    // every call goes to the on-prem server, never OpenAI
    for (const c of calls) {
      expect(c[0]).toBe(`${REMOTE}/inference`);
      expect(String(c[0])).not.toContain('openai.com');
    }
    // af pass sets language=af (no translate); en pass sets translate=true
    expect(fieldOf(calls[0], 'language')).toBe('af');
    expect(fieldOf(calls[0], 'translate')).toBeNull();
    expect(fieldOf(calls[1], 'translate')).toBe('true');
    expect(fieldOf(calls[1], 'response_format')).toBe('verbose_json');

    expect(result.afrikaansTranscript).toContain('goeie middag span');
    expect(result.englishTranscript).toContain('good afternoon team');
    expect(result.segmentCount).toBe(1);
  });

  it('falls back to the OpenAI Whisper API when WHISPER_REMOTE_URL is unset', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(verboseJson('afrikaans text'))
      .mockResolvedValueOnce(verboseJson('english text'));

    await transcribeWithWhisper('/recordings/x.mp4', 7);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(calls[1][0]).toBe('https://api.openai.com/v1/audio/translations');
  });

  it('resolveRemoteTimeoutMs falls back to the default for bad values (never NaN/0)', () => {
    // A NaN/0 timeout would make setTimeout(abort, ms) fire immediately.
    expect(resolveRemoteTimeoutMs('5000')).toBe(5000);
    expect(resolveRemoteTimeoutMs(undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveRemoteTimeoutMs('')).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveRemoteTimeoutMs('not-a-number')).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveRemoteTimeoutMs('0')).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveRemoteTimeoutMs('-1')).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('rejects when the remote returns a shape with no segments array', async () => {
    process.env.WHISPER_REMOTE_URL = REMOTE;
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ text: 'x', duration: 1 }) });

    await expect(transcribeWithWhisper('/recordings/x.mp4', 11)).rejects.toThrow(/unexpected shape/);
  });

  it('surfaces a remote failure WITHOUT falling back to OpenAI', async () => {
    process.env.WHISPER_REMOTE_URL = REMOTE;
    process.env.OPENAI_API_KEY = 'sk-should-not-be-used';

    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, text: async () => 'unavailable' });

    await expect(transcribeWithWhisper('/recordings/x.mp4', 9)).rejects.toThrow(/Remote whisper/);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    for (const c of calls) {
      expect(String(c[0])).not.toContain('openai.com');
    }
  });
});
