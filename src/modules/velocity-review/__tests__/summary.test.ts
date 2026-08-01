import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VelocityReviewRunResult } from '../processor';

const mail = vi.hoisted(() => ({
  createSmtpTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('@/lib/smtpConfig', () => ({
  createSmtpTransport: mail.createSmtpTransport,
}));

import { buildRunSummary } from '../summary';
import { sendVelocityReviewRunSummary, sendVelocityReviewSummary } from '../summaryEmail';

const ORIGINAL_ENV = { ...process.env };
const PHONE = '+27821234567';
const SENSITIVE_VALUE = 'redaction-fixture-value';
const CONTACT_ID = 'contact-sensitive-123';
const RAW_ERROR = 'HighLevel rejected contact-sensitive-123 for +27821234567';

function result(): VelocityReviewRunResult {
  return {
    status: 'partial',
    counts: {
      candidate_total: 14,
      ready: 11,
      duplicates: 2,
      quarantined: 3,
      completed: 5,
      permanent_failure: 1,
      retryable: 1,
      ambiguous: 1,
      ack_cleanup_pending: 1,
      pilot_deferred: 1,
      raw_error: 99,
    },
    dates: [{
      targetDate: '2026-07-31',
      status: 'partial',
      counts: { candidate_total: 14, completed: 5 },
    }],
    ...({ phone: PHONE, token: SENSITIVE_VALUE, contactId: CONTACT_ID, rawError: RAW_ERROR } as object),
  };
}

describe('buildRunSummary', () => {
  it('renders only approved aggregate counts in text and HTML', () => {
    const summary = buildRunSummary(result());

    expect(summary.subject).toBe('Velocity review export — 2026-07-31 — partial');
    for (const expected of [
      'Discovered: 14', 'Ready: 11', 'Duplicates: 2', 'Quarantined: 3',
      'Workflow acknowledged: 6', 'Permanent failures: 1', 'Retryable failures: 1',
      'Ambiguous: 1', 'Acknowledgement cleanup pending: 1', 'Pilot deferred: 1',
    ]) {
      expect(summary.text).toContain(expected);
      expect(summary.html).toContain(expected.replace(': ', '</th><td>'));
    }
    const rendered = JSON.stringify(summary);
    for (const sensitive of [PHONE, SENSITIVE_VALUE, CONTACT_ID, RAW_ERROR, 'raw_error']) {
      expect(rendered).not.toContain(sensitive);
    }
  });

  it('uses the approved dry-run subject label', () => {
    expect(buildRunSummary({
      status: 'dry_run', counts: { candidate_total: 2 },
      dates: [{ targetDate: '2026-07-30', status: 'complete', counts: { candidate_total: 2 } }],
    }).subject).toBe('Velocity review export — 2026-07-30 — dry run');
  });

  it('counts cleanup-pending acknowledgements without counting ambiguous rows', () => {
    const summary = buildRunSummary({
      status: 'partial',
      counts: { completed: 2, ack_cleanup_pending: 3, ambiguous: 7 },
      dates: [{ targetDate: '2026-07-31', status: 'partial', counts: {} }],
    });

    expect(summary.text).toContain('Workflow acknowledged: 5');
    expect(summary.text).toContain('Acknowledgement cleanup pending: 3');
    expect(summary.text).toContain('Ambiguous: 7');
  });
});

describe('sendVelocityReviewSummary', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '465',
      SMTP_USER: 'smtp-user',
      SMTP_PASS: 'smtp-password',
      SMTP_FROM: 'FibreFlow <noreply@example.test>',
      VELOCITY_REVIEW_SUMMARY_TO:
        ' Velocity Ops <ops@example.test>,, Reconciliation Team <recon@example.test> ',
    };
    mail.sendMail.mockReset().mockResolvedValue({ accepted: ['ops@example.test'] });
    mail.createSmtpTransport.mockReset().mockReturnValue({ sendMail: mail.sendMail });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('sends through the configured SMTP transport to every non-empty recipient', async () => {
    const summary = buildRunSummary(result());

    await expect(sendVelocityReviewSummary(summary)).resolves.toBe(true);
    expect(mail.createSmtpTransport).toHaveBeenCalledOnce();
    expect(mail.sendMail).toHaveBeenCalledWith({
      from: 'FibreFlow <noreply@example.test>',
      to: ['Velocity Ops <ops@example.test>', 'Reconciliation Team <recon@example.test>'],
      subject: summary.subject,
      text: summary.text,
      html: summary.html,
    });
  });

  it('returns false when no non-empty recipients are configured', async () => {
    process.env.VELOCITY_REVIEW_SUMMARY_TO = ' , , ';

    await expect(sendVelocityReviewSummary(buildRunSummary(result()))).resolves.toBe(false);
    expect(mail.createSmtpTransport).not.toHaveBeenCalled();
  });

  it('returns false when SMTP rejects the message', async () => {
    mail.sendMail.mockRejectedValue(new Error(RAW_ERROR));

    await expect(sendVelocityReviewSummary(buildRunSummary(result()))).resolves.toBe(false);
  });
});

describe('sendVelocityReviewRunSummary', () => {
  it('marks only the target run summaries failed when SMTP fails', async () => {
    const setStatus = vi.fn(async () => undefined);

    await expect(sendVelocityReviewRunSummary(result(), {
      send: vi.fn(async () => false),
      setStatus,
    })).resolves.toBe(false);
    expect(setStatus).toHaveBeenCalledWith(['2026-07-31'], 'failed');
  });

  it('marks target run summaries sent after SMTP accepts the message', async () => {
    const setStatus = vi.fn(async () => undefined);

    await expect(sendVelocityReviewRunSummary(result(), {
      send: vi.fn(async () => true),
      setStatus,
    })).resolves.toBe(true);
    expect(setStatus).toHaveBeenCalledWith(['2026-07-31'], 'sent');
  });
});
