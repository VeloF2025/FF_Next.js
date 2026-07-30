import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The WA leg must be mockable: dispatchBridgeAlert is expected to survive a dead
// bridge, which is the exact condition it exists to report.
const sendWhatsAppGroup = vi.fn();
vi.mock('@/modules/notifications/services/whatsappDelivery', () => ({
  sendWhatsAppGroup: (...args: unknown[]) => sendWhatsAppGroup(...args),
}));

const sendMail = vi.fn();
const createSmtpTransport = vi.fn();
vi.mock('@/lib/smtpConfig', () => ({
  createSmtpTransport: () => createSmtpTransport(),
}));

import { dispatchBridgeAlert } from './alert';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INFRA_ALERT_EMAIL_TO = 'ops@example.com';
  createSmtpTransport.mockReturnValue({ sendMail });
  sendMail.mockResolvedValue(undefined);
  sendWhatsAppGroup.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('dispatchBridgeAlert', () => {
  it('delivers on both channels when everything works', async () => {
    const { delivered, problems } = await dispatchBridgeAlert('subj', 'body');
    expect(delivered).toEqual(['email', 'whatsapp']);
    expect(problems).toEqual([]);
  });

  // The whole reason email is primary: during a real outage the WA leg is dead.
  it('still delivers email when the WhatsApp leg throws', async () => {
    sendWhatsAppGroup.mockRejectedValue(new Error('bridge unreachable'));
    const { delivered, problems } = await dispatchBridgeAlert('subj', 'body');
    expect(delivered).toEqual(['email']);
    expect(problems.some((p) => p.includes('bridge unreachable'))).toBe(true);
  });

  it('still attempts WhatsApp when the email leg throws', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));
    const { delivered } = await dispatchBridgeAlert('subj', 'body');
    expect(delivered).toEqual(['whatsapp']);
    expect(sendWhatsAppGroup).toHaveBeenCalledOnce();
  });

  it('reports nothing delivered when both channels fail, without throwing', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));
    sendWhatsAppGroup.mockRejectedValue(new Error('bridge unreachable'));
    const { delivered, problems } = await dispatchBridgeAlert('subj', 'body');
    expect(delivered).toEqual([]);
    expect(problems).toHaveLength(2);
  });

  it('treats unconfigured SMTP as "cannot send", not as success', async () => {
    createSmtpTransport.mockReturnValue(null);
    const { delivered, problems } = await dispatchBridgeAlert('subj', 'body');
    expect(delivered).toEqual(['whatsapp']);
    expect(problems.some((p) => p.includes('SMTP not configured'))).toBe(true);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('falls back to REPORT_ALERT_EMAIL_TO so an unset new var still alerts', async () => {
    delete process.env.INFRA_ALERT_EMAIL_TO;
    process.env.REPORT_ALERT_EMAIL_TO = 'fallback@example.com';
    await dispatchBridgeAlert('subj', 'body');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'fallback@example.com' }),
    );
  });

  it('skips email when no recipient is configured anywhere', async () => {
    delete process.env.INFRA_ALERT_EMAIL_TO;
    delete process.env.REPORT_ALERT_EMAIL_TO;
    const { delivered, problems } = await dispatchBridgeAlert('subj', 'body');
    expect(delivered).toEqual(['whatsapp']);
    expect(problems.some((p) => p.includes('not set'))).toBe(true);
  });

  // A hung SMTP socket must not stall the 5-minute cron into the next tick,
  // where it would race the handler's module-level debounce state.
  it('gives up on a hung SMTP send and reports it as a problem', async () => {
    vi.useFakeTimers();
    sendMail.mockReturnValue(new Promise(() => {})); // never settles

    const pending = dispatchBridgeAlert('subj', 'body');
    await vi.advanceTimersByTimeAsync(21_000);
    const { delivered, problems } = await pending;

    expect(delivered).toEqual(['whatsapp']);
    expect(problems.some((p) => p.includes('timed out'))).toBe(true);
    vi.useRealTimers();
  });

  it('gives up on a hung WhatsApp send without losing the email leg', async () => {
    vi.useFakeTimers();
    sendWhatsAppGroup.mockReturnValue(new Promise(() => {}));

    const pending = dispatchBridgeAlert('subj', 'body');
    await vi.advanceTimersByTimeAsync(21_000);
    const { delivered, problems } = await pending;

    expect(delivered).toEqual(['email']);
    expect(problems.some((p) => p.includes('timed out'))).toBe(true);
    vi.useRealTimers();
  });

  it('does not time out a send that completes in time', async () => {
    vi.useFakeTimers();
    sendMail.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1_000)),
    );

    const pending = dispatchBridgeAlert('subj', 'body');
    await vi.advanceTimersByTimeAsync(2_000);
    const { delivered, problems } = await pending;

    expect(delivered).toEqual(['email', 'whatsapp']);
    expect(problems).toEqual([]);
    vi.useRealTimers();
  });

  it('strips CR/LF from the subject so it cannot inject mail headers', async () => {
    await dispatchBridgeAlert('subj\r\nBcc: attacker@evil.com', 'body');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'subj Bcc: attacker@evil.com' }),
    );
  });
});
