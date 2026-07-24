/**
 * MinIO access for QFieldCloud storage via `mc` inside the container.
 * Only reachable on velo (docker). Read-only: `mc ls` only.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from '@/lib/logger';

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
    const keys = new Set<string>();
    const VERSION_SUFFIX = /\/v\d{14}-[a-f0-9]+$/i;
    let skipped = 0;
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // mc ls line: "[date time tz] size STANDARD <relpath>/<version>"
      // relpath is relative to the queried DCIM/ prefix, e.g. "<file>.jpg/v20260708123941-a8b6a554"
      const rel = trimmed.split(/\s+/).slice(5).join(' ');
      if (!rel || !VERSION_SUFFIX.test(rel)) {
        skipped++;
        continue;
      }
      const withoutVersion = rel.replace(VERSION_SUFFIX, '');
      keys.add(`DCIM/${withoutVersion}`);
    }
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
