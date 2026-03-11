/**
 * GET /api/qfield/gpkg-layers?qfieldProjectId=<uuid>
 * Lists GPKG files available in MinIO for a QField project.
 * SSH to Velocity, runs `mc ls` inside the QField MinIO container.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import { promisify } from 'util';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const execAsync = promisify(exec);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GpkgFile {
  name: string;
  size: number;
  lastModified: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const userId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  const { qfieldProjectId } = req.query;

  if (!qfieldProjectId || typeof qfieldProjectId !== 'string') {
    return apiResponse.badRequest(res, 'qfieldProjectId query parameter is required');
  }

  if (!UUID_RE.test(qfieldProjectId)) {
    return apiResponse.badRequest(res, 'qfieldProjectId must be a valid UUID');
  }

  try {
    const minioPath = `local/qfieldcloud-prod/projects/${qfieldProjectId}/files/`;
    const command = `docker exec qfieldcloud-minio-1 mc ls --json ${minioPath}`;

    const { stdout, stderr } = await execAsync(command, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr && !stdout.trim()) {
      log.warn('gpkg-layers: mc ls stderr', { stderr: stderr.substring(0, 500) }, 'GpkgLayers');
    }

    const files: GpkgFile[] = [];
    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const key: string = (entry.key || '').replace(/\/$/, '');
        if (key.toLowerCase().endsWith('.gpkg')) {
          files.push({
            name: key,
            size: Number(entry.size) || 0,
            lastModified: entry.lastModified || '',
          });
        }
      } catch {
        log.error('GpkgLayersApi', 'Operation failed', { error });
        // Skip non-JSON lines (mc may emit warnings)
      }
    }

    log.info('gpkg-layers: listed files', { qfieldProjectId, count: files.length }, 'GpkgLayers');

    return apiResponse.success(res, { files });
  } catch (error) {
    log.error('gpkg-layers: failed', error instanceof Error ? { message: error.message } : { error }, 'GpkgLayers');

    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (msg.includes('timed out') || msg.includes('ConnectTimeout')) {
      return apiResponse.error(res, ErrorCode.GATEWAY_TIMEOUT, 'SSH connection to Velocity server timed out');
    }

    return apiResponse.internalError(res, error, 'Failed to list GPKG files');
  }
}

export default withAuth(handler);
