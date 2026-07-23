/**
 * Streaming access to construction-QA photos held in MinIO.
 *
 * Photos are piped straight to the response. An earlier implementation ran
 * `mc cat` through exec() with `maxBuffer: 50MB`, holding every in-flight image
 * fully in memory; under gallery load that drove the production heap past 12GB
 * and caused multi-hundred-millisecond GC pauses across all routes.
 *
 * Both docker invocations use an argv array (spawn / execFile) rather than an
 * interpolated shell string, so a storage key can never be read as shell syntax.
 * `mc` diagnostics are kept on stderr so they cannot be mistaken for image bytes.
 */

import type { NextApiResponse } from 'next';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { log } from '@/lib/logger';

const execFileAsync = promisify(execFile);

const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';
const MINIO_CONTAINER = 'qfieldcloud-minio-1';

/** Extension → Content-Type for every photo backend in this module's callers. */
export const PHOTO_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
};

/**
 * Bytes to inspect before deciding whether stdout carries object data or an
 * `mc` diagnostic. No image is smaller than this, so a shorter body is never
 * a photo.
 */
const MC_PROBE_BYTES = 4;

export type MinioOutcome = 'served' | 'not-found' | 'unavailable';

function contentTypeFor(objectPath: string): string {
  const ext = objectPath.split('.').pop()?.toLowerCase() || 'jpg';
  return PHOTO_CONTENT_TYPES[ext] || 'image/jpeg';
}

/**
 * Pipe one MinIO object to the response.
 *
 * Resolves 'served' once streaming has started (the response is then owned by
 * this function), 'not-found' if the caller should try another path, or
 * 'unavailable' if the docker/MinIO backend cannot be reached at all.
 *
 * No Content-Length is set: the object size is not known before streaming, so
 * the response is chunked. If the child dies mid-stream the response is
 * destroyed rather than ended, so a truncated body surfaces as a broken
 * connection instead of a silently short 200.
 */
export function streamMinioObject(objectPath: string, res: NextApiResponse): Promise<MinioOutcome> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['exec', MINIO_CONTAINER, 'mc', 'cat', `local/${MINIO_BUCKET}/${objectPath}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let probe: Buffer = Buffer.alloc(0);
    let streaming = false;
    let settled = false;
    let stderr = '';

    const kill = () => { if (!child.killed) child.kill('SIGKILL'); };

    // Kill the child if the client hangs up. This stays attached for the whole
    // life of the stream — `mc cat` would otherwise block forever writing to a
    // pipe nobody drains once pipe() unpipes on disconnect.
    const onClientGone = () => kill();
    res.on('close', onClientGone);
    const detach = () => res.off('close', onClientGone);

    const settle = (outcome: MinioOutcome) => {
      if (settled) return;
      settled = true;
      // On 'served' the disconnect guard must outlive this resolve — it is
      // detached when the child exits (see the 'close' handler below).
      if (outcome !== 'served') detach();
      resolve(outcome);
    };

    /** Abandon a partially-sent response so the client sees a broken body, not a short one. */
    const abortResponse = () => {
      if (!res.writableEnded && !res.destroyed) res.destroy();
    };

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2048) stderr += chunk.toString('utf-8');
    });

    const beginStream = () => {
      streaming = true;
      res.setHeader('Content-Type', contentTypeFor(objectPath));
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.write(probe);
      child.stdout.pipe(res);
      settle('served');
    };

    const onProbe = (chunk: Buffer) => {
      probe = Buffer.concat([probe, chunk]);
      if (probe.length < MC_PROBE_BYTES) return;
      child.stdout.removeListener('data', onProbe);
      child.stdout.pause();
      if (probe.subarray(0, 3).toString('ascii') === 'mc:') {
        kill();
        settle('not-found');
        return;
      }
      beginStream();
    };

    child.stdout.on('data', onProbe);

    // Deliberately no 'end' handler: stdout ends *before* 'close', so settling
    // here would short-circuit the stderr inspection below and report a downed
    // docker daemon as a plain 404. An object that ends below the probe
    // threshold is resolved by the 'close' handler instead.

    // pipe() does not forward source errors, so without this an stdout error
    // would surface as an unhandled 'error' event and take down the process.
    child.stdout.on('error', (err: Error) => {
      log.error('minio-photo-stream: stdout error', { module: 'minio-photo-stream', error: err.message, path: objectPath });
      kill();
      if (streaming) { abortResponse(); detach(); return; }
      settle('not-found');
    });

    child.on('error', (err: Error) => {
      log.error('minio-photo-stream: docker spawn failed', { module: 'minio-photo-stream', error: err.message, path: objectPath });
      if (streaming) { abortResponse(); detach(); return; }
      settle('unavailable');
    });

    child.on('close', (code: number | null) => {
      if (streaming) {
        // Streaming already began, so the outcome is decided; just clean up and
        // make sure a mid-stream failure isn't served as a complete photo.
        detach();
        if (code !== 0) abortResponse();
        return;
      }
      if (settled) return;
      if (/Cannot connect to the Docker daemon|No such container/.test(stderr)) {
        settle('unavailable');
        return;
      }
      if (stderr.trim()) {
        log.error('minio-photo-stream: mc cat failed', {
          module: 'minio-photo-stream', error: stderr.trim().slice(0, 300), path: objectPath,
        });
      }
      settle('not-found');
    });
  });
}

/** Resolve an unversioned MinIO key to its latest version, or null if there isn't one. */
export async function resolveLatestVersion(objectPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['exec', MINIO_CONTAINER, 'mc', 'ls', `local/${MINIO_BUCKET}/${objectPath}/`],
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    );

    if (!stdout || !stdout.trim()) return null;

    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;

    // Last line holds the latest version: "... v20260310120500-7bc5005f"
    const parts = lines[lines.length - 1]!.trim().split(/\s+/);
    const version = parts[parts.length - 1]!.replace(/\/$/, '');
    if (!version.startsWith('v2')) return null;

    return `${objectPath}/${version}`;
  } catch {
    return null;
  }
}
