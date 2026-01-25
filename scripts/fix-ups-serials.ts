/**
 * Fix UPS Serials Script
 *
 * This script fixes DRs where the OLT report fix updated ONT serial
 * but the UPS serial was lost because Column V contained the UPS serial
 * (technician had swapped ONT and UPS).
 *
 * For these DRs, we ONLY update ph_ups since ph_ont was already corrected.
 *
 * Usage:
 *   npx tsx scripts/fix-ups-serials.ts [--dry-run]
 *
 * Options:
 *   --dry-run  Show what would be updated without making changes
 */

import { Pool } from 'pg';

const ONEMAP_EMAIL = process.env.ONEMAP_EMAIL || 'hein@velocityfibre.co.za';
const ONEMAP_PASSWORD = process.env.ONEMAP_PASSWORD || 'VeloF@2025';
const LAYER_ID = '5121';
const BASE_URL = 'https://www.1map.co.za';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Simple OneMap client for this script
class OneMapClient {
  private sessionCookie: string | null = null;

  async authenticate(): Promise<boolean> {
    try {
      // Step 1: GET login page for CSRF token
      console.log('  Authenticating with 1Map...');
      const loginPage = await fetch(`${BASE_URL}/login`);
      const html = await loginPage.text();
      const csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/);
      const csrf = csrfMatch ? csrfMatch[1] : null;

      if (!csrf) {
        console.error('  Failed to extract CSRF token');
        return false;
      }

      const setCookie = loginPage.headers.get('set-cookie') || '';
      const cookieJar = setCookie
        .split(',')
        .map((c) => c.split(';')[0].trim())
        .join('; ');

      // Step 2: POST login
      const loginResponse = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieJar,
        },
        body: new URLSearchParams({
          _csrf: csrf,
          email: ONEMAP_EMAIL,
          password: ONEMAP_PASSWORD,
        }).toString(),
        redirect: 'manual',
      });

      const respCookies = loginResponse.headers.get('set-cookie') || '';
      const sidMatch = respCookies.match(/connect\.sid=([^;]+)/);
      if (!sidMatch) {
        console.error('  Failed to get session cookie');
        return false;
      }
      this.sessionCookie = sidMatch[1];

      // Step 3: Visit app to initialize layer access
      await fetch(`${BASE_URL}/app?layer=${LAYER_ID}`, {
        headers: { Cookie: `connect.sid=${this.sessionCookie}` },
      });

      console.log('  Authentication successful');
      return true;
    } catch (error) {
      console.error('  Authentication failed:', error);
      return false;
    }
  }

  async searchDR(drNumber: string): Promise<{ propId: string; phOnt: string | null; brSer: string | null } | null> {
    const formData = new URLSearchParams({
      ungeocoded: 'false',
      left: '0',
      bottom: '0',
      right: '0',
      top: '0',
      selfilter: '',
      action: 'get',
      email: ONEMAP_EMAIL,
      layerid: LAYER_ID,
      sort: 'prop_id',
      templateExpression: '',
      q: drNumber,
      page: '1',
      start: '0',
      limit: '50',
    });

    const response = await fetch(`${BASE_URL}/api/apps/app/getattributes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Cookie: `connect.sid=${this.sessionCookie}`,
      },
      body: formData.toString(),
    });

    const result = await response.json();
    if (!result.success) return null;

    const records = (result.result || []).filter((r: { drp: string }) => r.drp === drNumber);
    if (records.length === 0) return null;

    // Get the record with highest prop_id (most recent)
    const target = records.sort((a: { prop_id: string }, b: { prop_id: string }) =>
      parseInt(b.prop_id) - parseInt(a.prop_id)
    )[0];

    return {
      propId: target.prop_id,
      phOnt: target.ph_ont,
      brSer: target.br_ser,
    };
  }

  async updateUpsSerial(propId: string, upsSerial: string): Promise<{ success: boolean; response: string }> {
    const formData = new URLSearchParams({
      action: 'update',
      layerid: LAYER_ID,
      sort: 'prop_id',
      templateExpression: '',
      start: '0',
      limit: '50',
      bottom: '0',
      left: '0',
      right: '0',
      top: '0',
      selfilter: 'null',
      ungeocoded: 'false',
      items: JSON.stringify({ prop_id: propId, br_ser: upsSerial }),
    });

    const response = await fetch(`${BASE_URL}/api/apps/app/attributes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Cookie: `connect.sid=${this.sessionCookie}`,
      },
      body: formData.toString(),
    });

    const text = await response.text();
    const success = response.ok && text.includes('"success":true');
    return { success, response: text.substring(0, 500) };
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(60));
  console.log('FIX UPS SERIALS SCRIPT');
  console.log(isDryRun ? '*** DRY RUN MODE - No changes will be made ***' : '*** LIVE MODE - Changes will be applied ***');
  console.log('='.repeat(60));
  console.log('');

  const client = await pool.connect();
  const oneMap = new OneMapClient();

  try {
    // Find affected DRs
    const result = await client.query(`
      SELECT drop_number, olt_serial, wrong_onemap_serial
      FROM olt_mismatch_records
      WHERE fix_status = 'fixed'
        AND wrong_onemap_serial LIKE 'GU18%'
      ORDER BY fix_attempted_at DESC
    `);

    console.log(`Found ${result.rows.length} affected DRs`);
    console.log('');

    if (result.rows.length === 0) {
      console.log('No DRs to fix.');
      return;
    }

    // Authenticate once
    if (!isDryRun) {
      const authenticated = await oneMap.authenticate();
      if (!authenticated) {
        console.error('Failed to authenticate with 1Map. Aborting.');
        process.exit(1);
      }
    }

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (const row of result.rows) {
      const { drop_number: drNumber, olt_serial: ontSerial, wrong_onemap_serial: upsSerial } = row;

      console.log(`\n--- Processing ${drNumber} ---`);
      console.log(`  ONT (already fixed): ${ontSerial}`);
      console.log(`  UPS (to restore): ${upsSerial}`);

      if (isDryRun) {
        console.log(`  [DRY RUN] Would update ph_ups to: ${upsSerial}`);
        successCount++;
        continue;
      }

      // Search for the DR in 1Map
      const record = await oneMap.searchDR(drNumber);
      if (!record) {
        console.log(`  ❌ DR not found in 1Map`);
        failCount++;
        continue;
      }

      console.log(`  1Map current: ONT=${record.phOnt}, UPS(br_ser)=${record.brSer}`);

      // Check if UPS is already correct
      if (record.brSer?.toUpperCase() === upsSerial.toUpperCase()) {
        console.log(`  ✓ UPS already correct - skipping`);
        skippedCount++;
        continue;
      }

      // Update UPS serial
      const updateResult = await oneMap.updateUpsSerial(record.propId, upsSerial);
      console.log(`  API Response: ${updateResult.response}`);
      if (updateResult.success) {
        console.log(`  ✓ UPS serial updated: ${record.brSer || 'EMPTY'} → ${upsSerial}`);

        // Update database record to track the UPS fix (truncate to fit column)
        const fixValue = `UPS:${record.brSer || 'EMPTY'}->${upsSerial}`.substring(0, 50);
        await client.query(`
          UPDATE olt_mismatch_records
          SET fix_result = 'success_with_ups',
              fix_old_value = $1
          WHERE drop_number = $2
            AND fix_status = 'fixed'
        `, [fixValue, drNumber]);

        // Log to DR activity timeline
        await client.query(`
          INSERT INTO dr_activity_log (drop_number, event_type, event_data, actor, created_at)
          VALUES ($1, 'SERIAL_UPDATE', $2, 'system', NOW())
        `, [
          drNumber,
          JSON.stringify({
            details: `1Map UPS serial (br_ser) restored: ${record.brSer || 'EMPTY'} → ${upsSerial}`,
            propId: record.propId,
            ups: { oldValue: record.brSer, newValue: upsSerial },
            source: 'olt_report_ups_fix',
            fix_type: 'ups_serial_restored',
          })
        ]);

        successCount++;
      } else {
        console.log(`  ❌ Failed to update UPS serial`);
        failCount++;
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 500));
    }

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed: ${result.rows.length}`);
    console.log(`Success: ${successCount}`);
    console.log(`Skipped (already correct): ${skippedCount}`);
    console.log(`Failed: ${failCount}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
