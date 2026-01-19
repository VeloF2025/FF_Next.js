/**
 * Script to update all staff WhatsApp IDs from their phone numbers
 *
 * Converts phone numbers to WhatsApp JID format:
 * - 083 123 4567 -> 27831234567@s.whatsapp.net
 * - 0795565868 -> 27795565868@s.whatsapp.net
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');
neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const pool = new Pool({ connectionString: DATABASE_URL });

function phoneToWhatsAppJid(phone) {
  if (!phone) return null;

  // Remove all non-digit characters
  let cleaned = phone.replace(/[^0-9]/g, '');

  if (cleaned.length === 0) return null;

  // Convert to international format (South Africa = 27)
  if (cleaned.startsWith('0')) {
    cleaned = '27' + cleaned.substring(1);
  } else if (!cleaned.startsWith('27')) {
    cleaned = '27' + cleaned;
  }

  // Validate length (should be 11 digits for SA: 27 + 9 digits)
  if (cleaned.length < 11 || cleaned.length > 12) {
    console.warn(`  Warning: Unusual phone length for ${phone} -> ${cleaned}`);
  }

  return cleaned + '@s.whatsapp.net';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(dryRun ? '\n=== DRY RUN MODE ===' : '\n=== UPDATING WHATSAPP IDS ===');
  console.log('');

  // Get all staff with phone numbers
  const result = await pool.query(`
    SELECT id, first_name, last_name, phone, whatsapp_id
    FROM staff
    WHERE phone IS NOT NULL AND phone != ''
    ORDER BY first_name, last_name
  `);

  console.log(`Found ${result.rows.length} staff members with phone numbers\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const staff of result.rows) {
    const newWhatsappId = phoneToWhatsAppJid(staff.phone);
    const name = `${staff.first_name} ${staff.last_name}`;

    if (!newWhatsappId) {
      console.log(`  SKIP: ${name} - invalid phone: ${staff.phone}`);
      skipped++;
      continue;
    }

    if (staff.whatsapp_id === newWhatsappId) {
      console.log(`  OK: ${name} - already set: ${newWhatsappId}`);
      skipped++;
      continue;
    }

    console.log(`  UPDATE: ${name}: ${staff.phone} -> ${newWhatsappId}`);

    if (!dryRun) {
      try {
        await pool.query(
          'UPDATE staff SET whatsapp_id = $1, updated_at = NOW() WHERE id = $2',
          [newWhatsappId, staff.id]
        );
        updated++;
      } catch (err) {
        console.error(`  ERROR: Failed to update ${name}: ${err.message}`);
        errors++;
      }
    } else {
      updated++;
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors: ${errors}`);

  if (dryRun) {
    console.log('\nRun without --dry-run to apply changes');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
