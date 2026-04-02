#!/usr/bin/env node

/**
 * RBAC Sync — Scans navigation configs and page routes for rbacKeys
 * that are missing from access_permissions, then seeds them.
 *
 * Usage:
 *   node scripts/rbac-sync.mjs          # Dry-run (report only)
 *   node scripts/rbac-sync.mjs --apply  # Insert missing permissions + role grants
 *
 * Called automatically by /kb skill.
 */

import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const dryRun = !process.argv.includes('--apply');

// ─── 1. Collect all rbacKeys from navigation configs ────────────────────────

function extractRbacKeys() {
  const configDir = join(process.cwd(), 'src/modules/navigation/config/modules');
  const keys = new Map(); // rbacKey → { label, route, parentKey, type }

  if (!existsSync(configDir)) {
    console.warn('Nav config dir not found:', configDir);
    return keys;
  }

  for (const file of readdirSync(configDir).filter(f => f.endsWith('.config.ts'))) {
    const content = readFileSync(join(configDir, file), 'utf-8');
    const moduleMatch = content.match(/moduleId:\s*['"]([^'"]+)['"]/);
    const moduleId = moduleMatch?.[1];
    if (!moduleId) continue;

    // Extract tabs with rbacKey
    const tabRegex = /\{[^}]*?id:\s*['"]([^'"]+)['"][^}]*?label:\s*['"]([^'"]+)['"][^}]*?path:\s*['"]([^'"]+)['"][^}]*?rbacKey:\s*['"]([^'"]+)['"][^}]*?\}/gs;
    // Also try reversed order (rbacKey before path)
    const tabRegex2 = /\{[^}]*?rbacKey:\s*['"]([^'"]+)['"][^}]*?label:\s*['"]([^'"]+)['"][^}]*?path:\s*['"]([^'"]+)['"][^}]*?\}/gs;

    // Simpler approach: find all rbacKey values and their surrounding context
    const rbacMatches = content.matchAll(/rbacKey:\s*['"]([^'"]+)['"]/g);
    for (const match of rbacMatches) {
      const rbacKey = match[1];
      // Find the enclosing block to get label and path
      const blockStart = content.lastIndexOf('{', match.index);
      const blockEnd = content.indexOf('}', match.index);
      const block = content.substring(blockStart, blockEnd + 1);

      const labelMatch = block.match(/label:\s*['"]([^'"]+)['"]/);
      const pathMatch = block.match(/path:\s*['"]([^'"]+)['"]/);

      const segments = rbacKey.split('.');
      const type = segments.length === 1 ? 'module' : segments.length === 2 ? 'page' : 'tab';
      const parentKey = segments.length > 1 ? segments.slice(0, -1).join('.') : null;

      keys.set(rbacKey, {
        label: labelMatch?.[1] || rbacKey.split('.').pop(),
        route: pathMatch?.[1] || null,
        parentKey,
        type,
        source: file,
      });
    }
  }

  return keys;
}

// ─── 2. Scan app router pages for routes that might need permissions ────────

function extractAppRoutes() {
  const appDir = join(process.cwd(), 'app/(main)');
  const routes = new Map();

  if (!existsSync(appDir)) return routes;

  function walk(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      if (entry.isDirectory()) {
        const routeSegment = entry.name.startsWith('(') ? '' : `/${entry.name}`;
        walk(join(dir, entry.name), prefix + routeSegment);
      } else if (entry.name === 'page.tsx' || entry.name === 'client.tsx') {
        if (prefix && !prefix.includes('[')) {
          const segments = prefix.split('/').filter(Boolean);
          if (segments.length >= 1) {
            const moduleKey = segments[0];
            const fullKey = segments.join('.');
            if (!routes.has(fullKey)) {
              routes.set(fullKey, {
                route: prefix,
                moduleKey,
                label: segments[segments.length - 1]
                  .replace(/-/g, ' ')
                  .replace(/\b\w/g, c => c.toUpperCase()),
                type: segments.length === 1 ? 'module' : 'page',
                parentKey: segments.length > 1 ? segments.slice(0, -1).join('.') : null,
              });
            }
          }
        }
      }
    }
  }

  walk(appDir);
  return routes;
}

// ─── 3. Compare with database and report/seed ───────────────────────────────

const DEFAULT_ROLE_ACTIONS = {
  super_admin: { view: true, create: true, edit: true, delete: true },
  admin:       { view: true, create: true, edit: true, delete: true },
  manager:     { view: true, create: true, edit: true, delete: false },
  technician:  { view: false, create: false, edit: false, delete: false },
  viewer:      { view: true, create: false, edit: false, delete: false },
  storeman:    { view: false, create: false, edit: false, delete: false },
  contractor:  { view: false, create: false, edit: false, delete: false },
};

async function run() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  RBAC SYNC ${dryRun ? '(DRY RUN)' : '(APPLYING)'}`);
  console.log(`${'='.repeat(60)}\n`);

  // Get existing permissions from DB
  const existing = await sql`SELECT key FROM access_permissions WHERE is_active = true`;
  const existingKeys = new Set(existing.map(r => r.key));
  console.log(`  DB has ${existingKeys.size} active permission keys\n`);

  // Collect all keys from nav configs
  const navKeys = extractRbacKeys();
  console.log(`  Nav configs define ${navKeys.size} rbacKeys`);

  // Collect app routes
  const appRoutes = extractAppRoutes();
  console.log(`  App router has ${appRoutes.size} page routes\n`);

  // Find missing
  const missing = [];

  for (const [key, info] of navKeys) {
    if (!existingKeys.has(key)) {
      missing.push({ key, ...info, source: `nav:${info.source}` });
    }
  }

  for (const [key, info] of appRoutes) {
    if (!existingKeys.has(key) && !navKeys.has(key)) {
      missing.push({ key, ...info, source: 'app-router' });
    }
  }

  // Sort alphabetically
  missing.sort((a, b) => a.key.localeCompare(b.key));

  if (missing.length === 0) {
    console.log('  ✅ All permission keys are in sync — nothing to do.\n');
    return { added: 0, missing: [] };
  }

  console.log(`  ⚠️  ${missing.length} missing permission(s):\n`);
  for (const m of missing) {
    console.log(`    ${m.type.padEnd(6)} ${m.key.padEnd(35)} ${(m.label || '').padEnd(25)} ${m.source}`);
  }

  if (dryRun) {
    console.log(`\n  Run with --apply to insert these into access_permissions.\n`);
    return { added: 0, missing };
  }

  // Insert missing permissions
  let added = 0;
  for (const m of missing) {
    try {
      await sql`
        INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order)
        VALUES (${m.type}, ${m.key}, ${m.parentKey || null}, ${m.label}, ${`Auto-seeded by rbac-sync`}, ${m.route || null}, 99)
        ON CONFLICT (key) DO UPDATE SET
          label = EXCLUDED.label,
          route = EXCLUDED.route
      `;

      // Grant to roles
      for (const [role, actions] of Object.entries(DEFAULT_ROLE_ACTIONS)) {
        await sql`
          INSERT INTO role_permissions (role, permission_key, actions)
          VALUES (${role}, ${m.key}, ${JSON.stringify(actions)}::jsonb)
          ON CONFLICT (role, permission_key) DO NOTHING
        `;
      }

      added++;
      console.log(`    ✅ Seeded: ${m.key}`);
    } catch (err) {
      console.error(`    ❌ Failed: ${m.key} — ${err.message}`);
    }
  }

  console.log(`\n  Seeded ${added}/${missing.length} permissions.\n`);
  return { added, missing };
}

run().catch(err => {
  console.error('RBAC sync failed:', err.message);
  process.exit(1);
});
