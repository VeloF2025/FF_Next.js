/**
 * Route-level contract for the ticket WhatsApp reply.
 *
 * Rewritten for the #2276 contract. Before Phase 5 this route took a caller-supplied
 * `message` and sent it verbatim to a caller-supplied `toPhone`; both are now derived
 * server-side — the body from the approved template, the recipient from the ticket — so
 * the assertions that pinned the old free-form behaviour necessarily changed. What is
 * preserved unchanged is everything that was not about message content: the auth gates,
 * the 502-on-send-failure path, and the idempotent wa_message_logs insert.
 *
 * Two database layers are mocked because the route uses both: the guard reads through
 * `@/lib/db-pool`, while the DR lookup and the log insert still go through the Neon
 * shim. Mocking only the latter (as this file used to) leaves the guard talking to a
 * real pool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/modules/communications/whatsapp/send/waSendClient', () => ({ sendWhatsAppText: vi.fn() }));
vi.mock('@/lib/auth/app-router', () => ({ requireAuth: vi.fn() }));
const sqlMock = vi.fn().mockResolvedValue([]);
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }));
const { poolQueryMock } = vi.hoisted(() => ({ poolQueryMock: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: poolQueryMock }));

import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';
import { requireAuth } from '@/lib/auth/app-router';
import { POST } from '@/app/api/noc/tickets/[id]/whatsapp/reply/route';

const TEMPLATE_KEY = 'fault_logged_ack';
/** The subscriber number the ticket resolves to — sends go here, not to the body's toPhone. */
const TICKET_MSISDN = '27821234567';

function replyReq(body: unknown) {
  return new Request('https://x/api/noc/tickets/t1/whatsapp/reply', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const call = (body: unknown) =>
  POST(replyReq(body) as never, { params: Promise.resolve({ id: 't1' }) } as never);

/** A ticket whose every precondition passes, so tests can vary one thing at a time. */
function stubPreconditionsPass() {
  poolQueryMock.mockImplementation(async (text: string) => {
    if (text.includes('maintenance_tickets')) {
      return [{
        client_contact: TICKET_MSISDN,
        onemap_contact: null,
        fno: 'Vumatel',
        client_name: 'Thabo Mokoena',
        address: '12 Rose Street, Lawley',
        dr_number: 'DR123',
        logged_at: '2026-07-29 08:15',
        due_at: '2026-07-30 10:00',
        resolved_at: null,
      }];
    }
    if (text.includes('wa_subscriber_consent')) {
      return [{ msisdn: TICKET_MSISDN, status: 'granted', drop_number: 'DR123', source: 'fno_payload' }];
    }
    throw new Error(`unexpected query: ${text}`);
  });
}

const validBody = { toPhone: TICKET_MSISDN, templateKey: TEMPLATE_KEY, channel: 'cloud' };

beforeEach(() => {
  vi.clearAllMocks();
  sqlMock.mockResolvedValue([{ dr_number: 'DR123' }]);
  vi.mocked(requireAuth).mockResolvedValue([{ id: 'u1', role: 'admin' }, null] as never);
  vi.stubEnv('WA_APPROVED_TEMPLATE_KEYS', TEMPLATE_KEY);
  stubPreconditionsPass();
});
afterEach(() => vi.unstubAllEnvs());

describe('POST ticket whatsapp reply', () => {
  it('sends the rendered template and logs it tagged with the ticket DR', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.9' });

    const res = await call(validBody);
    const json = await res.json();

    const sent = vi.mocked(sendWhatsAppText).mock.calls[0]?.[0] as { toPhone: string; message: string; channel?: string };
    expect(sent.toPhone).toBe(TICKET_MSISDN);
    expect(sent.channel).toBe('cloud');
    // The approved copy, not a caller string.
    expect(sent.message).toContain('Hello Thabo Mokoena');
    expect(sent.message).not.toMatch(/\{\{\d+\}\}/);
    // ticket-DR lookup + the wa_message_logs insert
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(sqlMock.mock.calls[1]).toContain('DR123');
    expect(json).toMatchObject({ success: true, providerMessageId: 'wamid.9' });
  });

  it('never transmits caller-supplied text', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.9' });

    await call({ ...validBody, message: 'unapproved free text' });

    const sent = vi.mocked(sendWhatsAppText).mock.calls[0]?.[0] as { message: string };
    expect(sent.message).not.toContain('unapproved free text');
    // The audit row records what went out, not what was asked for.
    const [, ...values] = sqlMock.mock.calls[1] as [string[], ...unknown[]];
    expect(values).not.toContain('unapproved free text');
  });

  it('returns 401 when unauthenticated and never sends', async () => {
    vi.mocked(requireAuth).mockResolvedValue([null, NextResponse.json({ success: false }, { status: 401 })] as never);

    const res = await call(validBody);

    expect(res.status).toBe(401);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-manager role and never sends', async () => {
    vi.mocked(requireAuth).mockResolvedValue([{ id: 'u2', role: 'technician' }, null] as never);

    const res = await call(validBody);

    expect(res.status).toBe(403);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('allows a manager role to send', async () => {
    vi.mocked(requireAuth).mockResolvedValue([{ id: 'u3', role: 'manager' }, null] as never);
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.m' });

    const res = await call(validBody);

    expect(res.status).toBe(200);
    expect(sendWhatsAppText).toHaveBeenCalledOnce();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await call({ toPhone: TICKET_MSISDN });

    expect(res.status).toBe(400);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('ignores an unknown channel (falls back to the configured provider)', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'waha' });

    await call({ ...validBody, channel: 'bogus' });

    expect(vi.mocked(sendWhatsAppText).mock.calls[0]?.[0]?.channel).toBeUndefined();
  });

  it('returns 502 when the send fails', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: false, channel: 'waha', error: 'down', outcome: 'AMBIGUOUS' });

    const res = await call(validBody);

    expect(res.status).toBe(502);
    // Nothing logged: the message never went out, so there is no outbound row to write.
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('logs the provider_message_id via ON CONFLICT DO NOTHING so a re-logged send stays one row', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.9' });

    await call(validBody);

    const [strings, ...values] = sqlMock.mock.calls[1] as [string[], ...unknown[]];
    const text = strings.join('?').toUpperCase();
    expect(text).toContain('PROVIDER_MESSAGE_ID');
    expect(text).toContain('ON CONFLICT');
    expect(text).toContain('DO NOTHING');
    expect(values).toContain('wamid.9');
  });

  it('logs recipient_jid in the canonical form Cloud inbound stores', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.9' });

    // A differently-shaped toPhone is now only a mismatch check, never the recipient —
    // so this one still resolves to the ticket's subscriber.
    await call({ ...validBody, toPhone: '+27 82 123 4567' });

    const sent = vi.mocked(sendWhatsAppText).mock.calls[0]?.[0] as { toPhone: string };
    expect(sent.toPhone).toBe(TICKET_MSISDN);
    const [, ...values] = sqlMock.mock.calls[1] as [string[], ...unknown[]];
    expect(values).toContain(TICKET_MSISDN);
    expect(values).not.toContain('+27 82 123 4567');
  });

  it('refuses with 422 and never sends when consent is absent', async () => {
    poolQueryMock.mockImplementation(async (text: string) => {
      if (text.includes('maintenance_tickets')) {
        return [{
          client_contact: TICKET_MSISDN, onemap_contact: null, fno: 'Vumatel',
          client_name: 'Thabo Mokoena', address: '12 Rose Street', dr_number: 'DR123',
          logged_at: '2026-07-29 08:15', due_at: null, resolved_at: null,
        }];
      }
      return [];
    });

    const res = await call(validBody);

    expect(res.status).toBe(422);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
