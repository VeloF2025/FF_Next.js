#!/usr/bin/env node
/**
 * EXFO Daily Sync — Cron Script
 *
 * Triggers EXFO Exchange sync via the FibreFlow API endpoint.
 * Uses x-cron-secret header for authentication (no session needed).
 *
 * Cron: 0 4 * * * (06:00 SAST daily)
 *
 * Usage:
 *   node scripts/exfo-daily-sync.mjs
 *   node scripts/exfo-daily-sync.mjs --full   # Force full re-sync
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Load .env.local for CRON_SECRET
function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env.local');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local may not exist in production — env vars set by systemd
  }
}
loadEnv();

const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.EXFO_SYNC_URL || 'http://localhost:3000';

if (!CRON_SECRET) {
  console.error('[EXFO Sync] CRON_SECRET not set — cannot authenticate');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const isFull = process.argv.includes('--full');
const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

console.log(`[${timestamp}] EXFO daily sync starting (mode: ${isFull ? 'full' : 'incremental'})`);

try {
  const response = await fetch(`${BASE_URL}/api/exfo/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': CRON_SECRET,
    },
    body: JSON.stringify({
      full: isFull,
      fetchDetails: true,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`[${timestamp}] EXFO sync failed (HTTP ${response.status}):`, JSON.stringify(data));
    process.exit(1);
  }

  // Log results per workspace
  const results = data.data || data;
  if (typeof results === 'object') {
    for (const [wsId, result] of Object.entries(results)) {
      const r = result;
      console.log(
        `  ${wsId}: ${r.status} — fetched:${r.resultsFetched} inserted:${r.resultsInserted} updated:${r.resultsUpdated} details:${r.detailsFetched} assets:${r.assetsMatched}${r.error ? ' ERROR: ' + r.error : ''}`
      );
    }
  }

  const endTs = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${endTs}] EXFO daily sync complete`);
} catch (err) {
  console.error(`[${timestamp}] EXFO sync error:`, err.message || err);
  process.exit(1);
}
