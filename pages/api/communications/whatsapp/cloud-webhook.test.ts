import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/modules/communications/whatsapp/config/waProviderConfig', () => ({
  getWaCloudCreds: vi.fn(),
}));
const sqlMock = vi.fn().mockResolvedValue([]);
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }));

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

beforeEach(() => { vi.clearAllMocks(); sqlMock.mockResolvedValue([]); });
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
    const raw = inboundPayload('27831112222', 'Hi, my line DR1853558 is down since morning');
    const res = mockRes();
    await handler(mockPostReq(raw, { 'x-hub-signature-256': sign(raw) }), res);
    expect(res._status).toBe(200);
    const [, ...values] = sqlMock.mock.calls[0] as [string[], ...unknown[]];
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
