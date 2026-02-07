#!/usr/bin/env node
/**
 * Import Approved Marketing Drops from CSV
 *
 * Usage: node scripts/marketing/import-approved-drops.js /path/to/approved_drops.csv
 *
 * CSV Format:
 * drop_number
 * DR1733351
 * DR1734280
 * DR1857292
 */

const fs = require('fs');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function importApprovedDrops(csvPath) {
  console.log('📥 Marketing Activations - Import Approved Drops');
  console.log('================================================\n');

  // Check file exists
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Error: File not found: ${csvPath}`);
    process.exit(1);
  }

  // Read CSV file
  const fileContent = fs.readFileSync(csvPath, 'utf8');
  const lines = fileContent.trim().split('\n');

  // Remove header if it exists
  const header = lines[0].toLowerCase();
  const dropNumbers = header.includes('drop') ? lines.slice(1) : lines;

  // Clean and validate drop numbers
  const validDrops = dropNumbers
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => /^DR\d+$/i.test(line))
    .map(line => line.toUpperCase());

  if (validDrops.length === 0) {
    console.error('❌ Error: No valid drop numbers found in CSV');
    console.error('   Expected format: DR followed by numbers (e.g., DR1733351)');
    process.exit(1);
  }

  console.log(`✅ Found ${validDrops.length} valid drop numbers\n`);

  // Connect to database
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // Start transaction
    await client.query('BEGIN');

    // Clear old approved drops
    const deleteResult = await client.query('DELETE FROM approved_marketing_drops');
    console.log(`🗑️  Cleared ${deleteResult.rowCount} old approved drops`);

    // Insert new approved drops
    const today = new Date().toISOString().split('T')[0];
    let insertedCount = 0;

    for (const dropNumber of validDrops) {
      try {
        await client.query(
          `INSERT INTO approved_marketing_drops (drop_number, import_date)
           VALUES ($1, $2)
           ON CONFLICT (drop_number) DO NOTHING`,
          [dropNumber, today]
        );
        insertedCount++;
      } catch (err) {
        console.warn(`⚠️  Warning: Failed to insert ${dropNumber}: ${err.message}`);
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`\n✅ Successfully imported ${insertedCount} approved drops`);
    console.log(`📅 Import date: ${today}`);

    // Show sample
    const sampleResult = await client.query(
      'SELECT drop_number FROM approved_marketing_drops ORDER BY drop_number LIMIT 10'
    );
    console.log(`\n📋 Sample of approved drops:`);
    sampleResult.rows.forEach(row => console.log(`   ${row.drop_number}`));
    if (validDrops.length > 10) {
      console.log(`   ... and ${validDrops.length - 10} more`);
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\n❌ Error during import: ${error.message}`);
    throw error;
  } finally {
    await client.end();
  }
}

// Main execution
if (require.main === module) {
  const csvPath = process.argv[2];

  if (!csvPath) {
    console.error('Usage: node import-approved-drops.js /path/to/approved_drops.csv');
    process.exit(1);
  }

  importApprovedDrops(csvPath)
    .then(() => {
      console.log('\n✅ Import complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Import failed:', error.message);
      process.exit(1);
    });
}

module.exports = { importApprovedDrops };
