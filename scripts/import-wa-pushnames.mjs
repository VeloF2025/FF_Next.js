#!/usr/bin/env node
/**
 * Import WhatsApp Push Names to wa_contacts table
 *
 * Updates wa_display_name field with push names from WhatsApp bridge contacts
 *
 * Usage: node scripts/import-wa-pushnames.mjs
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

// Use production database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

async function importPushNames() {
  console.log('📱 Importing WhatsApp push names to wa_contacts...\n');

  // Read the CSV file
  const csvPath = '/tmp/wa_contacts_pushnames.csv';
  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV file not found:', csvPath);
    console.log('Run this first on VPS:');
    console.log('sqlite3 -csv /opt/whatsapp-bridge/store/whatsapp.db "SELECT their_jid, push_name FROM whatsmeow_contacts WHERE push_name IS NOT NULL AND their_jid LIKE \'%@lid\'" > /tmp/wa_contacts_pushnames.csv');
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.trim().split('\n');

  console.log(`Found ${lines.length} contacts with push names\n`);

  let updated = 0;
  let notFound = 0;
  let alreadySet = 0;

  for (const line of lines) {
    // Parse CSV line (handle quoted values with commas)
    const match = line.match(/^([^,]+),(.+)$/);
    if (!match) continue;

    const jid = match[1];
    let pushName = match[2];

    // Remove quotes if present
    if (pushName.startsWith('"') && pushName.endsWith('"')) {
      pushName = pushName.slice(1, -1);
    }

    // Extract numeric LID (remove @lid suffix)
    const lid = jid.replace('@lid', '');

    // Check if this LID exists in wa_contacts
    const result = await pool.query(
      `SELECT id, sender_phone, wa_display_name, formal_name
       FROM wa_contacts
       WHERE sender_phone = $1`,
      [lid]
    );

    if (result.rows.length === 0) {
      notFound++;
      continue;
    }

    const contact = result.rows[0];

    // Skip if wa_display_name is already set to this value
    if (contact.wa_display_name === pushName) {
      alreadySet++;
      continue;
    }

    // Update wa_display_name
    await pool.query(
      `UPDATE wa_contacts
       SET wa_display_name = $1, updated_at = NOW()
       WHERE id = $2`,
      [pushName, contact.id]
    );

    console.log(`✅ ${lid} → "${pushName}"${contact.formal_name ? ` (formal: ${contact.formal_name})` : ''}`);
    updated++;
  }

  console.log('\n📊 Summary:');
  console.log(`   Updated: ${updated}`);
  console.log(`   Already set: ${alreadySet}`);
  console.log(`   Not found in wa_contacts: ${notFound}`);

  await pool.end();
}

importPushNames().catch(console.error);
