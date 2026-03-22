/**
 * Probe OneDrive /Recordings/ folders for all internal users.
 * Tests API access and shows what recordings are available.
 *
 * Usage: npx tsx scripts/probe-onedrive.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { graphFetch } from '../src/lib/graph/auth';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const INTERNAL_DOMAINS = ['velocityfibre.co.za', 'blitzfibre.com'];

async function main() {
  // Get internal users
  console.log('Fetching internal users...');
  let users: { id: string; mail: string; displayName: string }[] = [];
  let url: string = `${GRAPH_BASE}/users?$filter=accountEnabled eq true&$select=id,displayName,mail,userPrincipalName&$top=100`;

  while (url) {
    const resp = await graphFetch(url);
    if (!resp.ok) { console.error('Failed to list users:', resp.status); return; }
    const data = await resp.json();
    const pageUsers = (data.value || [])
      .filter((u: Record<string, string>) => {
        if (u.userPrincipalName?.includes('#EXT#')) return false;
        const domain = (u.mail || u.userPrincipalName || '').split('@')[1]?.toLowerCase();
        return domain && INTERNAL_DOMAINS.includes(domain);
      })
      .map((u: Record<string, string>) => ({ id: u.id, mail: u.mail || u.userPrincipalName, displayName: u.displayName }));
    users.push(...pageUsers);
    url = data['@odata.nextLink'] || '';
  }

  console.log(`Found ${users.length} internal users\n`);

  let totalRecordings = 0;
  let usersWithRecordings = 0;

  for (const user of users) {
    const recUrl = `${GRAPH_BASE}/users/${user.id}/drive/root:/Recordings:/children?$select=id,name,size,createdDateTime&$top=10&$orderby=createdDateTime desc`;
    const resp = await graphFetch(recUrl);

    if (resp.status === 404) continue; // No Recordings folder
    if (resp.status === 403) {
      console.log(`  ${user.mail}: ACCESS DENIED (need Files.Read.All permission)`);
      continue;
    }
    if (!resp.ok) {
      console.log(`  ${user.mail}: Error ${resp.status}`);
      continue;
    }

    const data = await resp.json();
    const items = (data.value || []).filter((i: { name: string }) => i.name.endsWith('.mp4'));

    if (items.length > 0) {
      usersWithRecordings++;
      totalRecordings += items.length;
      console.log(`${user.mail} — ${items.length} recording(s):`);
      for (const item of items) {
        const sizeMB = ((item.size || 0) / 1024 / 1024).toFixed(1);
        console.log(`  ${item.createdDateTime?.slice(0, 16)} | ${sizeMB} MB | ${item.name}`);
      }
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Users with recordings: ${usersWithRecordings}`);
  console.log(`  Total recordings found: ${totalRecordings}`);
}

main().catch(e => { console.error(e); process.exit(1); });
