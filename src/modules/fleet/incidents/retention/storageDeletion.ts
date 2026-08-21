/**
 * Deletion of ONE Fleet-incident attachment from VF Storage.
 *
 * The bound on what this can reach is a SHAPE, not a denylist. A stored value
 * is normalised to a key and must then match exactly
 * `fleet/incidents/<one safe filename>`; anything else is refused before a
 * request is made. That makes traversal, encoded traversal, wildcards, query
 * strings, sibling Fleet categories, and every other module's files
 * (H&S, staff documents, pole photos, maintenance evidence) unreachable by
 * construction rather than by enumeration — which matters because a denylist
 * is exactly what a `.` segment or a trailing byte defeats.
 *
 * `already_absent` is a success. Retry after a database failure re-runs the
 * storage stage, and by then the object is legitimately gone; treating that as
 * an error would strand the item forever. Every OTHER failure throws, so the
 * caller keeps the database evidence for a later attempt — losing the audit
 * trail while the file survives is the one outcome this pipeline must never
 * produce.
 */
import { ALLOWED_PHOTO_HOSTS } from '@/lib/vfStoragePhotoUrl';

const VF_STORAGE_URL = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';

/** The one storage category Fleet incident evidence is uploaded to (`evidenceService.FLEET_EVIDENCE_CATEGORY`). */
const PROGRAMME_KEY_PATTERN = /^fleet\/incidents\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PROXY_PREFIX = '/storage/';
/**
 * Bounds ONE request, and nothing more. A run deletes many objects across many
 * items, so this does not bound the run — `retentionService`'s RUN_BUDGET_MS is
 * what stops a slow night from holding the advisory lock indefinitely. What
 * this prevents is a single hung connection stalling forever.
 */
const DELETE_TIMEOUT_MS = 15_000;

export type StorageDeletionOutcome = 'deleted' | 'already_absent';

export class StorageDeletionValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'StorageDeletionValidationError'; }
}

export class StorageDeletionError extends Error {
  constructor(message: string) { super(message); this.name = 'StorageDeletionError'; }
}

function stripProxyPrefix(path: string): string {
  return path.startsWith(PROXY_PREFIX) ? path.slice(PROXY_PREFIX.length) : path;
}

/**
 * Normalises a stored `storage_key` or `storage_url` to a raw VF Storage key,
 * refusing anything that is not a single approved programme object.
 */
export function resolveProgrammeStorageKey(storagePath: string): string {
  if (typeof storagePath !== 'string' || storagePath.length === 0) {
    throw new StorageDeletionValidationError('A storage path is required');
  }
  let candidate = storagePath;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new StorageDeletionValidationError('Storage path is not a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new StorageDeletionValidationError('Storage URL must be http(s)');
    }
    // Exact host membership — never a suffix match, which
    // `vf.fibreflow.app.evil.example.com` would satisfy.
    if (!ALLOWED_PHOTO_HOSTS.has(parsed.host)) {
      throw new StorageDeletionValidationError('Storage URL is not an approved VF Storage origin');
    }
    if (parsed.search || parsed.hash) {
      throw new StorageDeletionValidationError('Storage URL must carry no query or fragment');
    }
    candidate = parsed.pathname;
  }
  const key = stripProxyPrefix(candidate);
  if (!PROGRAMME_KEY_PATTERN.test(key)) {
    throw new StorageDeletionValidationError(
      'Retention may only delete Fleet incident attachments under fleet/incidents/',
    );
  }
  return key;
}

/** Deletes one approved programme object. Throws on any failure other than "already gone". */
export async function deleteIncidentStorageObject(storagePath: string): Promise<StorageDeletionOutcome> {
  const key = resolveProgrammeStorageKey(storagePath);
  const response = await fetch(`${VF_STORAGE_URL}/delete/${key}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
  });
  if (response.ok) return 'deleted';
  if (response.status === 404) return 'already_absent';
  throw new StorageDeletionError(`VF Storage delete failed: HTTP ${response.status}`);
}
