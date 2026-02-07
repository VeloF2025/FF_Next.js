/**
 * Fetch GPS coordinates from 1Map API for all drops
 *
 * Usage:
 *   ONEMAP_EMAIL=... ONEMAP_PASSWORD=... npx tsx scripts/onemap-sync/fetch-gps-from-1map.ts
 *   npx tsx scripts/onemap-sync/fetch-gps-from-1map.ts --site LAW
 *   npx tsx scripts/onemap-sync/fetch-gps-from-1map.ts --dry-run
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

const ONEMAP_EMAIL = process.env.ONEMAP_EMAIL || 'hein@velocityfibre.co.za';
const ONEMAP_PASSWORD = process.env.ONEMAP_PASSWORD || 'VeloF@2025';
const BASE_URL = 'https://www.1map.co.za';

const sql = neon(DATABASE_URL);

// Site to project mapping
const SITE_PROJECT_MAP: Record<string, { projectId: string; projectName: string }> = {
  'LAW': { projectId: '4eb13426-b2a1-472d-9b3c-277082ae9b55', projectName: 'Lawley' },
  'MAM': { projectId: '7003dc06-9af7-4a7c-bc6c-a177d77784f2', projectName: 'Mamelodi' },
  'MOH': { projectId: 'bf9a90db-e758-4c05-b999-694cd63c451f', projectName: 'Mohadin' },
};

interface OneMapRecord {
  prop_id: string;
  drp: string;
  pole: string;
  site: string;
  status: string;
  address: string;
  latitude: string | number | null;
  longitude: string | number | null;
  pon?: string;
  zone?: string;
  section?: string;
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

  async fetchPage(site: string, page: number, limit: number = 50): Promise<{ records: OneMapRecord[]; totalPages: number }> {
    const start = (page - 1) * limit;

    const formData = new URLSearchParams({
      ungeocoded: 'false',
      left: '0',
      bottom: '0',
      right: '0',
      top: '0',
      selfilter: '',
      action: 'get',
      email: ONEMAP_EMAIL,
      layerid: '5121',
      sort: 'prop_id',
      templateExpression: '',
      q: site,
      page: String(page),
      start: String(start),
      limit: String(limit),
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
    return {
      records: result.result || [],
      totalPages: result.total_pages || 1,
    };
  }

  async fetchAllForSite(site: string): Promise<OneMapRecord[]> {
    const allRecords: OneMapRecord[] = [];
    let page = 1;
    let totalPages = 1;

    console.log(`\n📥 Fetching ${site}...`);

    while (page <= totalPages) {
      const result = await this.fetchPage(site, page);
      allRecords.push(...result.records);
      totalPages = result.totalPages;

      process.stdout.write(`\r  Page ${page}/${totalPages} - ${allRecords.length} records`);

      page++;
      // Rate limiting
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n  ✅ Total: ${allRecords.length} records`);
    return allRecords;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const siteIndex = args.indexOf('--site');
  const specificSite = siteIndex !== -1 ? args[siteIndex + 1] : null;

  console.log('========================================');
  console.log('  1MAP GPS DATA FETCH');
  console.log('========================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Site: ${specificSite || 'ALL'}`);
  console.log('========================================');

  const client = new OneMapClient();
  const authenticated = await client.authenticate();

  if (!authenticated) {
    process.exit(1);
  }

  const sites = specificSite ? [specificSite] : Object.keys(SITE_PROJECT_MAP);
  const allGpsData: Map<string, { lat: number; lng: number; site: string }> = new Map();

  // Fetch from 1Map
  for (const site of sites) {
    const records = await client.fetchAllForSite(site);

    let withGps = 0;
    for (const record of records) {
      if (record.drp && record.latitude && record.longitude) {
        const lat = typeof record.latitude === 'string' ? parseFloat(record.latitude) : record.latitude;
        const lng = typeof record.longitude === 'string' ? parseFloat(record.longitude) : record.longitude;

        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
          // Validate SA coordinates
          if (lat >= -35 && lat <= -20 && lng >= 20 && lng <= 35) {
            allGpsData.set(record.drp, { lat, lng, site });
            withGps++;
          }
        }
      }
    }

    console.log(`  📍 ${site}: ${withGps} drops with valid GPS`);
  }

  console.log(`\n========================================`);
  console.log(`TOTAL DROPS WITH GPS: ${allGpsData.size}`);
  console.log(`========================================`);

  if (dryRun) {
    console.log('\n⚠️  DRY RUN - No database changes made');
    // Show samples
    console.log('\nSample GPS data:');
    let count = 0;
    for (const [dr, gps] of allGpsData) {
      if (count++ < 5) {
        console.log(`  ${dr}: (${gps.lat}, ${gps.lng}) - ${gps.site}`);
      }
    }
    return;
  }

  // Update databases
  console.log('\n📝 Updating database...');

  let updatedOnemap = 0;
  let updatedSow = 0;

  for (const [drNumber, gps] of allGpsData) {
    try {
      // Update onemap.drops
      const onemapResult = await sql`
        UPDATE onemap.drops
        SET latitude = ${gps.lat}, longitude = ${gps.lng}, updated_at = NOW()
        WHERE dr_number = ${drNumber}
        AND (latitude IS NULL OR latitude = 0)
      `;
      if (onemapResult.count > 0) updatedOnemap++;

      // Update sharepoint_hld_home (sow_drops base table)
      const sowResult = await sql`
        UPDATE sharepoint_hld_home
        SET lat = ${gps.lat}, lon = ${gps.lng}, updated_at = NOW()
        WHERE label = ${drNumber}
        AND (lat IS NULL OR lat = 0)
      `;
      if (sowResult.count > 0) updatedSow++;

      if ((updatedOnemap + updatedSow) % 1000 === 0) {
        process.stdout.write(`\r  Updated: ${updatedOnemap} onemap, ${updatedSow} sow`);
      }
    } catch (e) {
      // Ignore individual errors
    }
  }

  console.log(`\n\n========================================`);
  console.log(`UPDATE COMPLETE`);
  console.log(`========================================`);
  console.log(`onemap.drops updated: ${updatedOnemap}`);
  console.log(`sharepoint_hld_home updated: ${updatedSow}`);
}

main().catch(console.error);
