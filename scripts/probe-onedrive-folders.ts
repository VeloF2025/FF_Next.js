/**
 * Check where Teams stores recordings for a few users.
 * Checks: /Recordings/, /Documents/Recordings/, root children
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { graphFetch } from '../src/lib/graph/auth';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Check a few known active users
const TEST_USERS = [
  'hein@velocityfibre.co.za',
  'louis@velocityfibre.co.za',
  'nick@velocityfibre.co.za',
];

async function main() {
  for (const email of TEST_USERS) {
    console.log(`\n=== ${email} ===`);

    // Get user ID
    const userResp = await graphFetch(`${GRAPH_BASE}/users/${encodeURIComponent(email)}?$select=id`);
    if (!userResp.ok) { console.log(`  User not found: ${userResp.status}`); continue; }
    const userId = (await userResp.json()).id;

    // List root drive folders
    const rootResp = await graphFetch(
      `${GRAPH_BASE}/users/${userId}/drive/root/children?$select=name,folder,size&$top=50`
    );
    if (!rootResp.ok) { console.log(`  Drive access: ${rootResp.status}`); continue; }
    const rootData = await rootResp.json();
    console.log('  Root folders:');
    for (const item of rootData.value || []) {
      if (item.folder) {
        console.log(`    📁 ${item.name} (${item.folder.childCount} items)`);
      }
    }

    // Check specific recording paths
    const paths = ['/Recordings', '/Documents/Recordings', '/Microsoft Teams Chat Files'];
    for (const p of paths) {
      const resp = await graphFetch(
        `${GRAPH_BASE}/users/${userId}/drive/root:${p}:/children?$select=name,size,createdDateTime&$top=5&$orderby=createdDateTime desc`
      );
      if (resp.status === 404) continue;
      if (!resp.ok) { console.log(`  ${p}: Error ${resp.status}`); continue; }
      const data = await resp.json();
      if (data.value?.length > 0) {
        console.log(`  ${p}:`);
        for (const item of data.value) {
          const sizeMB = ((item.size || 0) / 1024 / 1024).toFixed(1);
          console.log(`    ${item.createdDateTime?.slice(0, 16)} | ${sizeMB} MB | ${item.name}`);
        }
      }
    }

    // Also search for .mp4 files across entire drive
    const searchResp = await graphFetch(
      `${GRAPH_BASE}/users/${userId}/drive/root/search(q='.mp4')?$select=name,size,createdDateTime,parentReference&$top=10`
    );
    if (searchResp.ok) {
      const searchData = await searchResp.json();
      const mp4s = (searchData.value || []).filter((i: { name: string }) => i.name.endsWith('.mp4'));
      if (mp4s.length > 0) {
        console.log('  MP4 files found via search:');
        for (const item of mp4s) {
          const sizeMB = ((item.size || 0) / 1024 / 1024).toFixed(1);
          const folder = item.parentReference?.path?.replace('/drive/root:', '') || '?';
          console.log(`    ${folder}/${item.name} (${sizeMB} MB, ${item.createdDateTime?.slice(0, 16)})`);
        }
      } else {
        console.log('  No MP4 files found in drive');
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
