import { execFile } from 'child_process';
import { promisify } from 'util';
import { query, queryOne } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { getDesignGpkgVersion } from './qfcDeltaRepo';
import type { PonMap } from '../types';

const execFileAsync = promisify(execFile);
const RESOLVER = 'scripts/qfield-recon/resolve_pon_poles.py';
const UNAVAILABLE: PonMap = { available: false, gpkgVersion: null, resolvedAt: null, designPons: [], poleToPon: {} };

interface ResolverOut { available: boolean; designPons: number[]; poleToPon: PonMap['poleToPon']; }
type CachedPayload = Pick<ResolverOut, 'designPons' | 'poleToPon'>;

async function runResolver(projectId: string): Promise<ResolverOut> {
  const { stdout } = await execFileAsync('python3', [RESOLVER, '--project-id', projectId],
    { maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  return JSON.parse(stdout) as ResolverOut;
}

export async function getPonMap(projectId: string): Promise<PonMap> {
  const version = await getDesignGpkgVersion(projectId);
  if (!version) return UNAVAILABLE;

  const cached = await queryOne<{ payload: CachedPayload; resolved_at: string }>(
    `SELECT payload, to_char(resolved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS resolved_at
       FROM qfield_pole_pon_cache WHERE project_id = $1 AND gpkg_version = $2`,
    [projectId, version]);
  if (cached) {
    return { available: true, gpkgVersion: version, resolvedAt: cached.resolved_at,
             designPons: cached.payload.designPons, poleToPon: cached.payload.poleToPon };
  }

  let resolved: ResolverOut;
  try {
    resolved = await runResolver(projectId);
  } catch (err) {
    log.error('qfc-ponmap', { message: err instanceof Error ? err.message : String(err) }, 'resolver failed');
    return UNAVAILABLE;
  }
  if (!resolved.available) return UNAVAILABLE;

  await query(
    `INSERT INTO qfield_pole_pon_cache (project_id, gpkg_version, payload)
       VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (project_id, gpkg_version)
       DO UPDATE SET payload = EXCLUDED.payload, resolved_at = now()`,
    [projectId, version, JSON.stringify({ designPons: resolved.designPons, poleToPon: resolved.poleToPon })]);

  return { available: true, gpkgVersion: version, resolvedAt: new Date().toISOString(),
           designPons: resolved.designPons, poleToPon: resolved.poleToPon };
}
