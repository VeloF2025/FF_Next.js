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
/**
 * Byte signatures for the types this uploader accepts.
 *
 * The declared mimeType is attacker-controlled and load-bearing twice over: it passes the
 * allowlist check and it picks the stored file extension. Checking the string alone lets a
 * caller store arbitrary content under a .png key. Since evidence exists so that lower-
 * privileged users can attach files for higher-privileged reviewers to open, a mismatch
 * here is a privilege-escalation path, not a tidiness issue.
 *
 * Fail-closed: a type in the caller's allowlist with no signature registered is rejected,
 * because an unverifiable type is exactly what this check exists to stop.
 */
const MIME_SIGNATURES: Readonly<Record<string, readonly (readonly number[])[]>> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]],
};

/**
 * How far into the file a signature may legally start.
 *
 * JPEG and PNG are fixed at byte 0 by their specs. PDF is not: ISO 32000 has readers locate
 * `%PDF-` within the first 1024 bytes, because real generators and scanners do prepend a
 * preamble (a UTF-8 BOM, PDF/A//document-management wrapper bytes). Insisting on offset 0
 * would reject spec-legal evidence, and fail-closed means the manager gets no way around it.
 */
/** Bytes from the start of the file within which the WHOLE signature must fall. */
const SIGNATURE_SEARCH_WINDOW: Readonly<Record<string, number>> = { 'application/pdf': 1024 };

/** The MIME types with a registered signature. Exported so callers can assert their own
 *  allowlist is a subset — an allowed type with no signature fails closed on every upload. */
export const SIGNATURE_REGISTERED_TYPES: readonly string[] = Object.keys(MIME_SIGNATURES);

export function contentMatchesMimeType(buffer: Buffer, mimeType: string): boolean {
  const signatures = MIME_SIGNATURES[mimeType];
  if (!signatures) return false;
  return signatures.some((signature) => {
    // Default scan window is the signature itself, i.e. byte 0 only. `window` counts bytes the
    // signature must fit inside, so the last legal start is window - signature.length: with a
    // 1024-byte window a 5-byte %PDF- may start at 1019, not 1024.
    const window = SIGNATURE_SEARCH_WINDOW[mimeType] ?? signature.length;
    const lastStart = Math.min(window - signature.length, buffer.length - signature.length);
    for (let start = 0; start <= lastStart; start += 1) {
      if (signature.every((byte, index) => buffer[start + index] === byte)) return true;
    }
    return false;
  });
}

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
  if (!contentMatchesMimeType(buffer, request.mimeType)) {
    throw new VfStorageValidationError(`File content does not match the declared type "${request.mimeType}"`);
  }

  const json = await postToVfStorage(request.category, request.storageFilename, request.base64, request.mimeType);
  const url = resolveUploadUrl(json);
  if (!isAllowedPhotoUrl(url)) {
    throw new VfStorageOriginError('VF Storage returned an unapproved origin');
  }
  return { url, key: extractStorageKey(json, url) };
}
