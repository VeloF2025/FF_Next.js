vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log } from '@/lib/logger';
import { validatePhotoWithVlm, isVlmFallback, redactVlmKey } from '../worksQaVlmService';

/**
 * Regression test for the diagnosis blocker behind the 2026-07-21→27 VLM outage.
 *
 * The cron lost VLM_PROXY_SECRET, so every photo-proxy URL handed to vLLM 401'd and
 * vLLM answered HTTP 500 "401, message='Unauthorized'". The catch block logged
 * `{ slotKey, err }` — and an Error serialises to `{}`, because its properties are
 * non-enumerable. The result was 11 054 identical, information-free lines:
 *
 *   [ERROR] worksQaVlmService: fetch failed {"slotKey":"civil_07","err":{}}
 *
 * Nothing in that names the status, the 401, or even whether a socket opened, so a
 * total outage looked exactly like a flaky model and went unnoticed for six days.
 *
 * These tests pin the payload, not the prose: the status and reason must survive
 * into the log, an HTTP failure must stay distinguishable from a transport failure,
 * and the secret-bearing URL must never be logged verbatim.
 */
const PARAMS = {
  photoUrl: 'https://app.fibreflow.app/api/construction-qa/photo-proxy?key=x&source=qfield&vlm=true',
  slotKey: 'civil_07',
  stepLabel: 'Before Photo',
  vlmCheck: 'ground marked out',
};

function lastErrorPayload(): Record<string, unknown> {
  const calls = vi.mocked(log.error).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![1] as Record<string, unknown>;
}

describe('validatePhotoWithVlm error logging', () => {
  beforeEach(() => vi.mocked(log.error).mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it('logs the HTTP status and body when vLLM rejects the request', async () => {
    // The exact shape vLLM returned during the outage.
    const vllmBody = JSON.stringify({
      error: {
        message: "401, message='Unauthorized', url='https://app.fibreflow.app/api/construction-qa/photo-proxy?...'",
        type: 'InternalServerError',
        code: 500,
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve(vllmBody),
    }));

    const result = await validatePhotoWithVlm(PARAMS);

    expect(isVlmFallback(result)).toBe(true);
    const payload = lastErrorPayload();
    const message = String(payload.message);
    // The two facts that would have ended the outage in minutes.
    expect(message).toContain('500');
    expect(message).toContain('401');
    expect(payload.slotKey).toBe('civil_07');
  });

  it('logs name and cause when the socket never opens (transport failure)', async () => {
    const err = new TypeError('fetch failed');
    (err as Error & { cause?: unknown }).cause = new Error('connect ECONNREFUSED 100.96.203.105:8100');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));

    await validatePhotoWithVlm(PARAMS);

    const payload = lastErrorPayload();
    expect(payload.name).toBe('TypeError');
    // undici hides the real reason in `cause`; losing it is what made every
    // transport failure indistinguishable from every HTTP failure.
    expect(String(payload.cause)).toContain('ECONNREFUSED');
  });

  it('distinguishes a timeout from other failures', async () => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));

    await validatePhotoWithVlm(PARAMS);

    expect(lastErrorPayload().name).toBe('TimeoutError');
  });

  it('never logs the photo URL verbatim — it carries VLM_PROXY_SECRET', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    await validatePhotoWithVlm({
      ...PARAMS,
      photoUrl: `${PARAMS.photoUrl}&vlmkey=super-secret-value`,
    });

    const serialized = JSON.stringify(lastErrorPayload());
    expect(serialized).not.toContain('super-secret-value');
    expect(serialized).not.toContain('vlmkey=');
  });

  it('redacts the secret vLLM quotes back inside its own error body', async () => {
    // Verbatim shape observed live on 2026-07-27: vLLM could not read the image and
    // echoed the whole URL — secret included — into the message we then log. Not
    // logging photoUrl ourselves does not cover this path.
    const vllmBody = JSON.stringify({
      error: {
        message:
          "404, message='Not Found', url='https://app.fibreflow.app/api/construction-qa/" +
          "photo-proxy?key=projects/abc/files/DCIM/x.jpg&source=qfield&vlm=true" +
          "&vlmkey=bc338fa6448730d77cdf2a5601bac0799'",
        code: 500,
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve(vllmBody),
    }));

    await validatePhotoWithVlm(PARAMS);

    const serialized = JSON.stringify(lastErrorPayload());
    expect(serialized).not.toContain('bc338fa6448730d77cdf2a5601bac0799');
    expect(serialized).toContain('[REDACTED]');
    // The diagnostic value must survive the redaction.
    expect(serialized).toContain('404');
  });

  it('redactVlmKey scrubs every occurrence and keeps surrounding params', () => {
    expect(redactVlmKey('a?vlmkey=abc123&source=qfield')).toBe('a?vlmkey=[REDACTED]&source=qfield');
    expect(redactVlmKey("url='x?vlmkey=abc' and url='y?vlmkey=def'"))
      .toBe("url='x?vlmkey=[REDACTED]' and url='y?vlmkey=[REDACTED]'");
    expect(redactVlmKey('vlmkey=trailing')).toBe('vlmkey=[REDACTED]');
    expect(redactVlmKey('nothing to redact')).toBe('nothing to redact');
  });

  it('reports whether the URL was authorised — the outage signal itself', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    // Unauthorised: what the cron actually sent for six days.
    await validatePhotoWithVlm(PARAMS);
    expect(lastErrorPayload().photoUrlAuthorized).toBe(false);

    await validatePhotoWithVlm({ ...PARAMS, photoUrl: `${PARAMS.photoUrl}&vlmkey=abc` });
    expect(lastErrorPayload().photoUrlAuthorized).toBe(true);
  });
});
