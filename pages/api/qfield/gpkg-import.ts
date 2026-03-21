/**
 * POST /api/qfield/gpkg-import
 * Body: { projectId, qfieldProjectId, selectedLayers, mode }
 * Imports GPKG data into FibreFlow database tables.
 *
 * Flow:
 * 1. Validate inputs, create qfield_import_jobs record
 * 2. SSH to Velocity, run read_gpkg.py (full data)
 * 3. For each selected layer, UNNEST bulk upsert into target table
 * 4. Update job record with results
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import { promisify } from 'util';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  importPoles,
  importJoints,
  importCableSpans,
  importDrops,
  importZoneBoundaries,
  importPonBoundaries,
  importPops,
} from '@/lib/qfield/gpkg-import-layers';

export const config = {
  api: {
    bodyParser: { sizeLimit: '50mb' },
    responseLimit: false,
  },
};

const execAsync = promisify(exec);
const getSql = () => neon(process.env.DATABASE_URL!);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_LAYERS = ['poles', 'joints', 'cable_spans', 'drops', 'zone_boundaries', 'pon_boundaries', 'pops'] as const;
type LayerName = typeof VALID_LAYERS[number];

type ImportMode = 'merge' | 'replace';

interface LayerResult {
  created: number;
  updated: number;
  errors: string[];
}

/** Accept any neon sql tagged-template function */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlFn = (strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const userId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  const { projectId, qfieldProjectId, selectedLayers, mode } = req.body;

  // --- Input validation ---
  if (!projectId || typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
    return apiResponse.badRequest(res, 'projectId must be a valid UUID');
  }
  if (!qfieldProjectId || typeof qfieldProjectId !== 'string' || !UUID_RE.test(qfieldProjectId)) {
    return apiResponse.badRequest(res, 'qfieldProjectId must be a valid UUID');
  }
  if (!Array.isArray(selectedLayers) || selectedLayers.length === 0) {
    return apiResponse.badRequest(res, 'selectedLayers must be a non-empty array');
  }
  const invalidLayers = selectedLayers.filter((l: string) => !VALID_LAYERS.includes(l as LayerName));
  if (invalidLayers.length > 0) {
    return apiResponse.badRequest(res, `Invalid layers: ${invalidLayers.join(', ')}. Valid: ${VALID_LAYERS.join(', ')}`);
  }
  if (mode !== 'merge' && mode !== 'replace') {
    return apiResponse.badRequest(res, 'mode must be "merge" or "replace"');
  }

  const sql = getSql();
  let jobId: string | null = null;

  try {
    // --- 1. Create import job record ---
    const jobRows = await sql`
      INSERT INTO qfield_import_jobs (project_id, qfield_project_id, status, started_at)
      VALUES (${projectId}, ${qfieldProjectId}, 'running', NOW())
      RETURNING id
    `;
    jobId = jobRows[0]?.id ?? null;
    if (!jobId) {
      return apiResponse.internalError(res, new Error('Failed to create import job'), 'Failed to create import job record');
    }

    // --- 2. Run read_gpkg.py locally (server runs on Velocity) ---
    const scriptDir = `${process.cwd()}/scripts/qfield-sync`;
    const command = `cd ${scriptDir} && python3 read_gpkg.py --project-id ${qfieldProjectId}`;

    log.info('gpkg-import: starting Python reader', { jobId, qfieldProjectId }, 'GpkgImport');

    const { stdout, stderr } = await execAsync(command, {
      timeout: 300000,
      maxBuffer: 200 * 1024 * 1024,
    });

    if (stderr) {
      log.warn('gpkg-import: Python stderr', { stderr: stderr.substring(0, 500) }, 'GpkgImport');
    }

    let parsedOutput: { layers?: Record<string, { count?: number; features?: any[] }> };
    try {
      parsedOutput = JSON.parse(stdout.trim());
    } catch {
      log.error('GpkgImportApi', 'Operation failed', { error });
      await updateJobStatus(sql, jobId, 'failed', {}, ['Failed to parse GPKG reader output']);
      return apiResponse.internalError(res, new Error('Invalid JSON from GPKG reader'), 'Failed to parse GPKG data');
    }

    const gpkgLayers = parsedOutput.layers || {};

    // --- 3. Import each selected layer ---
    const results: Record<string, LayerResult> = {};
    let totalCreated = 0;
    let totalUpdated = 0;
    const allErrors: string[] = [];

    for (const layer of selectedLayers as LayerName[]) {
      const layerData = gpkgLayers[layer];
      const features = layerData?.features;
      if (!features || !Array.isArray(features) || features.length === 0) {
        results[layer] = { created: 0, updated: 0, errors: [`No data found for layer: ${layer}`] };
        continue;
      }

      try {
        const result = await importLayer(sql, layer, features, projectId, mode);
        results[layer] = result;
        totalCreated += result.created;
        totalUpdated += result.updated;
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map(e => `${layer}: ${e}`));
        }
      } catch (layerError) {
        log.error('qfield-gpkg-import', { error: layerError instanceof Error ? layerError.message : String(layerError) });
        const errMsg = layerError instanceof Error ? layerError.message : 'Unknown error';
        results[layer] = { created: 0, updated: 0, errors: [errMsg] };
        allErrors.push(`${layer}: ${errMsg}`);
        log.error(`gpkg-import: layer ${layer} failed`, { error: errMsg }, 'GpkgImport');
      }
    }

    // --- 4. Update job record ---
    const finalStatus = allErrors.length > 0 ? 'completed_with_errors' : 'completed';
    await updateJobStatus(sql, jobId, finalStatus, results, allErrors, totalCreated, totalUpdated);

    log.info('gpkg-import: done', { jobId, totalCreated, totalUpdated, errors: allErrors.length }, 'GpkgImport');

    return apiResponse.success(res, {
      jobId,
      status: finalStatus,
      results,
      summary: { totalCreated, totalUpdated, errorCount: allErrors.length },
    });
  } catch (error) {
    log.error('gpkg-import: failed', error instanceof Error ? { message: error.message } : { error }, 'GpkgImport');

    if (jobId) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      await updateJobStatus(sql, jobId, 'failed', {}, [errMsg]).catch((e) => log.warn('DB operation failed (non-critical)', { error: e instanceof Error ? e.message : 'unknown' }, 'qfield'));
    }

    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (msg.includes('timed out') || msg.includes('ConnectTimeout')) {
      return apiResponse.error(res, ErrorCode.GATEWAY_TIMEOUT, 'SSH connection to Velocity server timed out');
    }

    return apiResponse.databaseError(res, error, 'GPKG import failed');
  }
}

/** Dispatch to the correct layer import function */
async function importLayer(
  sql: SqlFn,
  layer: LayerName,
  features: any[],
  projectId: string,
  mode: ImportMode
): Promise<LayerResult> {
  switch (layer) {
    case 'poles':          return importPoles(sql, features, projectId, mode);
    case 'joints':         return importJoints(sql, features, projectId, mode);
    case 'cable_spans':    return importCableSpans(sql, features, projectId, mode);
    case 'drops':          return importDrops(sql, features, projectId, mode);
    case 'zone_boundaries': return importZoneBoundaries(sql, features, projectId, mode);
    case 'pon_boundaries': return importPonBoundaries(sql, features, projectId, mode);
    case 'pops':           return importPops(sql, features, projectId, mode);
    default:
      return { created: 0, updated: 0, errors: [`Unknown layer: ${layer}`] };
  }
}

/** Update the qfield_import_jobs row with final status */
async function updateJobStatus(
  sql: SqlFn,
  jobId: string,
  status: string,
  layerCounts: Record<string, any>,
  errors: string[],
  created = 0,
  updated = 0,
) {
  await sql`
    UPDATE qfield_import_jobs
    SET status = ${status},
        layer_counts = ${JSON.stringify(layerCounts)},
        records_created = ${created},
        records_updated = ${updated},
        errors = ${JSON.stringify(errors)},
        completed_at = NOW()
    WHERE id = ${jobId}
  `;
}

export default withAuth(handler);
