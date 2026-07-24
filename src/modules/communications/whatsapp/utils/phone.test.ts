import { describe, it, expect } from 'vitest';
import { normalizeMsisdn, extractMsisdnFromContact } from './phone';

describe('normalizeMsisdn', () => {
  it('returns an already-normalized SA MSISDN unchanged', () => {
    expect(normalizeMsisdn('27831112222')).toBe('27831112222');
  });

  it('strips a leading + and separators', () => {
    expect(normalizeMsisdn('+27 83 111 2222')).toBe('27831112222');
    expect(normalizeMsisdn('083-111-2222')).toBe('27831112222');
    expect(normalizeMsisdn('(083) 111 2222')).toBe('27831112222');
  });

  it('rewrites a 10-digit leading-0 SA number to the 27 country code', () => {
    expect(normalizeMsisdn('0831112222')).toBe('27831112222');
  });

  it('normalizes the 0-prefixed and 27-prefixed forms of one number to the same value', () => {
    expect(normalizeMsisdn('0831112222')).toBe(normalizeMsisdn('+27 83 111 2222'));
  });

  it('strips WhatsApp JID suffixes', () => {
    expect(normalizeMsisdn('27831112222@s.whatsapp.net')).toBe('27831112222');
    expect(normalizeMsisdn('27831112222@c.us')).toBe('27831112222');
  });

  it('returns null for empty or missing input', () => {
    expect(normalizeMsisdn(null)).toBeNull();
    expect(normalizeMsisdn(undefined)).toBeNull();
    expect(normalizeMsisdn('')).toBeNull();
    expect(normalizeMsisdn('   ')).toBeNull();
  });

  it('returns null when the value carries no phone digits', () => {
    expect(normalizeMsisdn('John Smith')).toBeNull();
  });

  it('returns null for digit runs outside E.164 length bounds', () => {
    expect(normalizeMsisdn('12345')).toBeNull();
    expect(normalizeMsisdn('1234567890123456')).toBeNull();
  });

  it('does not guess a country code for a bare 9-digit number', () => {
    // Fail-closed: guessing would let 831112222 match a different subscriber.
    expect(normalizeMsisdn('831112222')).toBe('831112222');
  });
});

describe('extractMsisdnFromContact', () => {
  it('normalizes a contact field that is just a phone number', () => {
    expect(extractMsisdnFromContact('0831112222')).toBe('27831112222');
  });

  it('pulls the phone out of a free-form name + number contact', () => {
    expect(extractMsisdnFromContact('John Smith 083 111 2222')).toBe('27831112222');
  });

  it('returns the first usable phone when the contact lists several', () => {
    expect(extractMsisdnFromContact('Call +27 83 111 2222 or 011 555 1234')).toBe('27831112222');
  });

  it('returns null for a contact holding only a name', () => {
    expect(extractMsisdnFromContact('Sipho')).toBeNull();
  });

  it('does not mistake digits inside an email address for a phone number', () => {
    expect(extractMsisdnFromContact('john1234567890@example.com')).toBeNull();
  });

  it('returns null for empty or missing input', () => {
    expect(extractMsisdnFromContact(null)).toBeNull();
    expect(extractMsisdnFromContact('')).toBeNull();
  });
});
