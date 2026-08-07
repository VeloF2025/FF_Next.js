/**
 * Covers the parts of the client that only exist because the portal is hostile:
 * the one-shot re-mint, the per-tick response cache, and the classification of
 * the three ways a request can fail (WAF challenge / dead token / contract
 * change). `fetchImpl` and `mintSession` are both injected, so none of this
 * touches the network.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHALLENGE_STATUS, IturanError, ituranClient } from '../client';

const OK_BODY = {
  ResultType: 'ALL_DATA',
  ErrorStr: 'OK',
  rows_data: {
    '1242358': {
      PlatformId: 1242358,
      Plate: 'KX82PLGP',
      Lat: -25.9742,
      Lon: 28.21489,
      LastSpeed: 0,
      Location_RowLocTime: '2026-08-07 10:26:54',
    },
  },
};

const WIDE_FROM = new Date('2026-08-01T00:00:00Z');
const WIDE_TO = new Date('2026-08-31T00:00:00Z');

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

/** A challenge reply: non-JSON HTML under the WAF's own status. */
function challenge(): Response {
  return new Response('<!DOCTYPE html><html><head><script>winsocks()</script></head></html>', {
    status: CHALLENGE_STATUS,
  });
}

function makeClient(responses: Response[], mint = vi.fn()) {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('fetchImpl called more times than the test queued');
    return next;
  });
  mint.mockImplementation(async () => ({ waapId: 'waap-value', passEnc: 'tok-abc' }));
  const client = ituranClient({
    baseUrl: 'https://portal.example',
    username: 'user',
    mintSession: mint,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, fetchImpl, mint };
}

describe('ituranClient session handling', () => {
  it('mints once and reuses the session for a clean tick', async () => {
    const { client, mint, fetchImpl } = makeClient([response(OK_BODY)]);
    await client.fetchPositions(WIDE_FROM, WIDE_TO);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-mints exactly once when the WAF rejects the cookie, then succeeds', async () => {
    const { client, mint, fetchImpl } = makeClient([challenge(), response(OK_BODY)]);
    const out = await client.fetchPositions(WIDE_FROM, WIDE_TO);
    expect(out).toHaveLength(1);
    expect(mint).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('re-mints when the token is dead (ErrorStr LoginError!, HTTP 203)', async () => {
    const { client, mint } = makeClient([
      response({ ResultType: 'ALL_DATA', ErrorStr: 'LoginError!', rows_data: {} }, 203),
      response(OK_BODY),
    ]);
    await client.fetchPositions(WIDE_FROM, WIDE_TO);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('gives up after ONE re-mint rather than hammering the portal', async () => {
    // A portal rejecting a freshly minted session twice is a credentials or
    // entitlement problem. Looping here is how the account gets locked out.
    const { client, mint, fetchImpl } = makeClient([challenge(), challenge()]);
    await expect(client.fetchPositions(WIDE_FROM, WIDE_TO)).rejects.toThrow(IturanError);
    expect(mint).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('raises an auth error whose message the alert classifier recognises', async () => {
    // pollProvider.isAuthFailure() matches on message text to decide between an
    // immediate WhatsApp and a silent-until-threshold transient. If this wording
    // drifts, a dead password degrades to a low-urgency alert.
    const { client } = makeClient([challenge(), challenge()]);
    await expect(client.fetchPositions(WIDE_FROM, WIDE_TO))
      .rejects.toThrow(/still rejected after re-mint/);
  });
});

describe('ituranClient failure classification', () => {
  it('throws on a genuine HTTP error instead of re-minting', async () => {
    const { client, mint } = makeClient([response('server exploded', 500)]);
    await expect(client.fetchPositions(WIDE_FROM, WIDE_TO)).rejects.toThrow(/HTTP 500/);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('throws — never returns empty — when rows_data is missing', async () => {
    // An empty vehicle list is treated by reconcileTrackers as a fetch failure,
    // but a MISSING key is a contract change. Returning [] here would look like
    // a legitimately empty account.
    const { client } = makeClient([response({ ResultType: 'ALL_DATA', ErrorStr: 'OK' })]);
    await expect(client.listVehicles()).rejects.toThrow(/expected rows_data/);
  });

  it('does not retry a shape error — it is not a credentials problem', async () => {
    const { client, mint } = makeClient([response({ ErrorStr: 'OK', rows_data: null })]);
    await expect(client.listVehicles()).rejects.toThrow(IturanError);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('treats a non-JSON body as a rejected session, not as an empty account', async () => {
    const { client, mint } = makeClient([response('<html>nope</html>'), response(OK_BODY)]);
    await client.listVehicles();
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('wraps a network failure as an IturanError rather than leaking it raw', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); });
    const client = ituranClient({
      baseUrl: 'https://portal.example',
      username: 'user',
      mintSession: async () => ({ waapId: 'w', passEnc: 't' }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.fetchPositions(WIDE_FROM, WIDE_TO)).rejects.toThrow(/ituran\/network/);
  });
});

describe('ituranClient request shape', () => {
  it('sends only waap_id, and asks for a full snapshot', async () => {
    const { client, fetchImpl } = makeClient([response(OK_BODY)]);
    await client.fetchPositions(WIDE_FROM, WIDE_TO);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    // The ASP.NET session cookie is deliberately not sent — auth is PassEnc.
    expect(headers.Cookie).toBe('waap_id=waap-value');
    expect(headers.Cookie).not.toMatch(/Iweb_SSID/);

    const body = String(init.body);
    expect(body).toContain('PassEnc=tok-abc');
    // Anything else returns only changed vehicles inside a map rectangle.
    // URLSearchParams encodes the space as '+', which is byte-identical to what
    // the portal's own app sends.
    expect(body).toContain('LastDataTimeStamp=not+initialized');
    expect(body).not.toContain('OnlyDifferences');
    expect(body).not.toContain('MaxLat');
  });

  it('serves all three consumers from ONE request per tick', async () => {
    // Three POSTs per tick against a partner-owned account is both wasteful and
    // a good way to look like a scraper.
    const { client, fetchImpl } = makeClient([response(OK_BODY)]);
    await client.listVehicles();
    await client.fetchPositions(WIDE_FROM, WIDE_TO);
    await client.feedFreshness();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('redactSecrets', () => {
  it('scrubs credentials out of text bound for the DB, logs and WhatsApp alerts', async () => {
    // A failed login's page text becomes the thrown message, which lands in
    // fleet_tracking_watermarks.last_error, log.error, and the alert detail
    // forwarded to FLEET_ALERT_USER_IDS. A WebForms page that echoed the
    // submitted form would publish the password to all four sinks.
    const { redactSecrets } = await import('../session');
    expect(redactSecrets('Login failed for BlitzFibre / hunter2secret', ['BlitzFibre', 'hunter2secret']))
      .toBe('Login failed for [redacted] / [redacted]');
  });

  it('leaves text alone when the secret is absent', async () => {
    const { redactSecrets } = await import('../session');
    expect(redactSecrets('Incorrect user name or password', ['BlitzFibre', 'hunter2secret']))
      .toBe('Incorrect user name or password');
  });

  it('skips short secrets rather than blanking unrelated text', async () => {
    // Redacting a 2-character password would destroy the diagnostic it is
    // meant to protect.
    const { redactSecrets } = await import('../session');
    expect(redactSecrets('an ordinary sentence', ['an', undefined])).toBe('an ordinary sentence');
  });
});
