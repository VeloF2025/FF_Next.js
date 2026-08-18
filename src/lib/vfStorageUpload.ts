// src/lib/vfStorageUpload.ts
// Server-side upload of a base64 file to VF Storage. Shared low-level POST
// helper for every category-typed upload route; SiteCam's `uploadToVfStorage`
// and Fleet incident evidence's `uploadCategorizedFile` both sit on top of it.

import { isAllowedPhotoUrl } from './vfStoragePhotoUrl';

const VF_STORAGE_URL = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';

/** Strip any path components / unsafe chars from a client-supplied filename. */
export function safeFilename(name: unknown): string {
  const base = typeof name === 'string' ? name.split(/[/\\]/).pop() ?? '' : '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  return cleaned || `photo_${Date.now()}.jpg`;
}

interface VfStorageUploadJson {
  path?: string;
  url?: string;
}

/**
 * Low-level: POST a base64-decoded buffer to VF Storage's typed upload route
 * (`/upload/:category`; bare `/upload` 404s) and return its raw JSON
 * response. Shared by every category — SiteCam and Fleet incidents alike.
 */
async function postToVfStorage(
  category: string,
  filename: string,
  base64: string,
  contentType: string,
): Promise<VfStorageUploadJson> {
  const buffer = Buffer.from(base64, 'base64');
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: contentType }), filename);

  const resp = await fetch(`${VF_STORAGE_URL}/upload/${category}`, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`VF Storage upload failed: HTTP ${resp.status}`);
  return resp.json() as Promise<VfStorageUploadJson>;
}

/** Resolve VF Storage's JSON response to the app-safe same-origin proxy path (or the absolute URL it returned instead). */
function resolveUploadUrl(json: VfStorageUploadJson): string {
  if (json.path) return `/storage/${json.path}`;
  if (json.url) return json.url;
  throw new Error('VF Storage returned no path or url');
}

/**
 * Server-side upload of a base64 photo to VF Storage. Shared by the SiteCam
 * upload and escalate endpoints so escalation photos land in the same store
 * (and pass the isAllowedPhotoUrl guard) as regular submissions.
 *
 * SiteCam-only: fixed `sitecam/photos` category and `image/jpeg` content
 * type, no size/MIME allowlist, no returned-origin check. Existing callers
 * (`pages/api/sitecam/upload.ts`, `pages/api/sitecam/escalate.ts`) depend on
 * this exact behaviour in production — do not change it. Fleet incident
 * evidence uses the separate, stricter `uploadCategorizedFile` below instead
 * of widening this function's contract.
 */
export async function uploadToVfStorage(filename: string, base64: string): Promise<string> {
  const json = await postToVfStorage('sitecam/photos', filename, base64, 'image/jpeg');
  return resolveUploadUrl(json);
}

// ---------------------------------------------------------------------------
// Category-aware upload for callers beyond SiteCam (Fleet incident evidence).
// Adds caller-provided MIME/size allowlisting, base64 validation, and a
// returned-origin check that `uploadToVfStorage` above intentionally does
// not perform (see the note on that function).
// ---------------------------------------------------------------------------

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function isValidBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && BASE64_PATTERN.test(value);
}

export class VfStorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VfStorageValidationError';
  }
}

export class VfStorageOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VfStorageOriginError';
  }
}

export interface VfStorageUploadRequest {
  /** VF Storage upload route category, e.g. `fleet/incidents`. */
  category: string;
  /** Generated storage filename. Callers must not derive this from user input — see evidenceService's key generation. */
  storageFilename: string;
  base64: string;
  mimeType: string;
  allowedMimeTypes: readonly string[];
  maxBytes: number;
}

export interface VfStorageUploadResult {
  /** Same-origin `/storage/...` path, or an allow-listed absolute URL. */
  url: string;
  /** Raw VF Storage object key, kept for audit/orphan-cleanup references. */
  key: string;
}

function extractStorageKey(json: VfStorageUploadJson, url: string): string {
  if (json.path) return json.path;
  return url.startsWith('/storage/') ? url.slice('/storage/'.length) : url;
}

/**
 * Validated, category-aware upload used by callers beyond SiteCam (Fleet
 * incident evidence). Validates MIME/size/base64 *before* any network call —
 * so a rejected request never reaches VF Storage — and rejects a returned
 * URL that isn't an approved VF Storage origin.
 */
export async function uploadCategorizedFile(request: VfStorageUploadRequest): Promise<VfStorageUploadResult> {
  if (!request.allowedMimeTypes.includes(request.mimeType)) {
    throw new VfStorageValidationError(`MIME type "${request.mimeType}" is not allowed`);
  }
  if (!isValidBase64(request.base64)) {
    throw new VfStorageValidationError('File content is not valid base64');
  }
  const buffer = Buffer.from(request.base64, 'base64');
  if (buffer.length === 0) {
    throw new VfStorageValidationError('File content is empty');
  }
  if (buffer.length > request.maxBytes) {
    throw new VfStorageValidationError(`File exceeds the maximum size of ${request.maxBytes} bytes`);
  }

  const json = await postToVfStorage(request.category, request.storageFilename, request.base64, request.mimeType);
  const url = resolveUploadUrl(json);
  if (!isAllowedPhotoUrl(url)) {
    throw new VfStorageOriginError('VF Storage returned an unapproved origin');
  }
  return { url, key: extractStorageKey(json, url) };
}
