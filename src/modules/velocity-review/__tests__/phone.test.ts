import { describe, expect, it } from 'vitest';
import { fingerprintMsisdn, normalizeSaMobileMsisdn, toE164 } from '../phone';

describe('normalizeSaMobileMsisdn', () => {
  it.each([
    ['082 123 4567', '27821234567'],
    ['+27 82 123 4567', '27821234567'],
    ['27821234567', '27821234567'],
    ['82-123-4567', '27821234567'],
  ])('normalises %s', (raw, expected) => {
    expect(normalizeSaMobileMsisdn(raw)).toBe(expected);
  });

  it.each(['', '0111234567', '+27211234567', '12345', '278212345678'])('rejects %s', (raw) => {
    expect(normalizeSaMobileMsisdn(raw)).toBeNull();
  });

  it.each([
    '27821234567@c.us',
    '27821234567@s.whatsapp.net',
    '120363000000@g.us',
    '27821234567 @c.us',
  ])('never accepts WhatsApp JID %s as a customer mobile', (jid) => {
    expect(normalizeSaMobileMsisdn(jid)).toBeNull();
  });
});

it('formats E.164 and fingerprints deterministically without exposing the phone', () => {
  expect(toE164('27821234567')).toBe('+27821234567');
  const digest = fingerprintMsisdn('27821234567', 'test-only-secret');
  expect(digest).toMatch(/^[a-f0-9]{64}$/);
  expect(digest).not.toContain('27821234567');
});
