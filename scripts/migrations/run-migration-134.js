const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '134_qfield_projects.sql'),
      'utf8'
    );
    console.log('Running migration 134: QField Projects...');
    await pool.query(sql);
    console.log('Migration 134 completed successfully');
  } catch (error) {
    console.error('Migration 134 failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
