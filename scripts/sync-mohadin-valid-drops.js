#!/usr/bin/env node
/**
 * Sync Mohadin valid drop numbers from SharePoint HLD_Home
 *
 * PURPOSE: Populates valid_drop_numbers table for WA Monitor drop validation
 *
 * SOURCE:
 *   File: VF_Project_Tracker_Mohadin
 *   Sheet: HLD_Home
 *   Range: A2:A22141 (~22,140 drops)
 *   URL: https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/EYm7g0w6Y1dFgGB_m4YlBxgBeVJpoDXAYjdvK-ZfgHoOqA
 *
 * DESTINATION:
 *   Database: Neon PostgreSQL
 *   Table: valid_drop_numbers
 *   Project: 'Mohadin'
 *
 * FEATURES:
 *   - OAuth2 authentication with SharePoint
 *   - Batch insert (500 drops per batch)
 *   - Idempotent (ON CONFLICT DO UPDATE)
 *   - ~45 seconds for 22k drops
 *
 * USAGE:
 *   node scripts/sync-mohadin-valid-drops.js
 *
 * DOCUMENTATION:
 *   See: docs/wa-monitor/DROP_VALIDATION_SYSTEM.md
 *
 * CREATED: November 14, 2025
 * VERSION: 1.0
 */

const https = require('https');

// SharePoint credentials
const TENANT_ID = 'f22e6344-a35d-43b0-ad8c-a247f513c1ee';
const CLIENT_ID = 'f7bd2f4f-405b-472a-90ca-f6b7ebfc6c56';
const CLIENT_SECRET = 'inw8Q~gtHfV~foOn43wSNEvnGP~IO7zmLviejaw5';
const SITE_ID = 'blitzfibre.sharepoint.com,cf8186e7-97cd-4aff-9d7f-e41cf213eff8,0e6533f4-d910-46e1-af3c-10ea74b3efd7';

// Sharing link - need to resolve to get FILE_ID
const SHARING_URL = 'https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/EYm7g0w6Y1dFgGB_m4YlBxgBeVJpoDXAYjdvK-ZfgHoOqA';

// Database
const DATABASE_URL = 'process.env.DATABASE_URL';

async function getAccessToken() {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const postData = params.toString();
    const options = {
      hostname: 'login.microsoftonline.com',
      port: 443,
      path: `/${TENANT_ID}/oauth2/v2.0/token`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data).access_token);
        } else {
          reject(new Error(`Failed to get token: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function resolveShareLink(accessToken, sharingUrl) {
  return new Promise((resolve, reject) => {
    // Encode sharing URL as base64
    const encodedUrl = Buffer.from(sharingUrl).toString('base64')
      .replace(/=+$/, '')
      .replace(/\//g, '_')
      .replace(/\+/g, '-');

    const sharingToken = `u!${encodedUrl}`;
    const path = `/v1.0/shares/${sharingToken}/driveItem`;

    const options = {
      hostname: 'graph.microsoft.com',
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          const item = JSON.parse(data);
          resolve({
            driveId: item.parentReference.driveId,
            fileId: item.id
          });
        } else {
          reject(new Error(`Failed to resolve share link: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function readDropNumbers(accessToken, driveId, fileId, range) {
  return new Promise((resolve, reject) => {
    const worksheetName = 'HLD_Home';
    const path = `/v1.0/drives/${driveId}/items/${fileId}/workbook/worksheets/${worksheetName}/range(address='${range}')`;

    const options = {
      hostname: 'graph.microsoft.com',
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          const result = JSON.parse(data);
          // Extract drop numbers from column A
          const dropNumbers = result.values
            .map(row => row[0])
            .filter(val => val && val.toString().startsWith('DR'));
          resolve(dropNumbers);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function insertToNeon(dropNumbers) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();

    console.log('📝 Inserting drop numbers to Neon...');

    // Batch insert - 500 at a time
    const batchSize = 500;
    let inserted = 0;

    for (let i = 0; i < dropNumbers.length; i += batchSize) {
      const batch = dropNumbers.slice(i, i + batchSize);

      const values = batch.map((_, idx) => `($${idx + 1}, 'Mohadin', 'sharepoint_hld_home', NOW())`).join(',');
      const query = `
        INSERT INTO valid_drop_numbers (drop_number, project, sync_source, sync_timestamp)
        VALUES ${values}
        ON CONFLICT (drop_number) DO UPDATE SET
          sync_timestamp = NOW()
      `;

      await client.query(query, batch);
      inserted += batch.length;

      process.stdout.write(`\r   Inserted: ${inserted}/${dropNumbers.length}`);
    }

    console.log('\n✅ Insert complete!');

    // Verify
    const result = await client.query(`
      SELECT COUNT(*) as count FROM valid_drop_numbers WHERE project = 'Mohadin'
    `);

    console.log(`\n📊 Total Mohadin drops in database: ${result.rows[0].count}`);

  } finally {
    await client.end();
  }
}

async function main() {
  try {
    console.log('🚀 Syncing Mohadin valid drop numbers from SharePoint...\n');

    console.log('🔐 Getting access token...');
    const accessToken = await getAccessToken();
    console.log('✅ Access token obtained\n');

    console.log('🔗 Resolving SharePoint file...');
    const { driveId, fileId } = await resolveShareLink(accessToken, SHARING_URL);
    console.log(`✅ Drive ID: ${driveId}`);
    console.log(`✅ File ID: ${fileId}\n`);

    console.log('📖 Reading drop numbers from HLD_Home (A2:A22141)...');
    const dropNumbers = await readDropNumbers(accessToken, driveId, fileId, 'A2:A22141');
    console.log(`✅ Read ${dropNumbers.length} drop numbers\n`);

    console.log('Sample drops:');
    console.log(`   First: ${dropNumbers[0]}`);
    console.log(`   Last: ${dropNumbers[dropNumbers.length - 1]}\n`);

    await insertToNeon(dropNumbers);

    console.log('\n✅ SYNC COMPLETE!');
    console.log('=' .repeat(60));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
