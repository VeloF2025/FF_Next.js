// Runtime-neutral MSISDN helpers shared by the Next.js WhatsApp module and
// standalone Node.js sync scripts.

// E.164 allows at most 15 digits; below 9 nothing here is a dialable subscriber
// number, so both bounds reject the value outright.
const MIN_DIGITS = 9;
const MAX_DIGITS = 15;

const JID_SUFFIX = /@(s\.whatsapp\.net|c\.us|g\.us)$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{7,}\d/g;

/** @param {string} msisdn */
function isSouthAfrican(msisdn) {
  return msisdn.length === 11 && msisdn.startsWith('27');
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normalizeMsisdn(raw) {
  if (!raw) return null;
  const digits = raw.replace(JID_SUFFIX, '').replace(/\D/g, '');
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  if (digits.length === 10 && digits.startsWith('0')) return `27${digits.slice(1)}`;
  return digits;
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function extractMsisdnFromContact(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(EMAIL, ' ');
  for (const match of cleaned.matchAll(PHONE_CANDIDATE)) {
    const candidate = normalizeMsisdn(match[0]);
    if (candidate && isSouthAfrican(candidate)) return candidate;
  }
  return null;
}
