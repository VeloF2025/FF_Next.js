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

/**
 * `mc` stderr that means the `local` alias can't authenticate — the client
 * credentials are missing or wrong, NOT that the object is absent. The alias
 * config lives in the container's ephemeral `MC_CONFIG_DIR=/tmp/.mc`, so a
 * container *recreate* (compose up, image bump, host reboot) drops the alias's
 * access key and every `mc cat` then fails this way, 404-ing all qfield photos
 * across all projects until the alias is re-set. Self-heal below re-applies it.
 */
// Precise: an unauthenticated alias only. Must NOT match "object does not
// exist" / "specified key does not exist" (a genuinely absent object) — those
// are normal not-founds and must not trigger a heal+retry on every miss.
const MC_AUTH_ERROR_RE =
  /Access Denied|InvalidAccessKeyId|Access Key Id you provided does not exist|SignatureDoesNotMatch/i;

// Re-apply the `local` alias from the minio container's OWN root creds
// (MINIO_ROOT_USER/PASSWORD). Expanded by the container's shell, so the secret
// never enters this process, the argv, or any log line. The command is a fixed
// string — no interpolation of caller data — so there is no injection surface.
const MC_SET_ALIAS_CMD =
  'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"';
const HEAL_COOLDOWN_MS = 10_000;
let healInFlight: Promise<void> | null = null;
let lastHealAt = 0;

/**
 * Re-apply the `local` mc alias inside the minio container. Deduped (one heal
 * covers every concurrent auth failure) and cooled down (a successful set that
 * still leaves reads failing means the creds are genuinely wrong — don't spin
 * re-healing on every photo). Best-effort: failures are logged, never thrown,
 * so the caller just falls through to a normal 404.
 */
function healMinioAlias(): Promise<void> {
  if (healInFlight) return healInFlight;
  if (Date.now() - lastHealAt < HEAL_COOLDOWN_MS) return Promise.resolve();
  const run = (async () => {
    try {
      await execFileAsync('docker', ['exec', MINIO_CONTAINER, 'sh', '-c', MC_SET_ALIAS_CMD], {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
      });
      log.warn('minio-photo-stream: re-applied `local` mc alias after auth failure', {
        module: 'minio-photo-stream',
      });
    } catch (err) {
      log.error('minio-photo-stream: mc alias self-heal failed', {
        module: 'minio-photo-stream',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      lastHealAt = Date.now();
    }
  })();
  healInFlight = run;
  run.finally(() => {
    if (healInFlight === run) healInFlight = null;
  });
  return run;
}

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

// Internal: a single `mc cat` attempt can additionally report an auth failure,
// which the public streamMinioObject() converts into a self-heal + one retry
// before collapsing to 'not-found'.
type MinioAttemptOutcome = MinioOutcome | 'auth-error';

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
function streamMinioAttempt(objectPath: string, res: NextApiResponse): Promise<MinioAttemptOutcome> {
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

    const settle = (outcome: MinioAttemptOutcome) => {
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
      // Missing/invalid `local` alias creds — recoverable. Report 'auth-error'
      // so the caller can self-heal the alias and retry, instead of masking a
      // fixable outage as a plain 404. (Object-absent errors don't match this.)
      if (MC_AUTH_ERROR_RE.test(stderr)) {
        settle('auth-error');
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

/**
 * Pipe one MinIO object to the response, self-healing the `local` mc alias on an
 * authentication failure. A first attempt that reports 'auth-error' has written
 * nothing to `res` (streaming never began), so it is safe to re-apply the alias
 * and retry the same response once. A still-failing retry collapses to
 * 'not-found' — the public contract stays 'served' | 'not-found' | 'unavailable'.
 */
export async function streamMinioObject(objectPath: string, res: NextApiResponse): Promise<MinioOutcome> {
  const first = await streamMinioAttempt(objectPath, res);
  if (first !== 'auth-error') return first;

  await healMinioAlias();
  const retry = await streamMinioAttempt(objectPath, res);
  return retry === 'auth-error' ? 'not-found' : retry;
}

async function listLatestVersion(objectPath: string): Promise<string | null> {
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
}

/**
 * Resolve an unversioned MinIO key to its latest version, or null if there isn't
 * one. Self-heals the `local` alias on an auth failure (same ephemeral-config
 * cause as streamMinioObject) so unversioned keys still resolve after a minio
 * container recreate.
 */
export async function resolveLatestVersion(objectPath: string): Promise<string | null> {
  try {
    return await listLatestVersion(objectPath);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    if (!MC_AUTH_ERROR_RE.test(stderr)) return null;
    await healMinioAlias();
    try {
      return await listLatestVersion(objectPath);
    } catch {
      return null;
    }
  }
}
