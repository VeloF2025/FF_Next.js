import { query, type SqlRow } from '@/lib/db-pool';
import { extractMsisdnFromContact } from '../utils/phone';

// Read side of wa_subscriber_consent (migration 469). Consent is keyed on the
// subscriber's MSISDN rather than on a ticket or a drop, because consent is a
// property of the person: a WhatsApp block — which we must honour as withdrawal
// — is signalled per number, across every drop that number is attached to.
//
// Absence of a row is the "no consent" state. There is deliberately no default
// and no nullable boolean whose NULL a caller could coerce to true, so the only
// way to reach 'granted' is for a row to say so explicitly.

export type ConsentStatus = 'granted' | 'withdrawn';

export interface WaSubscriberConsentRow {
  msisdn: string;
  status: ConsentStatus;
  drop_number: string | null;
  source: string;
  granted_at: Date | null;
  withdrawn_at: Date | null;
}

export type ConsentLookup =
  | { status: 'none' }
  | { status: ConsentStatus; row: WaSubscriberConsentRow };

/**
 * Look up the consent state for a subscriber number.
 *
 * The argument is re-normalized here rather than trusted, so a caller that
 * passes a raw or differently-shaped number cannot miss an existing row and
 * read it as "no consent" — the stored column only ever holds the canonical
 * form. A value that is not an SA subscriber number has no canonical form at
 * all, so it cannot match a row and returns 'none'.
 *
 * A status the CHECK constraint should have made impossible is treated as
 * 'none': an unrecognised value is not permission to send.
 */
export async function getConsentForMsisdn(
  msisdn: string | null | undefined,
): Promise<ConsentLookup> {
  const normalized = extractMsisdnFromContact(msisdn);
  if (!normalized) return { status: 'none' };

  // Intersected with SqlRow to satisfy the helper's index-signature constraint
  // without putting one on the exported interface.
  const rows = await query<WaSubscriberConsentRow & SqlRow>(
    `SELECT msisdn, status, drop_number, source, granted_at, withdrawn_at
       FROM wa_subscriber_consent
      WHERE msisdn = $1
      LIMIT 1`,
    [normalized],
  );

  const row = rows[0];
  if (!row) return { status: 'none' };
  if (row.status !== 'granted' && row.status !== 'withdrawn') return { status: 'none' };

  return { status: row.status, row };
}
