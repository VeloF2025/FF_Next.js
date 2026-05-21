/**
 * Resolves an inbound WhatsApp group JID into the configured monitored group row.
 *
 * Replaces the previous hard-coded MAINTENANCE_GROUP_JIDS allowlist so that any
 * row in wa_monitored_groups (WHERE is_active) reaches the maintenance pipeline.
 * A 60-second in-process cache keeps Postgres load negligible.
 *
 * @module noc/services/waGroupResolver
 */

import { neon } from '@/lib/db-neon';

export interface MonitoredGroup {
  id: string;
  group_jid: string;
  group_name: string;
  group_type: string | null;
  project_name: string | null;
  project_id: string | null;
}

const CACHE_TTL_MS = 60_000;
let cache: { fetchedAt: number; byJid: Map<string, MonitoredGroup> } | null = null;

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

async function loadCache(): Promise<Map<string, MonitoredGroup>> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, group_jid, group_name, group_type, project_name, project_id
    FROM wa_monitored_groups
    WHERE is_active = true
  `) as MonitoredGroup[];

  const byJid = new Map<string, MonitoredGroup>();
  for (const row of rows) {
    byJid.set(row.group_jid, row);
  }
  return byJid;
}

/**
 * Resolve a group JID to its monitored-group row. Returns null when the
 * group is not in wa_monitored_groups or is_active=false.
 */
export async function resolveMonitoredGroup(
  groupJid: string
): Promise<MonitoredGroup | null> {
  const now = Date.now();
  if (!cache || now - cache.fetchedAt > CACHE_TTL_MS) {
    cache = { fetchedAt: now, byJid: await loadCache() };
  }
  return cache.byJid.get(groupJid) ?? null;
}

/**
 * Force a cache refresh on the next resolve call. Tests and admin tooling
 * should invoke this after editing wa_monitored_groups rows.
 */
export function invalidateMonitoredGroupCache(): void {
  cache = null;
}
