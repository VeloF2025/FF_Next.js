#!/usr/bin/env node
/**
 * Backfill WhatsApp Threading Data
 *
 * Syncs threading data from VPS messages.db (SQLite) to Neon PostgreSQL.
 * This enables threaded replies to technician DR submissions.
 *
 * Usage:
 *   node scripts/backfill-wa-threading.js              # Dry run (preview only)
 *   node scripts/backfill-wa-threading.js --execute    # Actually update database
 *   node scripts/backfill-wa-threading.js --execute --table=qa_photo_reviews  # Backfill legacy table
 *
 * Sources:
 *   - VPS: /home/louis/whatsapp-bridge-go/store/messages.db
 *   - Target: dr_photo_unified_reviews (default) or qa_photo_reviews
 */

const { execSync } = require('child_process');
const { neon } = require('@neondatabase/serverless');

// Configuration
const CONFIG = {
  vps: {
    host: '100.96.203.105',
    user: 'velo',
    password: '$VELO_SSH_PASSWORD',
    messagesDb: '/home/louis/whatsapp-bridge-go/store/messages.db',
  },
  database: {
    url: process.env.DATABASE_URL ||
      'process.env.DATABASE_URL',
  },
  // Group JID to project mapping
  groupMappings: {
    '120363418298130331@g.us': 'Lawley',
    '120363421532174586@g.us': 'Mohadin',
    '120363421664266245@g.us': 'Velo Test',
    '120363408849234743@g.us': 'Mamelodi',
  },
};

// Parse command line args
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const targetTableArg = args.find(a => a.startsWith('--table='));
const TARGET_TABLE = targetTableArg
  ? targetTableArg.split('=')[1]
  : 'dr_photo_unified_reviews';

// Logging helpers
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  success: (msg) => console.log(`[✓] ${msg}`),
  warn: (msg) => console.log(`[⚠] ${msg}`),
  error: (msg) => console.error(`[✗] ${msg}`),
  dry: (msg) => console.log(`[DRY-RUN] ${msg}`),
};

/**
 * Fetch messages from VPS SQLite database via SSH
 * Uses base64-encoded Python script to avoid shell quoting issues
 */
async function fetchMessagesFromVPS() {
  log.info('Connecting to VPS to fetch WhatsApp messages...');

  const pythonScript = `
import sqlite3
import json

conn = sqlite3.connect("${CONFIG.vps.messagesDb}")
cursor = conn.cursor()

cursor.execute("""
    SELECT id, chat_jid, sender, content, timestamp
    FROM messages
    WHERE content LIKE 'DR%'
      AND is_from_me = 0
      AND LENGTH(TRIM(content)) <= 20
    ORDER BY timestamp DESC
""")

messages = []
for row in cursor.fetchall():
    dr = row[3].strip().upper()
    if dr.startswith("DR"):
        digits = "".join(c for c in dr[2:] if c.isdigit())
        dr = "DR" + digits

    messages.append({
        "message_id": row[0],
        "group_jid": row[1],
        "sender_jid": row[2],
        "drop_number": dr,
        "timestamp": row[4],
        "original_text": row[3].strip()
    })

print(json.dumps(messages))
conn.close()
`;

  try {
    // Base64 encode the script to avoid shell quoting issues
    const encodedScript = Buffer.from(pythonScript).toString('base64');
    const command = `sshpass -p '${CONFIG.vps.password}' ssh ${CONFIG.vps.user}@${CONFIG.vps.host} "echo '${encodedScript}' | base64 -d | python3"`;

    const result = execSync(command, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large result sets
    });

    const messages = JSON.parse(result);
    log.success(`Fetched ${messages.length} DR messages from VPS`);
    return messages;
  } catch (error) {
    log.error(`Failed to fetch messages from VPS: ${error.message}`);
    throw error;
  }
}

/**
 * Get existing records from target table
 */
async function getExistingRecords(sql) {
  log.info(`Fetching existing records from ${TARGET_TABLE}...`);

  let query;
  if (TARGET_TABLE === 'dr_photo_unified_reviews') {
    query = sql`
      SELECT drop_number, wa_message_id, wa_sender_jid, wa_group_jid, project
      FROM dr_photo_unified_reviews
      WHERE drop_number IS NOT NULL
    `;
  } else if (TARGET_TABLE === 'qa_photo_reviews') {
    // Legacy table - check if columns exist first
    query = sql`
      SELECT drop_number, project, whatsapp_message_date
      FROM qa_photo_reviews
      WHERE drop_number IS NOT NULL
    `;
  } else {
    throw new Error(`Unknown target table: ${TARGET_TABLE}`);
  }

  const records = await query;
  log.success(`Found ${records.length} records in ${TARGET_TABLE}`);
  return records;
}

/**
 * Check if legacy table has threading columns
 */
async function checkLegacyTableColumns(sql) {
  if (TARGET_TABLE !== 'qa_photo_reviews') return true;

  const columns = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'qa_photo_reviews'
    AND column_name IN ('wa_message_id', 'wa_sender_jid', 'wa_group_jid', 'wa_original_text')
  `;

  if (columns.length < 4) {
    log.warn('Legacy table missing threading columns. Need to add them first.');
    return false;
  }
  return true;
}

/**
 * Add threading columns to legacy table if needed
 */
async function addThreadingColumnsToLegacy(sql) {
  log.info('Adding threading columns to qa_photo_reviews...');

  if (DRY_RUN) {
    log.dry('Would add columns: wa_message_id, wa_sender_jid, wa_group_jid, wa_original_text');
    return;
  }

  await sql`
    ALTER TABLE qa_photo_reviews
    ADD COLUMN IF NOT EXISTS wa_message_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS wa_sender_jid VARCHAR(64),
    ADD COLUMN IF NOT EXISTS wa_group_jid VARCHAR(64),
    ADD COLUMN IF NOT EXISTS wa_original_text TEXT
  `;

  log.success('Added threading columns to qa_photo_reviews');
}

/**
 * Match messages to records and prepare updates
 */
function matchMessagesToRecords(messages, records) {
  log.info('Matching messages to database records...');

  // Create lookup map for records
  const recordMap = new Map();
  for (const record of records) {
    const key = record.drop_number?.toUpperCase();
    if (key) {
      // If multiple records for same DR, keep the one without threading
      const existing = recordMap.get(key);
      if (!existing || existing.wa_message_id) {
        recordMap.set(key, record);
      }
    }
  }

  // Match messages to records
  const updates = [];
  const matched = new Set();
  const unmatched = [];

  for (const msg of messages) {
    const drNumber = msg.drop_number?.toUpperCase();
    if (!drNumber || matched.has(drNumber)) continue;

    const record = recordMap.get(drNumber);
    if (record) {
      // Skip if already has threading data
      if (record.wa_message_id) {
        continue;
      }

      updates.push({
        drop_number: drNumber,
        wa_message_id: msg.message_id,
        wa_sender_jid: msg.sender_jid,
        wa_group_jid: msg.group_jid,
        wa_original_text: msg.original_text,
        wa_received_at: msg.timestamp,
      });
      matched.add(drNumber);
    } else {
      unmatched.push(msg);
    }
  }

  log.success(`Matched ${updates.length} messages to records`);
  log.info(`${unmatched.length} messages have no matching record`);

  return { updates, unmatched };
}

/**
 * Apply updates to database
 */
async function applyUpdates(sql, updates) {
  if (updates.length === 0) {
    log.info('No updates to apply');
    return { updated: 0, failed: 0 };
  }

  log.info(`Applying ${updates.length} updates to ${TARGET_TABLE}...`);

  if (DRY_RUN) {
    log.dry(`Would update ${updates.length} records:`);
    updates.slice(0, 10).forEach(u => {
      log.dry(`  ${u.drop_number}: msg_id=${u.wa_message_id.slice(0, 16)}...`);
    });
    if (updates.length > 10) {
      log.dry(`  ... and ${updates.length - 10} more`);
    }
    return { updated: 0, failed: 0 };
  }

  let updated = 0;
  let failed = 0;

  for (const update of updates) {
    try {
      if (TARGET_TABLE === 'dr_photo_unified_reviews') {
        await sql`
          UPDATE dr_photo_unified_reviews
          SET
            wa_message_id = ${update.wa_message_id},
            wa_sender_jid = ${update.wa_sender_jid},
            wa_group_jid = ${update.wa_group_jid},
            wa_original_text = ${update.wa_original_text},
            wa_received_at = ${update.wa_received_at}::timestamptz
          WHERE drop_number = ${update.drop_number}
            AND (wa_message_id IS NULL OR wa_message_id = '')
        `;
      } else {
        await sql`
          UPDATE qa_photo_reviews
          SET
            wa_message_id = ${update.wa_message_id},
            wa_sender_jid = ${update.wa_sender_jid},
            wa_group_jid = ${update.wa_group_jid},
            wa_original_text = ${update.wa_original_text}
          WHERE drop_number = ${update.drop_number}
            AND (wa_message_id IS NULL OR wa_message_id = '')
        `;
      }
      updated++;
    } catch (error) {
      log.error(`Failed to update ${update.drop_number}: ${error.message}`);
      failed++;
    }
  }

  log.success(`Updated ${updated} records, ${failed} failed`);
  return { updated, failed };
}

/**
 * Print summary statistics
 */
async function printSummary(sql, startTime) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Get current threading stats
  let stats;
  if (TARGET_TABLE === 'dr_photo_unified_reviews') {
    stats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(wa_message_id) as with_threading,
        COUNT(*) - COUNT(wa_message_id) as without_threading
      FROM dr_photo_unified_reviews
    `;
  } else {
    stats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(wa_message_id) as with_threading,
        COUNT(*) - COUNT(wa_message_id) as without_threading
      FROM qa_photo_reviews
    `;
  }

  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL SUMMARY');
  console.log('='.repeat(60));
  console.log(`Target Table: ${TARGET_TABLE}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes made)' : 'EXECUTE'}`);
  console.log(`Duration: ${elapsed}s`);
  console.log('');
  console.log(`Total Records: ${stats[0].total}`);
  console.log(`With Threading: ${stats[0].with_threading}`);
  console.log(`Without Threading: ${stats[0].without_threading}`);
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('\nTo apply changes, run with --execute flag:');
    console.log(`  node scripts/backfill-wa-threading.js --execute${TARGET_TABLE !== 'dr_photo_unified_reviews' ? ` --table=${TARGET_TABLE}` : ''}`);
  }
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();

  console.log('='.repeat(60));
  console.log('WhatsApp Threading Data Backfill');
  console.log('='.repeat(60));
  console.log(`Target: ${TARGET_TABLE}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);
  console.log('');

  try {
    // Initialize database connection
    const sql = neon(CONFIG.database.url);

    // Check/add columns for legacy table
    if (TARGET_TABLE === 'qa_photo_reviews') {
      const hasColumns = await checkLegacyTableColumns(sql);
      if (!hasColumns) {
        await addThreadingColumnsToLegacy(sql);
      }
    }

    // Fetch data from both sources
    const messages = await fetchMessagesFromVPS();
    const records = await getExistingRecords(sql);

    // Match and prepare updates
    const { updates, unmatched } = matchMessagesToRecords(messages, records);

    // Apply updates
    await applyUpdates(sql, updates);

    // Print summary
    await printSummary(sql, startTime);

  } catch (error) {
    log.error(`Backfill failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run
main();
