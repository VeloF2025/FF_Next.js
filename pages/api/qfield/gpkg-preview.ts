/**
 * POST /api/qfield/gpkg-preview
 * Body: { qfieldProjectId: string }
 * Returns layer counts and sample fields from GPKG files via the Python reader.
 * SSH to Velocity, runs `read_gpkg.py --preview`.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import { promisify } from 'util';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const execAsync = promisify(exec);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LayerPreview {
  count: number;
  sample_fields: string[];
}

interface PreviewResult {
  layers: Record<string, LayerPreview>;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const userId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  const { qfieldProjectId } = req.body;

  if (!qfieldProjectId || typeof qfieldProjectId !== 'string') {
    return apiResponse.badRequest(res, 'qfieldProjectId is required in request body');
  }

  if (!UUID_RE.test(qfieldProjectId)) {
    return apiResponse.badRequest(res, 'qfieldProjectId must be a valid UUID');
  }

  try {
    // Script runs on Velocity where the Next.js server also runs.
    // Use process.cwd() to find the script relative to the deploy dir.
    const scriptDir = `${process.cwd()}/scripts/qfield-sync`;
    const command = `cd ${scriptDir} && python3 read_gpkg.py --project-id ${qfieldProjectId} --preview`;

    const { stdout, stderr } = await execAsync(command, {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr) {
      log.warn('gpkg-preview: stderr from Python', { stderr: stderr.substring(0, 500) }, 'GpkgPreview');
    }

    let parsed: PreviewResult;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      log.error('gpkg-preview: invalid JSON from Python', { stdout: stdout.substring(0, 1000) }, 'GpkgPreview');
      return apiResponse.internalError(res, new Error('Invalid JSON from GPKG reader'), 'Failed to parse GPKG preview data');
    }

    log.info('gpkg-preview: success', {
      qfieldProjectId,
      layerCount: Object.keys(parsed.layers || {}).length,
    }, 'GpkgPreview');

    return apiResponse.success(res, parsed);
  } catch (error) {
    log.error('gpkg-preview: failed', error instanceof Error ? { message: error.message } : { error }, 'GpkgPreview');

    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (msg.includes('timed out') || msg.includes('ConnectTimeout')) {
      return apiResponse.error(res, ErrorCode.GATEWAY_TIMEOUT, 'SSH connection to Velocity server timed out');
    }

    return apiResponse.internalError(res, error, 'Failed to preview GPKG data');
  }
}

export default withAuth(handler);
