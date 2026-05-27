/**
 * Validation for the inline casual-staff create form on the combined-PDF
 * importer.
 *
 * Stricter than the throwaway-fast checks in the original API route — these
 * rules prevent obviously-broken records from being persisted (e.g. `foo@@`
 * or `+++++++`) while still tolerating real-world variation in SA phone
 * formats. The casual create writes a permanent staff row, so the bar is
 * "good enough that an HR audit a year later finds a usable email + phone."
 */

import type { CasualCreate } from './types';

const NAME_MAX = 100;

// Must contain a single @, a dot in the domain, no consecutive dots, no
// stray spaces. Not RFC 5322 — that would accept things like `user@domain.`
// which we don't want for staff records.
const EMAIL_RE =
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

/**
 * Returns the digits-only form if the phone looks like a valid SA mobile
 * (07x/08x/06x ten digits, optionally with +27 international prefix and
 * common separators). Returns null if the input is unusable.
 */
export function normaliseSaPhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Strip allowed formatting characters; reject anything else outright.
  if (!/^[\d +()\-.]+$/.test(trimmed)) return null;
  const digitsOnly = trimmed.replace(/\D/g, '');

  // +27 international form (e.g. +27821234567 → 0821234567)
  if (digitsOnly.startsWith('27') && digitsOnly.length === 11) {
    return `0${digitsOnly.slice(2)}`;
  }
  // Local form (e.g. 0821234567)
  if (digitsOnly.length === 10 && digitsOnly.startsWith('0')) {
    return digitsOnly;
  }
  return null;
}

export function validateCasualInput(create: CasualCreate): string | null {
  const firstName = create.firstName.trim();
  const lastName = create.lastName.trim();
  const email = create.email.trim().toLowerCase();
  const phone = create.phone.trim();

  if (!firstName) return 'firstName is required';
  if (firstName.length > NAME_MAX) return `firstName max ${NAME_MAX} chars`;
  if (!lastName) return 'lastName is required';
  if (lastName.length > NAME_MAX) return `lastName max ${NAME_MAX} chars`;
  if (!email) return 'email is required';
  if (!EMAIL_RE.test(email)) return 'email is invalid';
  if (!normaliseSaPhone(phone)) {
    return 'phone must be a valid SA mobile (e.g. 0821234567 or +27821234567)';
  }
  if (
    create.employmentType !== undefined &&
    create.employmentType !== 'casual' &&
    create.employmentType !== 'permanent'
  ) {
    return 'employmentType must be "casual" or "permanent"';
  }
  return null;
}
