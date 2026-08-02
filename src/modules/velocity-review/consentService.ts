import { query, type SqlRow } from '@/lib/db-pool';
import { getConsentForMsisdn } from '@/modules/communications/whatsapp/consent/consentRepo';
import type { ConsentEvidence } from './types';

export interface OneMapConsentInput {
  msisdn: string;
  drNumber: string;
  consentEvidence: ConsentEvidence;
}

interface ConsentStatusRow extends SqlRow {
  status: 'granted' | 'withdrawn';
}

const RECORD_CONSENT_SQL = `
INSERT INTO wa_subscriber_consent
  (msisdn, status, drop_number, source, granted_at, recorded_by, notes)
VALUES ($1, 'granted', $2, $3, $4, 'system:velocity-review',
        'Velocity review consent evidenced by OneMap signup/install process')
ON CONFLICT (msisdn) DO UPDATE SET
  drop_number = CASE WHEN wa_subscriber_consent.status = 'granted'
                     THEN EXCLUDED.drop_number ELSE wa_subscriber_consent.drop_number END,
  source = CASE
    WHEN wa_subscriber_consent.status <> 'granted' THEN wa_subscriber_consent.source
    WHEN wa_subscriber_consent.source IN ('fno_payload','ops_manual') THEN wa_subscriber_consent.source
    ELSE EXCLUDED.source
  END,
  granted_at = CASE WHEN wa_subscriber_consent.status = 'granted'
                    THEN LEAST(wa_subscriber_consent.granted_at, EXCLUDED.granted_at)
                    ELSE wa_subscriber_consent.granted_at END,
  updated_at = CASE WHEN wa_subscriber_consent.status = 'granted'
                    THEN NOW() ELSE wa_subscriber_consent.updated_at END
RETURNING status;
`;

export async function recordOneMapConsent(
  input: OneMapConsentInput,
): Promise<'granted' | 'withdrawn'> {
  try {
    await query<ConsentStatusRow>(RECORD_CONSENT_SQL, [
      input.msisdn,
      input.drNumber,
      input.consentEvidence.source,
      input.consentEvidence.grantedAt,
    ]);

    const consent = await getConsentForMsisdn(input.msisdn);
    if (consent.status === 'granted') return 'granted';
    if (consent.status === 'withdrawn') return 'withdrawn';
  } catch {
    // Database details can echo the failing row, including the raw MSISDN.
    throw new Error('Velocity review consent could not be verified');
  }
  throw new Error('Velocity review consent could not be verified');
}
