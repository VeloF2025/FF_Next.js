import {
  extractMsisdnFromContact as extractMsisdnFromContactCore,
  normalizeMsisdn as normalizeMsisdnCore,
} from './phone-core.mjs';

// Shared MSISDN normalization for the WhatsApp module. One source of truth so a
// number reaching the Cloud send path and a number compared against a ticket
// contact are canonicalized identically — a sender check is only as trustworthy
// as the normalization on both sides of the comparison.

/**
 * Canonicalize a phone number to bare digits, or null when the value cannot be
 * one. A 10-digit leading-zero number is treated as South African and rewritten
 * to the 27 country code; no other country code is ever guessed, so numbers we
 * cannot place stay as-is and simply fail to match (fail closed).
 */
export function normalizeMsisdn(raw: string | null | undefined): string | null {
  return normalizeMsisdnCore(raw);
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
  return extractMsisdnFromContactCore(raw);
}
