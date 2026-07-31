import { describe, it, expect } from 'vitest';
import {
  classifyBridgeHealth,
  buildBridgeAlert,
  isAlerting,
  sanitizeHeader,
} from './monitor';

/** The exact payload the bridge served while it was logged out on 2026-07-30. */
const LOGGED_OUT_PAYLOAD = {
  connected: false,
  device_jid: 'unknown',
  needs_auth: true,
  pairing_state: 'needs_pairing',
  phone_number: 'unknown',
  session_valid: false,
  status: 'ok',
};

/** The payload after re-pairing to +27638412276 the same day. */
const HEALTHY_PAYLOAD = {
  connected: true,
  device_jid: '27638412276:6@s.whatsapp.net',
  needs_auth: false,
  pairing_state: 'connected',
  phone_number: '+27638412276',
  session_valid: true,
  status: 'ok',
};

describe('classifyBridgeHealth', () => {
  it('reports healthy only when connected and paired', () => {
    const status = classifyBridgeHealth(HEALTHY_PAYLOAD);
    expect(status.verdict).toBe('healthy');
    expect(status.phone).toBe('+27638412276');
    expect(status.needsHuman).toBe(false);
  });

  it('classifies the real 2026-07-30 logged-out payload as logged_out', () => {
    const status = classifyBridgeHealth(LOGGED_OUT_PAYLOAD);
    expect(status.verdict).toBe('logged_out');
    expect(status.needsHuman).toBe(true);
  });

  // The regression that let the outage run unnoticed: the bridge reports
  // status:"ok" and connected:true while sitting on the pairing screen. Any
  // check that trusts either field alone calls this healthy.
  it('does not trust status:"ok" or connected:true when the session is invalid', () => {
    const status = classifyBridgeHealth({
      connected: true,
      session_valid: false,
      needs_auth: true,
      phone_number: 'unknown',
    });
    expect(status.verdict).toBe('logged_out');
  });

  it('treats needs_auth as logged out even when session_valid is true', () => {
    const status = classifyBridgeHealth({
      connected: true,
      session_valid: true,
      needs_auth: true,
      phone_number: '+27638412276',
    });
    expect(status.verdict).toBe('logged_out');
  });

  it('distinguishes a paired-but-dropped socket from a logout', () => {
    const status = classifyBridgeHealth({
      connected: false,
      session_valid: true,
      needs_auth: false,
      phone_number: '+27638412276',
    });
    expect(status.verdict).toBe('disconnected');
    // A restart fixes this one, so it must not be escalated to a human.
    expect(status.needsHuman).toBe(false);
  });

  it('classifies a failed probe as unreachable, not as a healthy default', () => {
    const status = classifyBridgeHealth(null);
    expect(status.verdict).toBe('unreachable');
    expect(status.needsHuman).toBe(true);
  });

  it('treats missing booleans as unhealthy rather than defaulting to connected', () => {
    expect(classifyBridgeHealth({}).verdict).toBe('logged_out');
  });

  it('falls back to "unknown" for a blank phone number', () => {
    expect(classifyBridgeHealth({ ...HEALTHY_PAYLOAD, phone_number: '   ' }).phone).toBe('unknown');
  });
});

describe('isAlerting', () => {
  it('alerts on every non-healthy verdict', () => {
    expect(isAlerting('logged_out')).toBe(true);
    expect(isAlerting('unreachable')).toBe(true);
    expect(isAlerting('disconnected')).toBe(true);
  });

  it('stays quiet when healthy', () => {
    expect(isAlerting('healthy')).toBe(false);
  });
});

describe('sanitizeHeader', () => {
  it('strips CR/LF so a value cannot inject mail headers', () => {
    expect(sanitizeHeader('subject\r\nBcc: attacker@evil.com')).toBe(
      'subject Bcc: attacker@evil.com',
    );
  });
});

describe('buildBridgeAlert', () => {
  it('renders nothing when the bridge is healthy', () => {
    expect(buildBridgeAlert(classifyBridgeHealth(HEALTHY_PAYLOAD))).toBeNull();
  });

  it('flags a logout as action-needed and gives the pairing runbook', () => {
    const alert = buildBridgeAlert(classifyBridgeHealth(LOGGED_OUT_PAYLOAD));
    expect(alert).not.toBeNull();
    expect(alert!.subject).toContain('LOGGED_OUT');
    expect(alert!.subject).toContain('ACTION NEEDED');
    expect(alert!.text).toContain('Linked Devices');
    // The rate-limit warning is the expensive lesson from 2026-07-29.
    expect(alert!.text).toContain('429');
  });

  it('does not label a self-healing disconnect as action-needed', () => {
    const alert = buildBridgeAlert(
      classifyBridgeHealth({ connected: false, session_valid: true, phone_number: '+27638412276' }),
    );
    expect(alert!.subject).toContain('degraded');
    expect(alert!.subject).not.toContain('ACTION NEEDED');
  });

  it('says traffic is dropped, not queued, so the impact is not underestimated', () => {
    const alert = buildBridgeAlert(classifyBridgeHealth(LOGGED_OUT_PAYLOAD));
    expect(alert!.text).toContain('not queued');
  });

  it('renders an all-clear with downtime when recovered', () => {
    const alert = buildBridgeAlert(classifyBridgeHealth(HEALTHY_PAYLOAD), {
      recovered: true,
      downtimeMs: 80 * 60 * 1000,
    });
    expect(alert!.subject).toContain('RECOVERED');
    expect(alert!.subject).toContain('80 min');
    expect(alert!.text).toContain('+27638412276');
  });

  it('renders the all-clear without downtime when the duration is unknown', () => {
    const alert = buildBridgeAlert(classifyBridgeHealth(HEALTHY_PAYLOAD), { recovered: true });
    expect(alert!.subject).toBe('[FibreFlow] WhatsApp bridge RECOVERED');
  });
});
