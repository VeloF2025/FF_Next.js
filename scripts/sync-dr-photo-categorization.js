#!/usr/bin/env node
/**
 * DR Photo Categorization Sync Script
 *
 * Purpose: Polls for new DRs from WA Monitor and triggers photo categorization
 *
 * This script:
 * 1. Finds DRs in qa_photo_reviews that don't have dr_photo_unified_reviews records
 * 2. Creates records in dr_photo_unified_reviews
 * 3. Triggers photo fetch + VLM categorization
 *
 * Run as: node scripts/sync-dr-photo-categorization.js
 * Or set up as cron job: */5 * * * * node /path/to/sync-dr-photo-categorization.js
 */

const https = require('https');
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'process.env.DATABASE_URL',
});

// FibreFlow API base URL
const API_BASE = process.env.FIBREFLOW_API_URL || 'https://vf.fibreflow.app';

/**
 * Find DRs that need processing
 */
async function findUnprocessedDRs() {
  const result = await pool.query(`
    SELECT
      qa.drop_number,
      qa.project,
      qa.created_at
    FROM qa_photo_reviews qa
    LEFT JOIN dr_photo_unified_reviews unified
      ON qa.drop_number = unified.drop_number
    WHERE
      unified.drop_number IS NULL
      AND qa.created_at > NOW() - INTERVAL '7 days'
    ORDER BY qa.created_at DESC
    LIMIT 20
  `);

  return result.rows;
}

/**
 * Create unified review record
 */
async function createUnifiedReview(dropNumber, project) {
  const result = await pool.query(`
    INSERT INTO dr_photo_unified_reviews (drop_number, project, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    ON CONFLICT (drop_number) DO NOTHING
    RETURNING id
  `, [dropNumber, project]);

  return result.rows.length > 0;
}

/**
 * Trigger photo categorization via webhook
 */
async function triggerCategorization(dropNumber, project) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}/api/activate/process-new-dr`);

    const payload = JSON.stringify({
      dropNumber,
      project,
    });

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 120000, // 2 minute timeout for VLM processing
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Main sync function
 */
async function sync() {
  console.log(`[${new Date().toISOString()}] Starting DR Photo Categorization Sync...`);

  try {
    // Find unprocessed DRs
    const unprocessedDRs = await findUnprocessedDRs();
    console.log(`Found ${unprocessedDRs.length} unprocessed DRs`);

    if (unprocessedDRs.length === 0) {
      console.log('No new DRs to process');
      return;
    }

    // Process each DR
    for (const dr of unprocessedDRs) {
      const { drop_number, project } = dr;
      console.log(`\nProcessing ${drop_number} (${project})`);

      try {
        // Create unified review record
        const created = await createUnifiedReview(drop_number, project);
        if (created) {
          console.log(`  ✓ Created unified review record`);
        } else {
          console.log(`  ⚠ Record already exists`);
        }

        // Trigger categorization
        console.log(`  → Triggering photo categorization...`);
        const result = await triggerCategorization(drop_number, project);
        console.log(`  ✓ Categorization: ${result.data?.categorizationStatus || 'triggered'}`);
        console.log(`    Photos: ${result.data?.photosDownloaded || 0}`);

      } catch (error) {
        console.error(`  ✗ Error processing ${drop_number}: ${error.message}`);
      }

      // Small delay between DRs to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('\nSync complete');

  } catch (error) {
    console.error('Sync error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run sync
sync().catch(console.error);
