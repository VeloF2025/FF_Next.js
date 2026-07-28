import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The WA leg must be mocked: sendFailureAlert is expected to survive a dead
// bridge (that is the incident it exists for), and a real fetch would hit the
// production bridge from the test run.
const sendWhatsAppGroup = vi.fn();
vi.mock('@/modules/notifications/services/whatsappDelivery', () => ({
  sendWhatsAppGroup: (...args: unknown[]) => sendWhatsAppGroup(...args),
}));

// Stubbed at the seam alert.ts actually depends on, so the email leg — the
// primary channel — is exercised for real rather than only through its "SMTP
// not configured" short-circuit. (Mocking 'nodemailer' itself does not work:
// createSmtpTransport reaches it via a CJS require() that vi.mock cannot
// intercept.) createSmtpTransport's own env branch is covered in
// src/lib/__tests__/smtpConfig.test.ts.
const sendMail = vi.fn();
let smtpAvailable = true;
vi.mock('@/lib/smtpConfig', () => ({
  createSmtpTransport: () => (smtpAvailable ? { sendMail } : null),
}));

import { collectFailures, buildAlert, sendFailureAlert } from './alert';

const base = {
  cohortDate: '2026-07-27',
  generatedDate: '2026-07-28',
  groups: [
    { groupName: 'Lawley', sent: true },
    { groupName: 'Mohadin', sent: true },
  ],
  ops: { totalNotFound: 439, sent: true },
};

describe('collectFailures', () => {
  it('returns nothing when every send succeeded', () => {
    expect(collectFailures(base)).toEqual([]);
  });

  it('reports each group whose send failed', () => {
    const failures = collectFailures({
      ...base,
      groups: [
        { groupName: 'Lawley', sent: false, error: 'fetch failed' },
        { groupName: 'Mohadin', sent: true },
      ],
    });
    expect(failures).toEqual([{ target: 'Lawley', error: 'fetch failed' }]);
  });

  it('does not invent an error string when the group failed without one', () => {
    const failures = collectFailures({
      ...base,
      groups: [{ groupName: 'Lawley', sent: false }],
    });
    expect(failures).toHaveLength(1);
    expect(failures[0].error).toBe('unknown error');
  });

  it('reports the ops worklist when it had rows but did not send', () => {
    const failures = collectFailures({
      ...base,
      ops: { totalNotFound: 439, sent: false, error: 'fetch failed' },
    });
    expect(failures).toEqual([
      { target: 'Unresolved PP ops worklist', error: 'fetch failed' },
    ]);
  });

  // The regression this guards: with zero unresolved serials the service
  // intentionally skips the ops send and leaves sent=false. That is a no-op,
  // not a failure — treating it as one would alert every quiet day.
  it('does NOT report the ops worklist when there was nothing to send', () => {
    expect(collectFailures({ ...base, ops: { totalNotFound: 0, sent: false } })).toEqual([]);
  });

  it('reports groups and ops together', () => {
    const failures = collectFailures({
      ...base,
      groups: [
        { groupName: 'Lawley', sent: false, error: 'boom' },
        { groupName: 'Mohadin', sent: true },
      ],
      ops: { totalNotFound: 12, sent: false, error: 'bang' },
    });
    expect(failures.map((f) => f.target)).toEqual(['Lawley', 'Unresolved PP ops worklist']);
  });
});

describe('buildAlert', () => {
  it('returns null when there is nothing to report', () => {
    expect(buildAlert(base, [])).toBeNull();
  });

  it('states how many of the run’s sends failed, and the cohort date', () => {
    const outcome = {
      ...base,
      groups: [
        { groupName: 'Lawley', sent: false, error: 'fetch failed' },
        { groupName: 'Mohadin', sent: true },
      ],
    };
    const alert = buildAlert(outcome, collectFailures(outcome));
    expect(alert).not.toBeNull();
    // 3 targets total (2 groups + ops), 1 failed.
    expect(alert!.subject).toContain('1 of 3');
    expect(alert!.subject).toContain('2026-07-27');
    expect(alert!.text).toContain('Lawley');
    expect(alert!.text).toContain('fetch failed');
  });

  it('does not count the ops worklist as a target when it had no rows', () => {
    const outcome = {
      ...base,
      groups: [{ groupName: 'Lawley', sent: false, error: 'x' }],
      ops: { totalNotFound: 0, sent: false },
    };
    const alert = buildAlert(outcome, collectFailures(outcome));
    expect(alert!.subject).toContain('1 of 1');
  });
});

describe('sendFailureAlert', () => {
  const env = { ...process.env };

  const failingRun = {
    ...base,
    groups: [{ groupName: 'Lawley', sent: false, error: 'fetch failed' }],
  };

  /** Minimum env + transport for the email leg to actually attempt a send. */
  function configureSmtp() {
    smtpAvailable = true;
    process.env.SMTP_USER = 'ops@example.test';
    process.env.REPORT_ALERT_EMAIL_TO = 'oncall@example.test';
  }

  beforeEach(() => {
    sendWhatsAppGroup.mockReset();
    sendMail.mockReset();
    smtpAvailable = false;
    delete process.env.REPORT_ALERT_EMAIL_TO;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_FROM;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('sends nothing when the run had no failures', async () => {
    await sendFailureAlert(base);
    expect(sendWhatsAppGroup).not.toHaveBeenCalled();
  });

  it('notifies the WhatsApp infra group when a send failed', async () => {
    sendWhatsAppGroup.mockResolvedValue(undefined);
    await sendFailureAlert({
      ...base,
      groups: [{ groupName: 'Lawley', sent: false, error: 'fetch failed' }],
    });
    expect(sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    expect(String(sendWhatsAppGroup.mock.calls[0][1])).toContain('Lawley');
  });

  // The core invariant: the alert path runs inside the cron handler, so a
  // failing alert must never turn a partial report run into a crashed one.
  it('never throws when every alert channel fails', async () => {
    sendWhatsAppGroup.mockRejectedValue(new Error('bridge down'));
    await expect(
      sendFailureAlert({
        ...base,
        groups: [{ groupName: 'Lawley', sent: false, error: 'fetch failed' }],
      }),
    ).resolves.toBeUndefined();
  });

  // Email is the primary channel — the one that still works when the bridge is
  // the thing that died — so its success path must be exercised, not assumed.
  it('emails the alert when SMTP and a recipient are configured', async () => {
    configureSmtp();
    sendWhatsAppGroup.mockResolvedValue(undefined);
    sendMail.mockResolvedValue({});

    await sendFailureAlert(failingRun);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0] as Record<string, string>;
    expect(message.to).toBe('oncall@example.test');
    expect(message.from).toBe('ops@example.test'); // SMTP_FROM unset → SMTP_USER
    expect(message.subject).toContain('2026-07-27');
    expect(message.text).toContain('fetch failed');
  });

  it('does not attempt email when no recipient is configured', async () => {
    smtpAvailable = true;
    process.env.SMTP_USER = 'ops@example.test';
    sendWhatsAppGroup.mockResolvedValue(undefined);

    await sendFailureAlert(failingRun);

    expect(sendMail).not.toHaveBeenCalled();
    expect(sendWhatsAppGroup).toHaveBeenCalledTimes(1); // WA leg still runs
  });

  it('does not attempt email when SMTP is not configured', async () => {
    smtpAvailable = false;
    process.env.REPORT_ALERT_EMAIL_TO = 'oncall@example.test';
    sendWhatsAppGroup.mockResolvedValue(undefined);

    await sendFailureAlert(failingRun);

    expect(sendMail).not.toHaveBeenCalled();
    expect(sendWhatsAppGroup).toHaveBeenCalledTimes(1); // WA leg still runs
  });

  it('still sends the WhatsApp leg when the email leg throws', async () => {
    configureSmtp();
    sendMail.mockRejectedValue(new Error('smtp refused'));
    sendWhatsAppGroup.mockResolvedValue(undefined);

    await expect(sendFailureAlert(failingRun)).resolves.toBeUndefined();
    expect(sendWhatsAppGroup).toHaveBeenCalledTimes(1);
  });

  // Mail-header injection: a CR/LF reaching the Subject header would let an
  // injected value open a second header (Bcc, etc.).
  it('flattens CR/LF out of the subject so no extra mail header can be injected', async () => {
    configureSmtp();
    sendWhatsAppGroup.mockResolvedValue(undefined);
    sendMail.mockResolvedValue({});

    await sendFailureAlert({
      ...failingRun,
      cohortDate: '2026-07-27\r\nBcc: attacker@evil.test',
    });

    const message = sendMail.mock.calls[0][0] as Record<string, string>;
    expect(message.subject).not.toMatch(/[\r\n]/);
    // The value survives, flattened into the subject — it does not become a header.
    expect(message.subject).toContain('Bcc: attacker@evil.test');
  });
});
