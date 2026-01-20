#!/usr/bin/env node
/**
 * Migration Runner: 102_stock_categories.sql
 * Creates dynamic hierarchical stock categories
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  const migrationPath = path.join(__dirname, '102_stock_categories.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  console.log('🚀 Running migration 102: Stock Categories');
  console.log('📁 File:', migrationPath);

  const client = await pool.connect();

  try {
    console.log('  → Executing migration...');
    await client.query(migrationSql);

    // Verify migration
    const { rows: categories } = await client.query(
      'SELECT code, name FROM stock_categories ORDER BY sort_order'
    );
    console.log('\n✅ Migration complete!');
    console.log(`📦 Categories created: ${categories.length}`);
    categories.forEach(c => console.log(`   - ${c.code}: ${c.name}`));

    // Check stock_items update
    const { rows: itemsResult } = await client.query(
      'SELECT COUNT(*) as count FROM stock_items WHERE category_id IS NOT NULL'
    );
    console.log(`📋 Stock items migrated: ${itemsResult[0].count}`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Some objects already exist - attempting to verify...');
      try {
        const { rows: categories } = await client.query(
          'SELECT code, name FROM stock_categories ORDER BY sort_order'
        );
        console.log(`📦 Existing categories: ${categories.length}`);
        categories.forEach(c => console.log(`   - ${c.code}: ${c.name}`));
      } catch (e) {
        console.error('Could not verify:', e.message);
      }
    } else {
      console.error(error);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
