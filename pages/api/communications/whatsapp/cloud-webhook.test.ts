import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/modules/communications/whatsapp/config/waProviderConfig', () => ({
  getWaCloudCreds: vi.fn(),
}));
const sqlMock = vi.fn().mockResolvedValue([]);
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }));
// The global setup mock hands out fresh spies on every createLogger() call, so
// pin one stable logger instance here to assert on the ops-triage warnings.
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ createLogger: () => loggerMock }));
const { rateLimiterCheck } = vi.hoisted(() => ({
  rateLimiterCheck: vi.fn(() => ({ success: true, remaining: 4, resetAt: 0 })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  default: { check: (...args: unknown[]) => rateLimiterCheck(...args), reset: vi.fn() },
  RateLimits: { DR_PROBE: { limit: 5, windowMs: 10 * 60 * 1000 } },
}));

import { getWaCloudCreds } from '@/modules/communications/whatsapp/config/waProviderConfig';
import handler from './cloud-webhook';

const CREDS = { phoneNumberId: 'PN', accessToken: 'T', appSecret: 'SEC', verifyToken: 'VER' };

function mockRes() {
  const res: Partial<NextApiResponse> & { _status?: number; _body?: unknown } = {};
  res.status = vi.fn().mockImplementation((s: number) => { res._status = s; return res as NextApiResponse; });
  res.json = vi.fn().mockImplementation((b: unknown) => { res._body = b; return res as NextApiResponse; });
  res.send = vi.fn().mockImplementation((b: unknown) => { res._body = b; return res as NextApiResponse; });
  res.end = vi.fn();
  return res as NextApiResponse & { _status?: number; _body?: unknown };
}

function sign(rawBody: string, secret = 'SEC') {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

function mockPostReq(rawBody: string, headers: Record<string, string | undefined>) {
  return {
    method: 'POST',
    headers,
    async *[Symbol.asyncIterator]() { yield Buffer.from(rawBody, 'utf8'); },
  } as unknown as NextApiRequest;
}

const inboundPayload = (from: string, text: string) => JSON.stringify({
  entry: [{ changes: [{ value: { messages: [{ from, id: 'wamid.in', text: { body: text } }] } }] }],
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlMock.mockResolvedValue([]);
  rateLimiterCheck.mockReturnValue({ success: true, remaining: 4, resetAt: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe('GET cloud-webhook verify handshake', () => {
  it('echoes hub.challenge when the verify token matches', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const req = { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'VER', 'hub.challenge': '99' } } as unknown as NextApiRequest;
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toBe('99');
  });

  it('403s on token mismatch', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const req = { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'WRONG', 'hub.challenge': '99' } } as unknown as NextApiRequest;
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });
});

describe('POST cloud-webhook inbound', () => {
  it('persists a signature-valid inbound text message', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const raw = inboundPayload('27831112222', 'hello there');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, persisted: true });
    expect(sqlMock).toHaveBeenCalledOnce();
  });

  it('rejects a bad signature with 401 and does NOT touch the DB', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const raw = inboundPayload('27831112222', 'hello');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': 'sha256=deadbeef' }), res);
    expect(res._status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects a missing signature header with 401', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const raw = inboundPayload('27831112222', 'hello');
    const res = mockRes();
    await handler(mockPostReq(raw, {}), res);
    expect(res._status).toBe(401);
  });

  it('acks non-message payloads without persisting', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }] });
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, persisted: false });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns 400 on a signature-valid but non-JSON body', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const raw = 'not json';
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(400);
  });

  it('reports persisted:false (still 200) when the DB insert fails', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    sqlMock.mockRejectedValueOnce(new Error('db down'));
    const raw = inboundPayload('27831112222', 'hello');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, persisted: false });
  });

  it('500s when Cloud creds are not configured', async () => {
    vi.mocked(getWaCloudCreds).mockRejectedValue(new Error('not configured'));
    const raw = inboundPayload('27831112222', 'hello');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(500);
  });
});

describe('POST cloud-webhook status callbacks', () => {
  const statusPayload = (wamid: string, status: string) => JSON.stringify({
    entry: [{ changes: [{ value: { statuses: [{ id: wamid, status, recipient_id: '27831112222' }] } }] }],
  });

  it.each(['sent', 'delivered', 'read', 'failed'])(
    'updates wa_message_logs.status to "%s" keyed on the wamid',
    async (status) => {
      vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
      const raw = statusPayload('wamid.out', status);
      const res = mockRes();
      await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
      expect(res._status).toBe(200);
      expect(sqlMock).toHaveBeenCalledOnce();
      const [strings, ...values] = sqlMock.mock.calls[0] as [string[], ...unknown[]];
      const text = strings.join('?').toUpperCase();
      expect(text).toContain('UPDATE WA_MESSAGE_LOGS');
      expect(text).toContain('SET STATUS');
      expect(text).toContain('WHERE PROVIDER_MESSAGE_ID');
      expect(values).toContain(status);
      expect(values).toContain('wamid.out');
    },
  );

  it('ignores an unknown status value and does NOT touch the DB', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const raw = statusPayload('wamid.out', 'bogus');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('guards against status regression — the UPDATE only advances (monotonic)', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const raw = statusPayload('wamid.out', 'sent');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    const [strings, ...values] = sqlMock.mock.calls[0] as [string[], ...unknown[]];
    const text = strings.join('?').toUpperCase();
    // rank of the incoming status must exceed the row's current rank
    expect(text).toContain('CASE STATUS');
    expect(values).toContain(1); // rank('sent') = 1
  });

  it('applies status updates across multiple entries in one batched webhook', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const raw = JSON.stringify({
      entry: [
        { changes: [{ value: { statuses: [{ id: 'wamid.a', status: 'delivered' }] } }] },
        { changes: [{ value: { statuses: [{ id: 'wamid.b', status: 'read' }] } }] },
      ],
    });
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(res._body).toMatchObject({ ok: true, statuses: 2 });
  });
});

describe('POST cloud-webhook inbound → ticket DR linkage', () => {
  it('extracts a DR number from the text and stores it as drop_number so it joins the ticket feed', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    // Ticket lookup: the sender owns this DR, so the link is trusted.
    sqlMock.mockResolvedValueOnce([{ client_contact: '0831112222' }]);
    const raw = inboundPayload('27831112222', 'Hi, my line DR1853558 is down since morning');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    const [, ...values] = sqlMock.mock.calls[1] as [string[], ...unknown[]];
    expect(values).toContain('DR1853558');
  });

  it('stores a NULL drop_number when the text carries no DR number', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const raw = inboundPayload('27831112222', 'just a hello with no reference');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    const [, ...values] = sqlMock.mock.calls[0] as [string[], ...unknown[]];
    expect(values).toContain(null);
  });

  it('does not match a DR embedded inside another word (word boundary)', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    // "ADDR123456" ends in "dr123456" but is not a DR reference.
    const raw = inboundPayload('27831112222', 'the ADDR123456 field is wrong');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    const [, ...values] = sqlMock.mock.calls[0] as [string[], ...unknown[]];
    expect(values).not.toContain('DR123456');
    expect(values).toContain(null);
  });
});

describe('POST cloud-webhook inbound → sender verification', () => {
  const drPayload = (from: string) => inboundPayload(from, 'my line DR1853558 is down');

  async function post(raw: string) {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    return res;
  }

  // Located by statement rather than by index: an unusable sender short-circuits
  // before the ticket lookup, so the INSERT is not always the second call.
  function insertValues() {
    const call = sqlMock.mock.calls.find(([strings]) =>
      (strings as string[]).join('?').toUpperCase().includes('INSERT INTO WA_MESSAGE_LOGS'));
    if (!call) throw new Error('no INSERT into wa_message_logs was issued');
    const [, ...values] = call as [string[], ...unknown[]];
    return values;
  }

  it('looks the ticket up by dr_number before trusting a text-extracted DR', async () => {
    sqlMock.mockResolvedValueOnce([{ client_contact: '0831112222' }]);
    await post(drPayload('27831112222'));
    const [strings, ...values] = sqlMock.mock.calls[0] as [string[], ...unknown[]];
    const text = strings.join('?').toUpperCase();
    expect(text).toContain('FROM MAINTENANCE_TICKETS');
    expect(text).toContain('DR_NUMBER');
    expect(values).toContain('DR1853558');
  });

  it('sets drop_number when the sender phone matches the ticket contact', async () => {
    sqlMock.mockResolvedValueOnce([{ client_contact: '0831112222' }]);
    const res = await post(drPayload('27831112222'));
    expect(res._status).toBe(200);
    expect(insertValues()).toContain('DR1853558');
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('matches across differing phone formats on either side', async () => {
    sqlMock.mockResolvedValueOnce([{ client_contact: '+27 83 111 2222' }]);
    await post(drPayload('27831112222'));
    expect(insertValues()).toContain('DR1853558');
  });

  it('stores a NULL drop_number and warns when the sender is not the ticket contact', async () => {
    sqlMock.mockResolvedValueOnce([{ client_contact: '0849998888' }]);
    const res = await post(drPayload('27831112222'));
    expect(res._status).toBe(200);
    expect(insertValues()).not.toContain('DR1853558');
    expect(insertValues()).toContain(null);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ wamid: 'wamid.in', fromPhone: '27831112222', dr: 'DR1853558' }),
    );
  });

  it('stores a NULL drop_number and warns when no ticket carries that DR', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await post(drPayload('27831112222'));
    expect(insertValues()).not.toContain('DR1853558');
    expect(insertValues()).toContain(null);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('stores a NULL drop_number when the ticket contact holds no usable phone', async () => {
    sqlMock.mockResolvedValueOnce([{ client_contact: 'Sipho' }]);
    await post(drPayload('27831112222'));
    expect(insertValues()).not.toContain('DR1853558');
    expect(insertValues()).toContain(null);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('accepts the DR when any one of several tickets sharing it names the sender', async () => {
    sqlMock.mockResolvedValueOnce([
      { client_contact: 'Sipho' },
      { client_contact: null },
      { client_contact: '083 111 2222' },
    ]);
    await post(drPayload('27831112222'));
    expect(insertValues()).toContain('DR1853558');
  });

  it('fails closed — a ticket lookup error stores NULL and still persists the message', async () => {
    sqlMock.mockRejectedValueOnce(new Error('db down'));
    const res = await post(drPayload('27831112222'));
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, persisted: true });
    expect(insertValues()).not.toContain('DR1853558');
    expect(insertValues()).toContain(null);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('stores a NULL drop_number when the sender phone itself is unusable', async () => {
    await post(inboundPayload('12345', 'my line DR1853558 is down'));
    expect(insertValues()).not.toContain('DR1853558');
    expect(insertValues()).toContain(null);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('does not query tickets at all when the text carries no DR', async () => {
    await post(inboundPayload('27831112222', 'just checking in'));
    expect(sqlMock).toHaveBeenCalledOnce();
    const [strings] = sqlMock.mock.calls[0] as [string[], ...unknown[]];
    expect(strings.join('?').toUpperCase()).toContain('INSERT INTO WA_MESSAGE_LOGS');
  });
});

describe('POST cloud-webhook inbound → DR-probe rate limiting', () => {
  const drPayload = (from: string) => inboundPayload(from, 'my line DR1853558 is down');

  it('checks the rate limit keyed on the normalized sender before verifying', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    sqlMock.mockResolvedValueOnce([{ client_contact: '0831112222' }]);
    await handler(mockPostReq(drPayload('27831112222'), { 'x-hub-signature-256': sign(drPayload('27831112222')) }), mockRes());
    expect(rateLimiterCheck).toHaveBeenCalledWith('dr-probe:27831112222', 5, 10 * 60 * 1000);
  });

  it('fails closed and skips the ticket lookup entirely when the sender is over the limit', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    rateLimiterCheck.mockReturnValue({ success: false, remaining: 0, resetAt: 123456 });
    const raw = drPayload('27831112222');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, persisted: true });
    // Only the final INSERT ran — no maintenance_tickets lookup was attempted.
    expect(sqlMock).toHaveBeenCalledOnce();
    const [strings, ...values] = sqlMock.mock.calls[0] as [string[], ...unknown[]];
    expect(strings.join('?').toUpperCase()).toContain('INSERT INTO WA_MESSAGE_LOGS');
    expect(values).toContain(null); // drop_number stays unlinked
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringMatching(/rate limit/i),
      expect.objectContaining({ wamid: 'wamid.in', fromPhone: '27831112222', dr: 'DR1853558' }),
    );
  });

  it('does not rate-limit messages that carry no DR claim', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    rateLimiterCheck.mockReturnValue({ success: false, remaining: 0, resetAt: 123456 });
    const raw = inboundPayload('27831112222', 'just checking in, no reference');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    expect(rateLimiterCheck).not.toHaveBeenCalled();
  });

  it('resumes normal verification once the sender is back under the limit', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    // First message: sender is over the limit — fails closed.
    rateLimiterCheck.mockReturnValueOnce({ success: false, remaining: 0, resetAt: 123456 });
    const raw1 = drPayload('27831112222');
    await handler(mockPostReq(raw1, { 'x-hub-signature-256': sign(raw1) }), mockRes());
    expect(sqlMock).toHaveBeenCalledOnce(); // no ticket lookup on the blocked attempt

    // Second message: the window has reset — check() now reports success again.
    rateLimiterCheck.mockReturnValueOnce({ success: true, remaining: 4, resetAt: 0 });
    sqlMock.mockResolvedValueOnce([{ client_contact: '0831112222' }]);
    const raw2 = drPayload('27831112222');
    const res2 = mockRes();
    await handler(mockPostReq(raw2, { 'x-hub-signature-256': sign(raw2) }), res2);
    expect(res2._status).toBe(200);
    // Ticket lookup + INSERT both ran this time, and the DR was linked. Both
    // handler calls issue an INSERT, so take the LAST one (this call's).
    const insertCalls = sqlMock.mock.calls.filter(([strings]) =>
      (strings as string[]).join('?').toUpperCase().includes('INSERT INTO WA_MESSAGE_LOGS'));
    const lastInsert = insertCalls[insertCalls.length - 1];
    expect(lastInsert).toBeDefined();
    const [, ...values] = lastInsert as [string[], ...unknown[]];
    expect(values).toContain('DR1853558');
  });
});

describe('POST cloud-webhook inbound idempotency (wamid)', () => {
  it('inserts the wamid via ON CONFLICT DO NOTHING so a re-delivered message collapses to one row', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue(CREDS);
    const raw = inboundPayload('27831112222', 'hello there'); // wamid is 'wamid.in'
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, persisted: true });
    const [strings, ...values] = sqlMock.mock.calls[0] as [string[], ...unknown[]];
    const text = strings.join('?').toUpperCase();
    expect(text).toContain('PROVIDER_MESSAGE_ID');
    expect(text).toContain('ON CONFLICT');
    expect(text).toContain('DO NOTHING');
    expect(values).toContain('wamid.in');
  });
});
