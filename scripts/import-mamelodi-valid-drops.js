#!/usr/bin/env node
/**
 * Import Mamelodi valid drop numbers from local Excel file
 *
 * PURPOSE: Populates valid_drop_numbers table for WA Monitor drop validation
 *
 * SOURCE:
 *   File: ~/Downloads/HLD HOME_Mamelodi POP1.xlsx
 *   Sheet: HLD_Home (assumed)
 *   Column: A (labels/drop numbers)
 *
 * DESTINATION:
 *   Database: Neon PostgreSQL
 *   Table: valid_drop_numbers
 *   Project: 'Mamelodi'
 *
 * FEATURES:
 *   - Reads local Excel file using xlsx library
 *   - Batch insert (500 records per batch)
 *   - Idempotent (ON CONFLICT DO UPDATE)
 *   - Filters for DR numbers only
 *
 * USAGE:
 *   node scripts/import-mamelodi-valid-drops.js
 *
 * CREATED: November 14, 2025
 * VERSION: 1.0
 */

const XLSX = require('xlsx');
const { Client } = require('pg');
const path = require('path');
const os = require('os');

// Configuration
const EXCEL_FILE = path.join(os.homedir(), 'Downloads', 'HLD HOME_Mamelodi POP1.xlsx');
const SHEET_NAME = 'HLD_Home'; // Try this first, will auto-detect if wrong
const DATABASE_URL = 'process.env.DATABASE_URL';

async function readExcelFile() {
  console.log('📖 Reading Excel file...');
  console.log(`   File: ${EXCEL_FILE}\n`);

  // Read workbook
  const workbook = XLSX.readFile(EXCEL_FILE);

  // Get sheet name (try HLD_Home first, otherwise use first sheet)
  let sheetName = SHEET_NAME;
  if (!workbook.SheetNames.includes(SHEET_NAME)) {
    console.log(`⚠️  Sheet "${SHEET_NAME}" not found. Available sheets:`);
    workbook.SheetNames.forEach(name => console.log(`   - ${name}`));
    sheetName = workbook.SheetNames[0];
    console.log(`\n   Using first sheet: ${sheetName}\n`);
  } else {
    console.log(`✅ Found sheet: ${sheetName}\n`);
  }

  // Get worksheet
  const worksheet = workbook.Sheets[sheetName];

  // Convert to JSON (first column only)
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  // Extract column A (index 0), filter for DR numbers
  const dropNumbers = data
    .map(row => row[0]) // Get first column
    .filter(val => val && typeof val === 'string' && val.toUpperCase().startsWith('DR'))
    .map(val => val.toUpperCase().replace(/\s/g, '')); // Normalize

  // Remove duplicates
  const uniqueDrops = [...new Set(dropNumbers)];

  console.log(`📊 Extracted ${uniqueDrops.length} unique drop numbers`);
  console.log(`   First: ${uniqueDrops[0]}`);
  console.log(`   Last: ${uniqueDrops[uniqueDrops.length - 1]}\n`);

  return uniqueDrops;
}

async function insertToNeon(dropNumbers) {
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('📝 Inserting drop numbers to Neon...\n');

    // Batch insert - 500 at a time
    const batchSize = 500;
    let inserted = 0;

    for (let i = 0; i < dropNumbers.length; i += batchSize) {
      const batch = dropNumbers.slice(i, i + batchSize);

      const values = batch.map((_, idx) => `($${idx + 1}, 'Mamelodi', 'local_excel_import', NOW())`).join(',');
      const query = `
        INSERT INTO valid_drop_numbers (drop_number, project, sync_source, sync_timestamp)
        VALUES ${values}
        ON CONFLICT (drop_number) DO UPDATE SET
          sync_timestamp = NOW(),
          sync_source = 'local_excel_import'
      `;

      await client.query(query, batch);
      inserted += batch.length;

      process.stdout.write(`\r   Inserted: ${inserted}/${dropNumbers.length}`);
    }

    console.log('\n✅ Insert complete!\n');

    // Verify
    const result = await client.query(`
      SELECT COUNT(*) as count FROM valid_drop_numbers WHERE project = 'Mamelodi'
    `);

    console.log(`📊 Total Mamelodi drops in database: ${result.rows[0].count}`);

  } finally {
    await client.end();
  }
}

async function main() {
  try {
    console.log('🚀 Importing Mamelodi valid drop numbers from Excel...\n');

    const dropNumbers = await readExcelFile();
    await insertToNeon(dropNumbers);

    console.log('\n✅ IMPORT COMPLETE!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 'ENOENT') {
      console.error('\n💡 File not found. Please ensure the file exists at:');
      console.error(`   ${EXCEL_FILE}`);
    }
    process.exit(1);
  }
}

main();
