import { query } from '@/lib/db-pool';

export type QueryRunner = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

const defaultRun: QueryRunner = query;

export interface CachedPoleDesign {
  available: boolean;
  designTotal: number | null;
  labels: Set<string> | null;
  gpkgVersion?: string;
  resolvedAt?: string;
}

type CacheRow = Record<string, unknown> & {
  gpkg_version: string;
  resolved_at: string;
  payload: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function labelsFrom(payload: unknown): Set<string> {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.designPons) ||
    !payload.designPons.every((pon) => typeof pon === 'number' && Number.isFinite(pon)) ||
    !isRecord(payload.poleToPon) ||
    !Object.entries(payload.poleToPon).every(([label, mapping]) => (
      label.trim().length > 0 &&
      isRecord(mapping) &&
      typeof mapping.pon === 'number' &&
      Number.isFinite(mapping.pon) &&
      (mapping.zone === null || typeof mapping.zone === 'string')
    ))
  ) {
    throw new Error('Malformed QField pole design cache payload');
  }
  return new Set(Object.keys(payload.poleToPon));
}

export async function getCachedPoleDesign(
  qfieldProjectId: string,
  run: QueryRunner = defaultRun,
): Promise<CachedPoleDesign> {
  const rows = await run<CacheRow>(
    `SELECT gpkg_version,
            to_char(resolved_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS resolved_at,
            payload
     FROM qfield_pole_pon_cache
     WHERE project_id = $1::uuid
     ORDER BY resolved_at DESC
     LIMIT 1`,
    [qfieldProjectId],
  );
  const row = rows[0];
  if (!row) {
    return { available: false, designTotal: null, labels: null };
  }

  const labels = labelsFrom(row.payload);
  return {
    available: true,
    designTotal: labels.size,
    labels,
    gpkgVersion: row.gpkg_version,
    resolvedAt: row.resolved_at,
  };
}
