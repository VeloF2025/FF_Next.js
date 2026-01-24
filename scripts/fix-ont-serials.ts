/**
 * Fix ONT Serial Mismatches in 1Map
 *
 * Updates ONT serials (ph_ont field) in 1Map for DRs with incorrect values.
 *
 * Usage:
 *   npx tsx scripts/fix-ont-serials.ts
 *   npx tsx scripts/fix-ont-serials.ts --dry-run
 */

const BASE_URL = 'https://www.1map.co.za';
const ONEMAP_EMAIL = process.env.ONEMAP_EMAIL || 'hein@velocityfibre.co.za';
const ONEMAP_PASSWORD = process.env.ONEMAP_PASSWORD || 'VeloF@2025';
const LAYER_ID = '5121';

// DRs to fix: [DR Number, Correct ONT, Wrong ONT (current)]
const ONT_CORRECTIONS = [
  { dr: 'DR1733472', correctOnt: 'ALCLB480F4B7', wrongOnt: 'ALCLB484D160' },
  { dr: 'DR1738319', correctOnt: 'ALCLB48AC56E', wrongOnt: 'ALCLB48AC56A' },
  { dr: 'DR1735406', correctOnt: 'ALCLB48AC88A', wrongOnt: 'ALCLB48AC673' },
  { dr: 'DR1735353', correctOnt: 'ALCLB48A9B95', wrongOnt: 'ALCLB48AC59F' },
  { dr: 'DR1736834', correctOnt: 'ALCLB48A9E55', wrongOnt: 'ALCLB48A9E42' },
  { dr: 'DR1736727', correctOnt: 'ALCLB48A9E42', wrongOnt: 'ALCLB48A9E55' },
  { dr: 'DR1738321', correctOnt: 'ALCLB48AC56A', wrongOnt: 'ALCLB48AC56E' },
  { dr: 'DR1735407', correctOnt: 'ALCLB48AC673', wrongOnt: 'ALCLB48AC88A' },
  { dr: 'DR1753008', correctOnt: 'ALCLB463F4EB', wrongOnt: 'ALCLB47D04DD' },
];

interface OneMapRecord {
  prop_id: string;
  drp: string;
  ph_ont?: string;
  [key: string]: unknown;
}

class OneMapClient {
  private sessionCookie: string | null = null;
  private csrfToken: string | null = null;

  async authenticate(): Promise<boolean> {
    console.log('🔐 Authenticating with 1Map...');

    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: ONEMAP_EMAIL,
        password: ONEMAP_PASSWORD,
      }).toString(),
      redirect: 'manual',
    });

    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      const sidMatch = setCookieHeader.match(/connect\.sid=([^;]+)/);
      if (sidMatch) {
        this.sessionCookie = sidMatch[1];
      }
      const csrfMatch = setCookieHeader.match(/csrfToken=([^;]+)/);
      if (csrfMatch) {
        this.csrfToken = csrfMatch[1];
      }
    }

    if (this.sessionCookie) {
      console.log('✅ Authentication successful');
      return true;
    }

    console.error('❌ Authentication failed');
    return false;
  }

  private getCookies(): string {
    const cookies: string[] = [];
    if (this.sessionCookie) cookies.push(`connect.sid=${this.sessionCookie}`);
    if (this.csrfToken) cookies.push(`csrfToken=${this.csrfToken}`);
    return cookies.join('; ');
  }

  async getDR(drNumber: string): Promise<OneMapRecord | null> {
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
      limit: '10',
    });

    const response = await fetch(`${BASE_URL}/api/apps/app/getattributes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': this.getCookies(),
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();

    if (result.success && result.result) {
      const record = result.result.find((r: OneMapRecord) => r.drp === drNumber);
      return record || null;
    }

    return null;
  }

  async updateOntSerial(propId: string, newOntSerial: string): Promise<boolean> {
    // Build multipart form data
    const formData = new FormData();
    formData.append('action', 'update');
    formData.append('layerid', LAYER_ID);
    formData.append('sort', 'prop_id');
    formData.append('templateExpression', '');
    formData.append('start', '0');
    formData.append('limit', '50');
    formData.append('bottom', '0');
    formData.append('left', '0');
    formData.append('right', '0');
    formData.append('top', '0');
    formData.append('selfilter', 'null');
    formData.append('ungeocoded', 'false');
    formData.append('items', JSON.stringify({
      prop_id: propId,
      ph_ont: newOntSerial,
    }));

    const response = await fetch(`${BASE_URL}/api/apps/app/attributes`, {
      method: 'POST',
      headers: {
        'Cookie': this.getCookies(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Update failed: ${response.status}`, text.substring(0, 200));
      return false;
    }

    const result = await response.json();
    return result.success === true;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('═'.repeat(60));
  console.log('  ONT SERIAL CORRECTION SCRIPT');
  console.log('═'.repeat(60));
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '⚡ LIVE UPDATE'}`);
  console.log(`DRs to fix: ${ONT_CORRECTIONS.length}`);
  console.log('═'.repeat(60));

  const client = new OneMapClient();
  const authenticated = await client.authenticate();

  if (!authenticated) {
    console.error('Failed to authenticate');
    process.exit(1);
  }

  const results: Array<{
    dr: string;
    status: 'success' | 'failed' | 'skipped';
    propId?: string;
    oldOnt?: string;
    newOnt: string;
    reason?: string;
  }> = [];

  for (const correction of ONT_CORRECTIONS) {
    console.log(`\n📋 Processing ${correction.dr}...`);

    try {
      // Get DR record to find prop_id
      const record = await client.getDR(correction.dr);

      if (!record) {
        console.log(`  ❌ DR not found in 1Map`);
        results.push({
          dr: correction.dr,
          status: 'failed',
          newOnt: correction.correctOnt,
          reason: 'DR not found',
        });
        continue;
      }

      console.log(`  📍 Found: prop_id=${record.prop_id}, current ONT=${record.ph_ont || 'EMPTY'}`);

      // Check if already correct
      if (record.ph_ont === correction.correctOnt) {
        console.log(`  ✓ Already correct!`);
        results.push({
          dr: correction.dr,
          status: 'skipped',
          propId: record.prop_id,
          oldOnt: record.ph_ont,
          newOnt: correction.correctOnt,
          reason: 'Already correct',
        });
        continue;
      }

      if (dryRun) {
        console.log(`  🔍 [DRY RUN] Would update: ${record.ph_ont || 'EMPTY'} → ${correction.correctOnt}`);
        results.push({
          dr: correction.dr,
          status: 'skipped',
          propId: record.prop_id,
          oldOnt: record.ph_ont,
          newOnt: correction.correctOnt,
          reason: 'Dry run',
        });
        continue;
      }

      // Perform update
      console.log(`  ⚡ Updating: ${record.ph_ont || 'EMPTY'} → ${correction.correctOnt}`);
      const success = await client.updateOntSerial(record.prop_id, correction.correctOnt);

      if (success) {
        console.log(`  ✅ Updated successfully!`);
        results.push({
          dr: correction.dr,
          status: 'success',
          propId: record.prop_id,
          oldOnt: record.ph_ont,
          newOnt: correction.correctOnt,
        });
      } else {
        console.log(`  ❌ Update failed`);
        results.push({
          dr: correction.dr,
          status: 'failed',
          propId: record.prop_id,
          oldOnt: record.ph_ont,
          newOnt: correction.correctOnt,
          reason: 'API returned failure',
        });
      }

      // Small delay between updates
      await new Promise(r => setTimeout(r, 500));

    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
      results.push({
        dr: correction.dr,
        status: 'failed',
        newOnt: correction.correctOnt,
        reason: String(error),
      });
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SUMMARY');
  console.log('═'.repeat(60));

  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'failed');
  const skipped = results.filter(r => r.status === 'skipped');

  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  console.log(`⏭️  Skipped: ${skipped.length}`);

  if (successful.length > 0) {
    console.log('\nSuccessful updates:');
    for (const r of successful) {
      console.log(`  ${r.dr}: ${r.oldOnt} → ${r.newOnt}`);
    }
  }

  if (failed.length > 0) {
    console.log('\nFailed updates:');
    for (const r of failed) {
      console.log(`  ${r.dr}: ${r.reason}`);
    }
  }

  // Generate log entry
  if (!dryRun && successful.length > 0) {
    console.log('\n📝 Log entry for ONT_SERIAL_CORRECTIONS_LOG.md:');
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    for (const r of successful) {
      console.log(`| ${timestamp} | ${r.dr} | ${r.propId} | ${r.oldOnt} | ${r.newOnt} | ✅ SUCCESS |`);
    }
  }
}

main().catch(console.error);
