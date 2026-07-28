import { describe, it, expect, afterEach } from 'vitest';
import { resolveSmtpTransportSecurity, createSmtpTransport } from '@/lib/smtpConfig';

describe('resolveSmtpTransportSecurity', () => {
  it('forces TLS on port 465 when SMTP_SECURE is unset', () => {
    // The production regression: SMTP_PORT=465 with no SMTP_SECURE previously
    // produced secure=false and hung until the greeting timed out.
    expect(resolveSmtpTransportSecurity('465', undefined)).toEqual({
      port: 465,
      secure: true,
    });
  });

  it('forces TLS on port 465 when SMTP_SECURE is empty (the .env.example shape)', () => {
    expect(resolveSmtpTransportSecurity('465', '')).toEqual({
      port: 465,
      secure: true,
    });
  });

  it.each([' 465', '465 ', '0465', '465\n'])(
    'forces TLS for %j, which parses to the implicit-TLS port',
    (portEnv) => {
      const result = resolveSmtpTransportSecurity(portEnv, undefined);
      expect(result.port).toBe(465);
      expect(result.secure).toBe(true);
    }
  );

  it('leaves STARTTLS submission port 587 unencrypted at connect time', () => {
    expect(resolveSmtpTransportSecurity('587', undefined)).toEqual({
      port: 587,
      secure: false,
    });
  });

  it('honours an explicit SMTP_SECURE=true on a non-465 port', () => {
    expect(resolveSmtpTransportSecurity('2465', 'true')).toEqual({
      port: 2465,
      secure: true,
    });
  });

  it('treats any SMTP_SECURE value other than "true" as not forcing TLS', () => {
    expect(resolveSmtpTransportSecurity('587', 'TRUE').secure).toBe(false);
    expect(resolveSmtpTransportSecurity('587', '1').secure).toBe(false);
    expect(resolveSmtpTransportSecurity('587', 'yes').secure).toBe(false);
  });

  it('falls back to port 587 when SMTP_PORT is unset', () => {
    expect(resolveSmtpTransportSecurity(undefined, undefined)).toEqual({
      port: 587,
      secure: false,
    });
  });

  it('falls back to port 587 when SMTP_PORT is unparseable', () => {
    // Previously this produced NaN and was handed straight to nodemailer.
    expect(resolveSmtpTransportSecurity('not-a-port', undefined)).toEqual({
      port: 587,
      secure: false,
    });
  });
});

describe('createSmtpTransport', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  // Callers must treat null as "cannot send". Returning a transport that
  // silently drops mail would be worse than returning nothing.
  it('returns null when SMTP_HOST is missing', () => {
    delete process.env.SMTP_HOST;
    process.env.SMTP_USER = 'ops@example.test';
    expect(createSmtpTransport()).toBeNull();
  });

  it('returns null when SMTP_USER is missing', () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    delete process.env.SMTP_USER;
    expect(createSmtpTransport()).toBeNull();
  });

  it('returns null when neither is set', () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    expect(createSmtpTransport()).toBeNull();
  });
});
