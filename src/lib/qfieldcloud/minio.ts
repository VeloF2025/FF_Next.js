/**
 * MinIO access for QFieldCloud storage via `mc` inside the container.
 * Only reachable on velo (docker). Read-only: `mc ls` only.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from '@/lib/logger';
import { parseDcimKeys } from './parseMcLs';

const execAsync = promisify(exec);
const BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';
export class MinioUnavailableError extends Error {}

const SHELL_UNSAFE = /[;`$|&\\(){}[\]!#'\n\r]/;

function assertSafe(path: string): void {
  if (SHELL_UNSAFE.test(path)) throw new Error('Invalid characters in object path');
}

/** Every logical DCIM key present under a project (version suffix stripped). */
export async function listDcimKeys(projectId: string): Promise<Set<string>> {
  assertSafe(projectId);
  const prefix = `local/${BUCKET}/projects/${projectId}/files/DCIM/`;
  const cmd = `docker exec qfieldcloud-minio-1 mc ls --recursive '${prefix}' 2>&1`;
  try {
    const { stdout } = await execAsync(cmd, { maxBuffer: 64 * 1024 * 1024 });
    const { keys, skipped } = parseDcimKeys(stdout);
    if (skipped > 0) {
      log.debug('qfc-minio', { skipped, projectId }, 'skipped non-version DCIM lines');
    }
    return keys;
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: string; message?: string };
    const msg = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`;
    if (/Cannot connect to the Docker daemon|No such container|command not found|permission denied/.test(msg)) {
      throw new MinioUnavailableError('MinIO not reachable (off-velo)');
    }
    log.error('qfc-minio', { message: msg.slice(0, 200) }, 'listDcimKeys failed');
    throw err;
  }
}
