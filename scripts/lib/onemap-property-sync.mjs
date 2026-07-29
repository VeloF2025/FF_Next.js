import { normalizeMsisdn } from '../../src/modules/communications/whatsapp/utils/phone-core.mjs';

const PHONE_ONLY = /^\s*\+?[\d\s().-]+\s*$/;
const SA_MSISDN = /^27\d{9}$/;

/**
 * Normalize 1Map's dedicated `contnr` field without turning free-form text into
 * a plausible but incorrect recipient number.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeOneMapContact(raw) {
  if (typeof raw !== 'string' || !PHONE_ONLY.test(raw)) return null;
  const normalized = normalizeMsisdn(raw);
  return normalized && SA_MSISDN.test(normalized) ? normalized : null;
}

/**
 * Upsert the current 1Map snapshot, including its subscriber contact number.
 * The caller owns the database connection.
 *
 * @param {{ query: (sql: string, params: unknown[]) => Promise<unknown> }} client
 * @param {Array<Record<string, unknown>>} records
 * @param {number} importId
 * @returns {Promise<number>}
 */
export async function upsertProperties(client, records, importId) {
  let count = 0;
  for (const record of records) {
    if (!record.prop_id) continue;
    await client.query(
      `INSERT INTO onemap_properties (
         import_id, property_id, drop_number, ont_barcode, ups_serial, status,
         site, pole_number, location_address, contact_number, latitude, longitude,
         home_signup_date, installation_date, last_modified_by, last_modified_date, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
       ON CONFLICT (import_id, property_id) DO UPDATE SET
         drop_number = EXCLUDED.drop_number,
         ont_barcode = EXCLUDED.ont_barcode,
         ups_serial = EXCLUDED.ups_serial,
         status = EXCLUDED.status,
         site = EXCLUDED.site,
         pole_number = EXCLUDED.pole_number,
         location_address = EXCLUDED.location_address,
         contact_number = EXCLUDED.contact_number,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         home_signup_date = EXCLUDED.home_signup_date,
         installation_date = EXCLUDED.installation_date,
         last_modified_by = EXCLUDED.last_modified_by,
         last_modified_date = EXCLUDED.last_modified_date,
         updated_at = NOW()`,
      [
        importId,
        String(record.prop_id),
        record.drp || null,
        record.ph_ont || null,
        record.br_ser || null,
        record.status || null,
        record.site || null,
        record.pole || null,
        record.address || null,
        normalizeOneMapContact(record.contnr),
        Number.isFinite(Number(record.latitude)) ? Number(record.latitude) : null,
        Number.isFinite(Number(record.longitude)) ? Number(record.longitude) : null,
        record.last_modified_signup_date || null,
        record.last_modified_install_date || null,
        record.last_modified_by || null,
        record.last_modified_date || null,
      ],
    );
    count++;
  }
  return count;
}
