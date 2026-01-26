/**
 * Backfill script to populate contact info for existing DRs
 *
 * UNIFIED ARCHITECTURE: This is a one-time migration to populate
 * contact info for DRs processed before the unified contact fields were added.
 *
 * Run with: node scripts/backfill-contact-info.js
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const BOSS_API_HOST = 'http://100.96.203.105:8003';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * Fetch subscriber contact info from BOSS API (1Map data)
 */
async function fetchSubscriberContact(dropNumber) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    // Build full name from first + last
    const firstName = data.contact_person_name || data.contact_name || '';
    const lastName = data.contact_person_surname || data.contact_surname || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

    return {
      subscriber_name: fullName,
      subscriber_phone: data.contact_number || data.contact_phone || null,
      subscriber_email: data.email_address || data.contact_email || null,
      subscriber_language: data.language || null,
      signup_agent: data.signup_agent || null,
      installer_name: data.installer_name || null,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Fetch QContact info from maintenance_tickets table
 */
async function fetchQContactInfo(dropNumber) {
  try {
    const result = await pool.query(
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

    const row = result.rows[0];
    return {
      qcontact_name: row.client_name || null,
      qcontact_phone: row.client_contact || null,
      qcontact_email: row.client_email || null,
    };
  } catch (error) {
    return null;
  }
}

async function backfill() {
  console.log('=== BACKFILL CONTACT INFO ===');
  console.log('Finding DRs without contact info...\n');

  // Find DRs that have no contact info stored
  const result = await pool.query(`
    SELECT drop_number
    FROM dr_photo_unified_reviews
    WHERE subscriber_name IS NULL
      AND subscriber_phone IS NULL
      AND qcontact_name IS NULL
      AND qcontact_phone IS NULL
    ORDER BY created_at DESC
    LIMIT 100
  `);

  const drsToBackfill = result.rows;
  console.log(`Found ${drsToBackfill.length} DRs to backfill\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of drsToBackfill) {
    const dropNumber = row.drop_number;
    process.stdout.write(`Processing ${dropNumber}... `);

    // Fetch contact info from BOSS API and maintenance_tickets
    const [subscriberContact, qContactInfo] = await Promise.all([
      fetchSubscriberContact(dropNumber),
      fetchQContactInfo(dropNumber),
    ]);

    // Skip if no contact info found
    if (!subscriberContact && !qContactInfo) {
      console.log('no contact info found, skipping');
      skipped++;
      continue;
    }

    // Update the unified table
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         subscriber_name = COALESCE($2, subscriber_name),
         subscriber_phone = COALESCE($3, subscriber_phone),
         subscriber_email = COALESCE($4, subscriber_email),
         subscriber_language = COALESCE($5, subscriber_language),
         signup_agent = COALESCE($6, signup_agent),
         installer_name = COALESCE($7, installer_name),
         qcontact_name = COALESCE($8, qcontact_name),
         qcontact_phone = COALESCE($9, qcontact_phone),
         qcontact_email = COALESCE($10, qcontact_email),
         updated_at = NOW()
       WHERE drop_number = $1`,
      [
        dropNumber,
        subscriberContact?.subscriber_name || null,
        subscriberContact?.subscriber_phone || null,
        subscriberContact?.subscriber_email || null,
        subscriberContact?.subscriber_language || null,
        subscriberContact?.signup_agent || null,
        subscriberContact?.installer_name || null,
        qContactInfo?.qcontact_name || null,
        qContactInfo?.qcontact_phone || null,
        qContactInfo?.qcontact_email || null,
      ]
    );

    const contactInfo = [];
    if (subscriberContact?.subscriber_name) contactInfo.push(`1Map: ${subscriberContact.subscriber_name}`);
    if (qContactInfo?.qcontact_name) contactInfo.push(`QContact: ${qContactInfo.qcontact_name}`);

    console.log(`updated (${contactInfo.join(', ') || 'partial data'})`);
    updated++;
  }

  console.log(`\n=== BACKFILL COMPLETE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total: ${drsToBackfill.length}`);

  await pool.end();
}

backfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
