/**
 * #2276 — the guard that makes the consent clause real.
 *
 * These mock at the database boundary rather than mocking the repositories, so
 * the contact extraction, the FNO null-vs-placeholder handling and the consent
 * status mapping are all really executed. Stubbing the repos would leave the
 * assertions describing the mocks instead of the code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: queryMock }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { evaluateOutboundPreconditions } from './outboundPreconditions';

const TICKET_ID = '11111111-2222-4333-8444-555555555555';
const APPROVED_KEY = 'fault_update';
const MSISDN = '27821234567';

type TicketRow = { client_contact: string | null; onemap_contact: string | null; fno: string | null };
type ConsentRow = { msisdn: string; status: string; drop_number: string | null; source: string };

const ticketRow = (over: Partial<TicketRow> = {}): TicketRow => ({
  client_contact: '083 111 2222',
  onemap_contact: null,
  fno: 'Vumatel',
  ...over,
});

const consentGranted: ConsentRow = {
  msisdn: '27831112222', status: 'granted', drop_number: 'DR1234', source: 'fno_payload',
};

/** Captures what the consent lookup was actually keyed on. */
let consentParams: unknown[] = [];

function stubDb(opts: { ticket?: TicketRow | null; consent?: ConsentRow | null }) {
  queryMock.mockImplementation(async (text: string, params: unknown[]) => {
    if (text.includes('maintenance_tickets')) {
      return opts.ticket === null || opts.ticket === undefined ? [] : [opts.ticket];
    }
    if (text.includes('wa_subscriber_consent')) {
      consentParams = params;
      return opts.consent ? [opts.consent] : [];
    }
    throw new Error(`unexpected query: ${text}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  consentParams = [];
  vi.stubEnv('WA_APPROVED_TEMPLATE_KEYS', APPROVED_KEY);
});
afterEach(() => vi.unstubAllEnvs());

describe('evaluateOutboundPreconditions', () => {
  it('allows the send when all four preconditions hold', async () => {
    stubDb({ ticket: ticketRow(), consent: consentGranted });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({
      allowed: true, msisdn: '27831112222', fno: 'Vumatel', templateKey: APPROVED_KEY,
    });
  });

  it('keys the consent lookup on the canonical MSISDN, not the raw contact field', async () => {
    stubDb({ ticket: ticketRow({ client_contact: '+27 83 111 2222' }), consent: consentGranted });

    await evaluateOutboundPreconditions({ ticketId: TICKET_ID, templateKey: APPROVED_KEY });

    expect(consentParams).toEqual(['27831112222']);
  });

  it('blocks when the ticket has no contact number anywhere', async () => {
    stubDb({ ticket: ticketRow({ client_contact: null, onemap_contact: null }) });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result.allowed).toBe(false);
    // Consent is reported alongside it: consent is keyed on the MSISDN, so with
    // no number there is no key and no row can exist.
    expect(result).toEqual({ allowed: false, reasons: ['no_contact_number', 'no_consent'] });
  });

  it('recovers the contact from the drop when the ticket carries none', async () => {
    stubDb({
      ticket: ticketRow({ client_contact: null, onemap_contact: '0821234567' }),
      consent: { ...consentGranted, msisdn: MSISDN },
    });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({
      allowed: true, msisdn: MSISDN, fno: 'Vumatel', templateKey: APPROVED_KEY,
    });
  });

  it('does not splice a street number onto the subscriber number', async () => {
    // The recorded gotcha: collapsing the whole field to digits yields
    // '50821234567', a plausible-length number belonging to nobody.
    stubDb({
      ticket: ticketRow({ client_contact: '5 Rose St, cell 0821234567' }),
      consent: { ...consentGranted, msisdn: MSISDN },
    });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({
      allowed: true, msisdn: MSISDN, fno: 'Vumatel', templateKey: APPROVED_KEY,
    });
    expect(consentParams).toEqual([MSISDN]);
  });

  it('blocks when no consent row exists for the number', async () => {
    stubDb({ ticket: ticketRow(), consent: null });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({ allowed: false, reasons: ['no_consent'] });
  });

  it('blocks when consent was withdrawn', async () => {
    stubDb({ ticket: ticketRow(), consent: { ...consentGranted, status: 'withdrawn' } });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({ allowed: false, reasons: ['consent_withdrawn'] });
  });

  it('blocks on an unrecognised consent status rather than reading it as permission', async () => {
    stubDb({ ticket: ticketRow(), consent: { ...consentGranted, status: 'pending' } });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({ allowed: false, reasons: ['no_consent'] });
  });

  it('blocks when the FNO cannot be resolved', async () => {
    stubDb({ ticket: ticketRow({ fno: null }), consent: consentGranted });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({ allowed: false, reasons: ['fno_unresolved'] });
  });

  it('blocks when no template key is supplied', async () => {
    stubDb({ ticket: ticketRow(), consent: consentGranted });

    const result = await evaluateOutboundPreconditions({ ticketId: TICKET_ID });

    expect(result).toEqual({ allowed: false, reasons: ['no_approved_template'] });
  });

  it('blocks a template key that is not on the approved list', async () => {
    stubDb({ ticket: ticketRow(), consent: consentGranted });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: 'made_up_key',
    });

    expect(result).toEqual({ allowed: false, reasons: ['no_approved_template'] });
  });

  it('blocks every send when the approved list is empty', async () => {
    vi.stubEnv('WA_APPROVED_TEMPLATE_KEYS', '');
    stubDb({ ticket: ticketRow(), consent: consentGranted });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({ allowed: false, reasons: ['no_approved_template'] });
  });

  it('blocks when the caller asks for a number that is not the ticket subscriber', async () => {
    stubDb({ ticket: ticketRow(), consent: consentGranted });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY, requestedPhone: '0849998888',
    });

    expect(result).toEqual({ allowed: false, reasons: ['contact_mismatch'] });
  });

  it('allows a requested number that matches the ticket in a different shape', async () => {
    stubDb({ ticket: ticketRow(), consent: consentGranted });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY, requestedPhone: '+27 83 111 2222',
    });

    expect(result.allowed).toBe(true);
  });

  it('reports every failed precondition, not only the first', async () => {
    vi.stubEnv('WA_APPROVED_TEMPLATE_KEYS', '');
    stubDb({ ticket: ticketRow({ client_contact: null, onemap_contact: null, fno: null }) });

    const result = await evaluateOutboundPreconditions({ ticketId: TICKET_ID });

    expect(result).toEqual({
      allowed: false,
      reasons: ['no_contact_number', 'no_consent', 'fno_unresolved', 'no_approved_template'],
    });
  });

  it('fails closed when the database throws', async () => {
    queryMock.mockRejectedValue(new Error('connection terminated'));

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({ allowed: false, reasons: ['precondition_check_failed'] });
  });

  it('fails closed when the consent lookup throws after the ticket read succeeded', async () => {
    queryMock.mockImplementation(async (text: string) => {
      if (text.includes('maintenance_tickets')) return [ticketRow()];
      throw new Error('consent read failed');
    });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({ allowed: false, reasons: ['precondition_check_failed'] });
  });

  it('fails closed when the ticket does not exist', async () => {
    stubDb({ ticket: null });

    const result = await evaluateOutboundPreconditions({
      ticketId: TICKET_ID, templateKey: APPROVED_KEY,
    });

    expect(result).toEqual({ allowed: false, reasons: ['precondition_check_failed'] });
  });
});
