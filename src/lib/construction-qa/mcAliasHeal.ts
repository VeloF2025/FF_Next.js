/**
 * Self-heal for the `mc` `local` alias inside the qfieldcloud MinIO container.
 *
 * The construction-QA photo proxy reads objects via
 * `docker exec qfieldcloud-minio-1 mc cat 'local/qfieldcloud-prod/<key>'`. That
 * alias's credentials live in the container's ephemeral `MC_CONFIG_DIR=/tmp/.mc`,
 * so any container *recreate* (compose up/down, image bump, host reboot) drops
 * the access key and every `mc` call then fails auth — 404-ing all qfield photos
 * across all projects until the alias is re-applied. This module detects that
 * failure from `mc` stderr and re-applies the alias from the container's own
 * root creds.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { log } from '@/lib/logger';

const execFileAsync = promisify(execFile);

/** Docker container running MinIO + the `mc` client the photo proxy shells into. */
export const MINIO_CONTAINER = 'qfieldcloud-minio-1';

// Detects a broken/credential-less `local` alias from `mc` stderr. Verified
// against the real mc binary (minio RELEASE.2025) inside qfieldcloud-minio-1:
//
//   credless / wrong-creds / missing alias → "... Requested path `<p>` not found."
//   GOOD creds, object truly absent         → "... Object does not exist."
//   GOOD creds, bucket absent               → "... Bucket `<b>` does not exist."
//
// So `mc cat` (unlike `mc ls`, which says "Access Denied") signals an auth/alias
// failure with "Requested path ... not found" — and a genuine miss is "does not
// exist". Matching "Requested path" is therefore the correct heal trigger; the
// "does not exist" variants must NOT match, or every normal miss would heal+retry.
// The S3-style strings are kept as a defensive net for other mc versions/ops.
export const MC_AUTH_ERROR_RE =
  /Requested path .*not found|Access Denied|InvalidAccessKeyId|SignatureDoesNotMatch/i;

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
export function healMinioAlias(): Promise<void> {
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
