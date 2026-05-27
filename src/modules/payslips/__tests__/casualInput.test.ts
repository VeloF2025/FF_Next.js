/**
 * Tests for the inline casual-create input validation.
 */

import { describe, it, expect } from 'vitest';

import { validateCasualInput, normaliseSaPhone } from '../casualInput';
import type { CasualCreate } from '../types';

function make(overrides: Partial<CasualCreate> = {}): CasualCreate {
  return {
    page: 1,
    firstName: 'Adam',
    lastName: 'Casual',
    email: 'adam@example.com',
    phone: '0821234567',
    employmentType: 'casual',
    ...overrides,
  };
}

describe('validateCasualInput', () => {
  it('accepts a well-formed input', () => {
    expect(validateCasualInput(make())).toBeNull();
  });

  it('accepts a +27 international phone', () => {
    expect(validateCasualInput(make({ phone: '+27 82 123 4567' }))).toBeNull();
  });

  it('rejects empty firstName', () => {
    expect(validateCasualInput(make({ firstName: '   ' }))).toBe('firstName is required');
  });

  it('rejects empty lastName', () => {
    expect(validateCasualInput(make({ lastName: '' }))).toBe('lastName is required');
  });

  it('rejects an empty email', () => {
    expect(validateCasualInput(make({ email: '' }))).toBe('email is required');
  });

  it('rejects malformed emails', () => {
    expect(validateCasualInput(make({ email: 'foo' }))).toBe('email is invalid');
    expect(validateCasualInput(make({ email: 'foo@@bar.baz' }))).toBe('email is invalid');
    expect(validateCasualInput(make({ email: 'foo@bar' }))).toBe('email is invalid');
    expect(validateCasualInput(make({ email: 'foo@.com' }))).toBe('email is invalid');
    expect(validateCasualInput(make({ email: '@example.com' }))).toBe('email is invalid');
  });

  it('rejects junk phones', () => {
    const phoneError = 'phone must be a valid SA mobile (e.g. 0821234567 or +27821234567)';
    expect(validateCasualInput(make({ phone: '+++++++' }))).toBe(phoneError);
    expect(validateCasualInput(make({ phone: '12345' }))).toBe(phoneError);
    expect(validateCasualInput(make({ phone: '1234567890' }))).toBe(phoneError); // 10 digits but doesn't start with 0
    expect(validateCasualInput(make({ phone: 'abcdefghij' }))).toBe(phoneError);
    expect(validateCasualInput(make({ phone: '' }))).toBe(phoneError);
  });

  it('rejects an unknown employmentType', () => {
    expect(
      validateCasualInput(make({ employmentType: 'contractor' as 'casual' }))
    ).toBe('employmentType must be "casual" or "permanent"');
  });

  it('caps name length', () => {
    const long = 'a'.repeat(101);
    expect(validateCasualInput(make({ firstName: long }))).toBe('firstName max 100 chars');
  });
});

describe('normaliseSaPhone', () => {
  it('strips formatting from local SA mobile', () => {
    expect(normaliseSaPhone('082 123 4567')).toBe('0821234567');
    expect(normaliseSaPhone('082-123-4567')).toBe('0821234567');
    expect(normaliseSaPhone('(082) 1234567')).toBe('0821234567');
  });

  it('converts +27 international to local form', () => {
    expect(normaliseSaPhone('+27 82 123 4567')).toBe('0821234567');
    expect(normaliseSaPhone('+27821234567')).toBe('0821234567');
  });

  it('returns null for unusable input', () => {
    expect(normaliseSaPhone('')).toBeNull();
    expect(normaliseSaPhone('foo')).toBeNull();
    expect(normaliseSaPhone('+++++++')).toBeNull();
    expect(normaliseSaPhone('1234567')).toBeNull(); // too short
  });
});
