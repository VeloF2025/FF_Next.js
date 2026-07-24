// Shared MSISDN normalization for the WhatsApp module. One source of truth so a
// number reaching the Cloud send path and a number compared against a ticket
// contact are canonicalized identically — a sender check is only as trustworthy
// as the normalization on both sides of the comparison.

// E.164 allows at most 15 digits; below 9 nothing here is a dialable subscriber
// number, so both bounds reject the value outright.
const MIN_DIGITS = 9;
const MAX_DIGITS = 15;

const JID_SUFFIX = /@(s\.whatsapp\.net|c\.us|g\.us)$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// A phone-like run inside free-form text: starts and ends on a digit, with the
// usual separators allowed between. Long enough (9+ chars) to skip stray digits.
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{7,}\d/g;
// A normalized SA subscriber number — the only shape a real customer contact
// takes in this system.
function isSouthAfrican(msisdn: string): boolean {
  return msisdn.length === 11 && msisdn.startsWith('27');
}

/**
 * Canonicalize a phone number to bare digits, or null when the value cannot be
 * one. A 10-digit leading-zero number is treated as South African and rewritten
 * to the 27 country code; no other country code is ever guessed, so numbers we
 * cannot place stay as-is and simply fail to match (fail closed).
 */
export function normalizeMsisdn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(JID_SUFFIX, '').replace(/\D/g, '');
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  if (digits.length === 10 && digits.startsWith('0')) return `27${digits.slice(1)}`;
  return digits;
}

/**
 * Pull a normalized MSISDN out of a free-form contact field, which may hold a
 * bare number, a name plus a number, an email address, or a name alone.
 *
 * The field is never collapsed to digits as a whole — doing so splices
 * unrelated numbers (a street number, an invoice reference, a stray trailing
 * digit) onto the real one and yields a plausible-length value that is not a
 * phone number at all. Each phone-shaped run is normalized on its own instead,
 * and only a South African subscriber number is accepted: anything else is
 * extraction noise, and returning it risks a coincidental match against a real
 * sender. Returns null when no such number is present, which the caller treats
 * as "unverified" and fails closed on.
 */
export function extractMsisdnFromContact(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Email addresses go first so their digits cannot pose as a phone number.
  const cleaned = raw.replace(EMAIL, ' ');
  for (const match of cleaned.matchAll(PHONE_CANDIDATE)) {
    const candidate = normalizeMsisdn(match[0]);
    if (candidate && isSouthAfrican(candidate)) return candidate;
  }
  return null;
}
