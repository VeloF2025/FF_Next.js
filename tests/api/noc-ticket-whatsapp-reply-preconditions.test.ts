/**
 * #2276 — the outbound reply route must refuse a business-initiated send unless
 * consent, contact, FNO attribution and an approved template all hold.
 *
 * The assertion that matters in every blocked case is negative: the send client
 * was never called. A 422 on its own would also be produced by a route that
 * sent the message and then reported a failure, so the status code alone is not
 * evidence that nothing left the building.
 *
 * The real guard runs here against a stubbed database rather than being mocked
 * out, so these exercise the actual wiring from route to repository.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAuth, sendWhatsAppText, queryMock, loggerMock } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  sendWhatsAppText: vi.fn(),
  queryMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/app-router', () => ({ requireAuth }));
vi.mock('@/modules/communications/whatsapp/send/waSendClient', () => ({ sendWhatsAppText }));
vi.mock('@/lib/db-pool', () => ({ query: queryMock }));
vi.mock('@/lib/logger', () => ({ createLogger: () => loggerMock }));

const TICKET_ID = '11111111-2222-4333-8444-555555555555';
const APPROVED_KEY = 'fault_update';
const CONTACT_MSISDN = '27831112222';

type TicketRow = { client_contact: string | null; onemap_contact: string | null; fno: string | null };
type ConsentRow = { msisdn: string; status: string; drop_number: string | null; source: string };

const ticketRow = (over: Partial<TicketRow> = {}): TicketRow => ({
  client_contact: '083 111 2222',
  onemap_contact: null,
  fno: 'Vumatel',
  ...over,
});

const grantedConsent: ConsentRow = {
  msisdn: CONTACT_MSISDN, status: 'granted', drop_number: 'DR1234', source: 'fno_payload',
};

function stubDb(opts: { ticket?: TicketRow | null; consent?: ConsentRow | null }) {
  queryMock.mockImplementation(async (text: string) => {
    if (text.includes('maintenance_tickets')) {
      return opts.ticket ? [opts.ticket] : [];
    }
    if (text.includes('wa_subscriber_consent')) {
      return opts.consent ? [opts.consent] : [];
    }
    throw new Error(`unexpected query: ${text}`);
  });
}

function post(body: Record<string, unknown>) {
  return [
    { json: async () => body } as never,
    { params: Promise.resolve({ id: TICKET_ID }) } as never,
  ] as const;
}

const validBody = {
  toPhone: '083 111 2222',
  message: 'Your fault has been logged.',
  templateKey: APPROVED_KEY,
};

async function callRoute(body: Record<string, unknown> = validBody) {
  const { POST } = await import('@/app/api/noc/tickets/[id]/whatsapp/reply/route');
  return POST(...post(body));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WA_APPROVED_TEMPLATE_KEYS', APPROVED_KEY);
  requireAuth.mockResolvedValue([{ id: 'user-1', role: 'manager' }, undefined]);
  sendWhatsAppText.mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.1' });
});
afterEach(() => vi.unstubAllEnvs());

describe('POST reply — blocked sends never reach the provider', () => {
  it('does not send when the ticket has no contact number', async () => {
    stubDb({ ticket: ticketRow({ client_contact: null, onemap_contact: null }) });

    const res = await callRoute({ ...validBody, toPhone: '083 111 2222' });

    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      success: false, reasons: expect.arrayContaining(['no_contact_number']),
    });
  });

  it('does not send when no consent row exists', async () => {
    stubDb({ ticket: ticketRow(), consent: null });

    const res = await callRoute();

    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ reasons: ['no_consent'] });
  });

  it('does not send when consent was withdrawn', async () => {
    stubDb({ ticket: ticketRow(), consent: { ...grantedConsent, status: 'withdrawn' } });

    const res = await callRoute();

    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ reasons: ['consent_withdrawn'] });
  });

  it('does not send when the FNO is unresolved', async () => {
    stubDb({ ticket: ticketRow({ fno: null }), consent: grantedConsent });

    const res = await callRoute();

    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ reasons: ['fno_unresolved'] });
  });

  it('does not send a free-form message with no approved template', async () => {
    stubDb({ ticket: ticketRow(), consent: grantedConsent });

    const res = await callRoute({ toPhone: '083 111 2222', message: 'off the cuff' });

    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ reasons: ['no_approved_template'] });
  });

  it('does not send to a number that is not the ticket subscriber', async () => {
    stubDb({ ticket: ticketRow(), consent: grantedConsent });

    const res = await callRoute({ ...validBody, toPhone: '0849998888' });

    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ reasons: ['contact_mismatch'] });
  });

  it('does not send when the database fails', async () => {
    queryMock.mockRejectedValue(new Error('connection terminated'));

    const res = await callRoute();

    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ reasons: ['precondition_check_failed'] });
  });

  it('logs the structured reasons so ops can see why nothing was sent', async () => {
    stubDb({ ticket: ticketRow({ fno: null }), consent: null });

    await callRoute();

    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'outbound reply refused by preconditions',
      expect.objectContaining({
        ticketId: TICKET_ID,
        reasons: ['no_consent', 'fno_unresolved'],
      }),
    );
  });

  it('still rejects a non-manager before evaluating anything', async () => {
    requireAuth.mockResolvedValue([{ id: 'user-2', role: 'technician' }, undefined]);
    stubDb({ ticket: ticketRow(), consent: grantedConsent });

    const res = await callRoute();

    expect(res.status).toBe(403);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('POST reply — the permitted send', () => {
  it('sends to the MSISDN resolved from the ticket when all preconditions hold', async () => {
    stubDb({ ticket: ticketRow(), consent: grantedConsent });

    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppText).toHaveBeenCalledWith(
      expect.objectContaining({ toPhone: CONTACT_MSISDN, message: validBody.message }),
    );
  });
});
