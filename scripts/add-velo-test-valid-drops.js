#!/usr/bin/env node
/**
 * Add Mock Valid Drop Numbers for Velo Test
 *
 * PURPOSE: Create test data for drop validation in Velo Test group
 *
 * MOCK DROPS:
 *   Valid: DR1111111, DR1111112, DR1111113, DR1111114, DR1111115
 *   Invalid: Any other DR numbers (for testing rejection)
 *
 * USAGE: node scripts/add-velo-test-valid-drops.js
 */

const { Client } = require('pg');

const DATABASE_URL = 'process.env.DATABASE_URL';

const MOCK_DROPS = [
  'DR1111111',
  'DR1111112',
  'DR1111113',
  'DR1111114',
  'DR1111115',
  'DR2222222',
  'DR2222223',
  'DR2222224',
  'DR2222225',
  'DR3333331'  // Note: DR3333333 intentionally NOT in list for testing rejection
];

async function addMockDrops() {
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('🚀 Adding mock valid drops for Velo Test...\n');

    for (const drop of MOCK_DROPS) {
      await client.query(`
        INSERT INTO valid_drop_numbers (drop_number, project, sync_source, sync_timestamp)
        VALUES ($1, 'Velo Test', 'mock_test_data', NOW())
        ON CONFLICT (drop_number) DO UPDATE SET
          project = 'Velo Test',
          sync_source = 'mock_test_data',
          sync_timestamp = NOW()
      `, [drop]);

      console.log(`   ✅ ${drop}`);
    }

    // Verify
    const result = await client.query(`
      SELECT COUNT(*) as count FROM valid_drop_numbers WHERE project = 'Velo Test'
    `);

    console.log(`\n📊 Total Velo Test drops in database: ${result.rows[0].count}`);
    console.log('\n✅ Mock data added successfully!\n');
    console.log('📝 TEST CASES:');
    console.log('   Valid drops (should accept): DR1111111, DR1111112, DR1111113, DR1111114, DR1111115');
    console.log('   Valid drops (should accept): DR2222222, DR2222223, DR2222224, DR2222225, DR3333331');
    console.log('   Invalid drop (should reject): DR3333333, DR9999999, DR8888888, etc.\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

addMockDrops();
