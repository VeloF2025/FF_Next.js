/**
 * DR Contact Service
 *
 * Fetches subscriber and QContact info during DR processing.
 * Data is stored once in dr_photo_unified_reviews to avoid runtime lookups.
 *
 * Sources:
 * - BOSS API (1Map data cached on dr-photo-api service :8003)
 * - maintenance_tickets (QContact data)
 */

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import type { ContactData, SubscriberContact, QContactInfo } from './drProcessTypes';

const BOSS_API_HOST = 'http://100.96.203.105:8003';

/**
 * Fetch subscriber contact info from BOSS API (1Map data).
 * Returns null on any failure — contact info is supplemental, not required.
 */
async function fetchSubscriberContact(dropNumber: string): Promise<SubscriberContact | null> {
  try {
    const response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      log.warn('DrContactService', `BOSS API returned ${response.status} for ${dropNumber}`);
      return null;
    }

    const data = await response.json() as Record<string, string | null | undefined>;

    const firstName = String(data.contact_person_name ?? data.contact_name ?? '');
    const lastName = String(data.contact_person_surname ?? data.contact_surname ?? '');
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

    return {
      subscriber_name: fullName,
      subscriber_phone: (data.contact_number ?? data.contact_phone) || null,
      subscriber_email: (data.email_address ?? data.contact_email) || null,
      subscriber_language: data.language ?? null,
      signup_agent: data.signup_agent ?? null,
      installer_name: data.installer_name ?? null,
    };
  } catch (error) {
    log.warn('DrContactService', `BOSS API fetch failed for ${dropNumber}`, error);
    return null;
  }
}

/**
 * Fetch QContact info from maintenance_tickets table.
 * Returns null on any failure — contact info is supplemental, not required.
 */
async function fetchQContactInfo(dropNumber: string): Promise<QContactInfo | null> {
  try {
    const result = await pool.query<{ client_name: string | null; client_contact: string | null; client_email: string | null }>(
      `SELECT client_name, client_contact, client_email
       FROM maintenance_tickets
       WHERE dr_number = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [dropNumber]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0]!;
    return {
      qcontact_name: row.client_name ?? null,
      qcontact_phone: row.client_contact ?? null,
      qcontact_email: row.client_email ?? null,
    };
  } catch (error) {
    log.warn('DrContactService', `QContact fetch failed for ${dropNumber}`, error);
    return null;
  }
}

/**
 * Fetch all contact data for a DR in parallel.
 * Both sources are best-effort — failures return null without throwing.
 */
export async function fetchContactData(dropNumber: string): Promise<ContactData> {
  const [subscriberContact, qContactInfo] = await Promise.all([
    fetchSubscriberContact(dropNumber),
    fetchQContactInfo(dropNumber),
  ]);

  log.info('DrContactService', `Contact info for ${dropNumber}`, {
    hasSubscriberContact: !!subscriberContact,
    hasQContactInfo: !!qContactInfo,
    subscriberName: subscriberContact?.subscriber_name ?? null,
    qcontactName: qContactInfo?.qcontact_name ?? null,
  });

  return { subscriberContact, qContactInfo };
}
