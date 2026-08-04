import {
  fingerprintMsisdn,
  normalizeSaMobileMsisdn,
  toE164,
} from './phone';
import type {
  CandidateDbRow,
  CandidateDecision,
  ConsentEvidence,
  PhoneSource,
} from './types';

interface ResolvedPhone {
  msisdn: string;
  source: PhoneSource;
}

function resolvePhone(row: CandidateDbRow): ResolvedPhone | 'conflict' | null {
  const phones: ResolvedPhone[] = [
    { source: 'onemap', msisdn: normalizeSaMobileMsisdn(row.onemap_phone) },
    { source: 'subscriber_cache', msisdn: normalizeSaMobileMsisdn(row.subscriber_phone) },
    { source: 'qcontact', msisdn: normalizeSaMobileMsisdn(row.qcontact_phone) },
  ].filter((phone): phone is ResolvedPhone => phone.msisdn !== null);

  if (phones.length === 0) return null;
  if (new Set(phones.map(({ msisdn }) => msisdn)).size > 1) return 'conflict';
  return phones[0] ?? null;
}

// Rendered into the WhatsApp greeting when no source carries a name. It is also
// persisted as the GHL contact's first name, because the workflow maps {{1}} from
// Contact -> First Name and has nowhere else to read a fallback from.
export const MISSING_NAME_PLACEHOLDER = 'there';

// Source names arrive in mixed case — across the 2026-08-01..03 window, 49 started
// lowercase and 4 were ALLCAPS. The value is greeted with ("Hi {{1}}") and shown in
// the GHL inbox, so normalise it. Dutch/Afrikaans particles stay lowercase, which is
// how these surnames are actually written in South Africa.
const NAME_PARTICLES = new Set(['van', 'der', 'den', 'de', 'du', 'le', 'la', 'von', 'ter']);

function titleCaseName(value: string): string {
  return value.split(/(\s+|-)/).map((part, index) => {
    if (!part.trim() || part === '-') return part;
    const lower = part.toLowerCase();
    if (index > 0 && NAME_PARTICLES.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('');
}

/**
 * Prefer onemap's already-split given/family pair; otherwise take a full name from the
 * review record and split it. Falls back to the placeholder only when no source has one.
 *
 * Everything here is a greeting, not an identity record: a one-word full name yields no
 * surname rather than duplicating the given name, and a multi-word family name is kept
 * whole ("Van Der Merwe"), since truncating someone's surname is worse than omitting it.
 */
function resolveName(row: CandidateDbRow): { firstName: string; lastName: string | null } {
  const onemapFirst = row.contact_name?.trim();
  const onemapLast = row.contact_surname?.trim();
  if (onemapFirst) {
    return {
      firstName: titleCaseName(onemapFirst),
      lastName: onemapLast ? titleCaseName(onemapLast) : null,
    };
  }
  const full = row.subscriber_name?.trim() || row.qcontact_name?.trim() || '';
  if (full) {
    const [given, ...rest] = full.split(/\s+/);
    if (given) {
      return {
        firstName: titleCaseName(given),
        lastName: rest.length > 0 ? titleCaseName(rest.join(' ')) : null,
      };
    }
  }
  // The placeholder is deliberately left lowercase: it reads as "Hi there", not a name.
  return {
    firstName: MISSING_NAME_PLACEHOLDER,
    lastName: onemapLast ? titleCaseName(onemapLast) : null,
  };
}

function resolveConsent(row: CandidateDbRow): ConsentEvidence | null {
  if (row.home_signup_date !== null) {
    return {
      source: 'onemap_home_signup',
      grantedAt: new Date(row.home_signup_date),
    };
  }

  if (row.signature_present && row.signature_evidence_at !== null) {
    return {
      source: 'onemap_install_signature',
      grantedAt: new Date(row.signature_evidence_at),
    };
  }

  return null;
}

export function prepareCandidate(
  row: CandidateDbRow,
  fingerprintSecret: string,
): CandidateDecision {
  const phone = resolvePhone(row);
  if (phone === null) {
    return { status: 'quarantined', drNumber: row.dr_number, reason: 'no_safe_phone' };
  }
  if (phone === 'conflict') {
    return { status: 'quarantined', drNumber: row.dr_number, reason: 'phone_conflict' };
  }

  const consentEvidence = resolveConsent(row);
  if (consentEvidence === null) {
    return { status: 'quarantined', drNumber: row.dr_number, reason: 'consent_missing' };
  }

  const { firstName, lastName } = resolveName(row);

  return {
    status: 'ready',
    candidate: {
      drNumber: row.dr_number,
      sources: [...row.sources],
      msisdn: phone.msisdn,
      phoneE164: toE164(phone.msisdn),
      phoneFingerprint: fingerprintMsisdn(phone.msisdn, fingerprintSecret),
      phoneSource: phone.source,
      firstName,
      lastName,
      consentEvidence,
    },
  };
}
