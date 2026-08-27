/**
 * Stale-chunk auto-recovery.
 *
 * After a deploy the old bundle's hashed chunk files are gone, so users with
 * an open tab hit ChunkLoadError / failed dynamic import on their next
 * navigation. Policy: force ONE full reload per (buildId, error) so the tab
 * picks up the new bundle. If the same failure recurs after the reload it is
 * not a stale-deploy problem, so we fall through to the normal error UI.
 */
import { log } from '@/lib/logger';

const STORAGE_PREFIX = 'ff-chunk-reload:';

const CHUNK_ERROR_PATTERNS = [
  /Loading chunk [^\s]+ failed/i,
  /Loading CSS chunk/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
];

/** True for the error shapes Next.js produces when a hashed chunk is gone. */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const candidate = err as { name?: unknown; message?: unknown };
  if (candidate.name === 'ChunkLoadError') return true;
  const message =
    typeof err === 'string'
      ? err
      : typeof candidate.message === 'string'
        ? candidate.message
        : '';
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function reloadGuardKey(err: unknown): string {
  const nextData = (
    window as { __NEXT_DATA__?: { buildId?: string } }
  ).__NEXT_DATA__;
  const buildId = nextData?.buildId ?? 'no-build-id';
  const message =
    typeof err === 'string'
      ? err
      : ((err as { message?: unknown })?.message as string | undefined) ?? '';
  return `${STORAGE_PREFIX}${buildId}:${message.slice(0, 120)}`;
}

/**
 * If `err` is a chunk-load failure that has not yet triggered a reload this
 * session (per guard key), force a full reload and return true. Returns false
 * (caller shows its normal error UI) for non-chunk errors, repeat failures,
 * and when sessionStorage is unavailable (no guard → reloading risks a loop).
 */
export function reloadOnceForChunkError(err: unknown): boolean {
  if (typeof window === 'undefined' || !isChunkLoadError(err)) return false;
  const key = reloadGuardKey(err);
  try {
    if (window.sessionStorage.getItem(key) !== null) return false;
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch (storageErr) {
    log.warn(
      'sessionStorage unavailable — not reloading (cannot guard against a loop)',
      { data: { error: String(storageErr) } },
      'chunkReload'
    );
    return false;
  }
  log.warn(
    'Stale chunk after deploy — forcing one-time reload',
    { data: { key } },
    'chunkReload'
  );
  window.location.reload();
  return true;
}

/**
 * Install window-level listeners for chunk failures that never reach a React
 * error boundary (script tag onerror, unhandled dynamic-import rejections).
 * Returns a cleanup function.
 */
export function installChunkErrorReload(): () => void {
  const onError = (event: ErrorEvent) => {
    if (reloadOnceForChunkError(event.error ?? event.message)) {
      event.preventDefault();
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (reloadOnceForChunkError(event.reason)) {
      event.preventDefault();
    }
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
