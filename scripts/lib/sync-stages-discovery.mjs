/**
 * Project discovery for scripts/sync-stages.mjs.
 *
 * A project opts into pon_stage_tracking in one of two ways:
 *   - `metadata.onemap_prefix` — 1Map site code. A prefix may be shared by more
 *     than one project (TEM = Thembisa POP 1 + POP 3); every project carrying it
 *     is synced from the same sweep, because syncSite() attributes records via
 *     that project's own drops.drop_number lookup and skips what doesn't map.
 *   - `metadata.stage_tracking = 'sow'` — no 1Map presence at all. Synced with an
 *     empty record set, so totals and the DB-derived stages (poles planted, CWC,
 *     activation) populate and permissions stays at zero.
 *
 * A project carrying both is synced once, via the prefix path.
 */

/** Pseudo site code that selects the SOW-only projects from the CLI. */
export const SOW_SITE_CODE = 'SOW';

/**
 * @typedef {object} DiscoveredProject
 * @property {string} uuid
 * @property {string} name
 * @property {string | null} prefix Upper-cased 1Map site code, or null for SOW-only.
 */

/**
 * @typedef {object} GroupedProjects
 * @property {Map<string, DiscoveredProject[]>} byPrefix Site code → projects to stage.
 * @property {DiscoveredProject[]} sowOnly Projects staged from the DB alone.
 */

/**
 * Group project rows into the prefix and SOW-only paths.
 *
 * Pure — no database access — so the branch behaviour is directly testable.
 *
 * @param {Array<{ id: string, project_name: string, prefix: unknown, stage_tracking: unknown }>} rows
 * @param {string[]} [filterCodes] Upper-cased CLI site codes; empty means "all".
 * @returns {GroupedProjects}
 */
export function groupProjects(rows, filterCodes = []) {
  const wanted = filterCodes.map(c => c.toUpperCase());
  const byPrefix = new Map();
  const sowOnly = [];

  for (const row of rows) {
    const prefix = typeof row.prefix === 'string' ? row.prefix.trim().toUpperCase() : '';
    const isSow = typeof row.stage_tracking === 'string'
      && row.stage_tracking.trim().toLowerCase() === 'sow';

    if (prefix) {
      // Prefix wins over the SOW flag: the 1Map sweep is the richer source.
      if (wanted.length > 0 && !wanted.includes(prefix)) continue;
      const project = { uuid: row.id, name: row.project_name, prefix };
      const existing = byPrefix.get(prefix);
      if (existing) existing.push(project);
      else byPrefix.set(prefix, [project]);
      continue;
    }

    if (!isSow) continue;
    if (wanted.length > 0 && !wanted.includes(SOW_SITE_CODE)) continue;
    sowOnly.push({ uuid: row.id, name: row.project_name, prefix: null });
  }

  return { byPrefix, sowOnly };
}

/**
 * Load the opted-in projects from the database and group them.
 *
 * @param {{ connect: () => Promise<{ query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>, release: () => void }> }} pool
 * @param {string[]} [filterCodes]
 * @returns {Promise<GroupedProjects>}
 */
export async function discoverProjects(pool, filterCodes = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id,
             project_name,
             metadata->>'onemap_prefix' as prefix,
             metadata->>'stage_tracking' as stage_tracking
      FROM projects
      WHERE status = 'active'
        AND (metadata->>'onemap_prefix' IS NOT NULL
             OR metadata->>'stage_tracking' = 'sow')
      ORDER BY project_name
    `);
    return groupProjects(result.rows, filterCodes);
  } finally {
    client.release();
  }
}
