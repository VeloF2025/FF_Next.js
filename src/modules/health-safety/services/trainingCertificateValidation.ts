/**
 * Pure validation and date arithmetic for training-certificate submissions.
 *
 * Kept free of database and storage access so the upload route can reject a bad
 * request before it writes a byte to VF Storage — a rejection after the upload
 * would need compensating, and the cheapest compensation is not uploading.
 */

/**
 * Codes the API layer maps to status codes:
 *   invalid_input        -> 400
 *   unknown_staff        -> 404
 *   duplicate_certificate-> 409
 *   conflict             -> 409
 *   not_found            -> 404
 *   immutable            -> 409
 */
export type TrainingCertificateErrorCode =
  | 'invalid_input'
  | 'unknown_staff'
  | 'duplicate_certificate'
  | 'conflict'
  | 'not_found'
  | 'immutable';

export class TrainingCertificateError extends Error {
  readonly code: TrainingCertificateErrorCode;

  constructor(code: TrainingCertificateErrorCode, message: string) {
    super(message);
    this.name = 'TrainingCertificateError';
    this.code = code;
  }
}

function invalid(message: string): TrainingCertificateError {
  return new TrainingCertificateError('invalid_input', message);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const MAX_CERTIFICATE_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Extension -> accepted MIME types. Narrower than the generic staff-document
 * allow-list: a certificate is a document or a photograph of one, so
 * spreadsheets and GIFs are not accepted here.
 */
export const ALLOWED_CERTIFICATE_TYPES: Record<string, readonly string[]> = {
  '.pdf': ['application/pdf'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((b, i) => buffer[i] === b);
}

/**
 * Confirm the bytes match the declared type.
 *
 * A caller controls both the filename and the Content-Type header, so those
 * agreeing with each other proves nothing; only the leading bytes do. DOC and
 * DOCX are containers (OLE compound file / ZIP) whose signatures are shared
 * with other formats, so the signature is accepted only when the extension and
 * MIME independently agree it is that format.
 */
export function certificateBytesMatchType(head: Buffer, extension: string): boolean {
  switch (extension) {
    case '.pdf':
      return startsWith(head, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case '.jpg':
    case '.jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case '.png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case '.doc':
      return startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // OLE2
    case '.docx':
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]) // ZIP local file header
        || startsWith(head, [0x50, 0x4b, 0x05, 0x06])
        || startsWith(head, [0x50, 0x4b, 0x07, 0x08]);
    default:
      return false;
  }
}

export interface CertificateFileFacts {
  fileName: string;
  mimeType: string | null;
  size: number;
  head: Buffer;
}

/** Throws `invalid_input` unless the file is an accepted certificate. */
export function assertValidCertificateFile(file: CertificateFileFacts): void {
  if (!file.size) throw invalid('The certificate file is empty');
  if (file.size > MAX_CERTIFICATE_FILE_SIZE) {
    throw invalid('The certificate file exceeds the 10 MB limit');
  }

  const extension = extensionOf(file.fileName);
  const allowedMimes = ALLOWED_CERTIFICATE_TYPES[extension];
  if (!allowedMimes) {
    throw invalid('Upload a PDF, JPG, PNG, DOC or DOCX certificate');
  }
  if (!file.mimeType || !allowedMimes.includes(file.mimeType)) {
    throw invalid('The file type does not match its extension');
  }
  if (!certificateBytesMatchType(file.head, extension)) {
    throw invalid('The file contents do not match its extension');
  }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * Normalise the training-type ids out of a multipart body, which may present a
 * repeated field, a single value, or a JSON array depending on the client.
 *
 * A repeated id is rejected, not de-duplicated: two identical selections mean
 * the caller believes it is submitting two competencies, and quietly creating
 * one would under-record the certificate.
 */
export function normalizeTrainingTypeIds(raw: unknown): string[] {
  let values: unknown[];

  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw invalid('Training types were not a readable list');
      }
      if (!Array.isArray(parsed)) throw invalid('Training types were not a readable list');
      values = parsed;
    } else {
      values = trimmed.includes(',') ? trimmed.split(',') : [trimmed];
    }
  } else if (raw === undefined || raw === null) {
    values = [];
  } else {
    throw invalid('Training types were not a readable list');
  }

  const ids = values.map((v) => {
    if (typeof v !== 'string') throw invalid('Training types were not a readable list');
    return v.trim();
  });

  if (ids.some((id) => id === '')) throw invalid('Select at least one training type');
  if (ids.length === 0) throw invalid('Select at least one training type');
  if (new Set(ids).size !== ids.length) {
    throw invalid('The same training type was selected more than once');
  }
  return ids;
}

// The layout Postgres accepts for a uuid column — deliberately NOT the stricter
// RFC 4122 version/variant form, which would reject ids the database itself
// considers valid. The job here is "can this be a uuid, and is it safe as a
// filename component", not "which UUID version is it".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Require a UUID.
 *
 * Used for ids that reach a storage filename or a uuid column before the
 * database can reject them: `uploadStaffDocument` prefixes the object name with
 * the staff id, and an unvalidated string would be shaped like a path segment
 * long before Postgres ever saw it. It also turns what would be a 22P02 raised
 * mid-transaction — surfacing as a 500 after a storage write — into a 400.
 */
export function requireUuid(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!UUID.test(text)) throw invalid(`${field} is not a valid identifier`);
  return text;
}

/** Trim a required text field, rejecting a blank one. */
export function requireText(value: unknown, field: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw invalid(`${field} is required`);
  if (text.length > maxLength) throw invalid(`${field} is too long`);
  return text;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a calendar date as UTC.
 *
 * Rejects a value that Date silently rolls over (2026-02-30 becomes 2 March),
 * because a rolled-over expiry is a wrong date that looks like a right one.
 */
export function parseCalendarDate(value: string, field: string): Date {
  if (!ISO_DATE.test(value)) throw invalid(`${field} must be a calendar date`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw invalid(`${field} must be a calendar date`);
  if (formatCalendarDate(date) !== value) throw invalid(`${field} is not a real date`);
  return date;
}

export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Required ISO calendar date, returned normalised. */
export function requireCalendarDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${field} is required`);
  return formatCalendarDate(parseCalendarDate(value.trim(), field));
}

/** Optional ISO calendar date; blank and absent both mean "not supplied". */
export function optionalCalendarDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) return null;
  return formatCalendarDate(parseCalendarDate(value.trim(), field));
}

/**
 * Expiry for one competency: the date printed on the certificate if there is
 * one, otherwise the catalogue cadence applied to the completion date, otherwise
 * no expiry at all. Nothing is invented for a competency with no cadence.
 *
 * Month arithmetic clamps to the last valid day of the target month, so
 * 31 August + 6 months is 28/29 February rather than rolling into March.
 */
export function resolveTrainingExpiry(
  completedDate: string,
  explicitExpiryDate: string | null,
  validityMonths: number | null
): string | null {
  const completed = parseCalendarDate(completedDate, 'Completion date');

  if (explicitExpiryDate) {
    const expiry = parseCalendarDate(explicitExpiryDate, 'Expiry date');
    if (expiry.getTime() < completed.getTime()) {
      throw invalid('The expiry date cannot be before the completion date');
    }
    return formatCalendarDate(expiry);
  }

  if (validityMonths === null || validityMonths === undefined) return null;
  if (!Number.isInteger(validityMonths) || validityMonths <= 0) {
    throw invalid('The training type has an unusable validity period');
  }

  const year = completed.getUTCFullYear();
  const month = completed.getUTCMonth();
  const day = completed.getUTCDate();
  const targetMonthEnd = new Date(Date.UTC(year, month + validityMonths + 1, 0));
  const clampedDay = Math.min(day, targetMonthEnd.getUTCDate());

  return formatCalendarDate(new Date(Date.UTC(year, month + validityMonths, clampedDay)));
}
