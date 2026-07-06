/**
 * Client-generated idempotency key for a snag verification-step photo upload.
 *
 * Minted at capture on the (offline-capable) resolve page and echoed on every
 * retry, so the server can dedupe an at-least-once offline-queue replay via the
 * partial unique index on `maintenance_attachments.client_upload_id`
 * (migration 438). Shared by the server handler (validation) and the client
 * (which mints it) — a pure util with no client/server-specific imports.
 */

/** Canonical UUID shape (any version). Mirrors the codebase-wide UUID_REGEX. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalise a client-supplied upload idempotency key. Returns the lowercased
 * UUID when well-formed, else `null`.
 *
 * A malformed or absent value must NOT reach the `uuid` column — Postgres would
 * raise `invalid input syntax for type uuid` and 500 the request, stranding the
 * technician's photo. `null` simply means "no idempotency guard" (legacy/online
 * behaviour): the partial unique index only constrains non-null keys, so a null
 * key always inserts, exactly as before this feature.
 */
export function normalizeClientUploadId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return UUID_REGEX.test(trimmed) ? trimmed.toLowerCase() : null;
}
