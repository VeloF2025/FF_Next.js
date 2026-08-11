/**
 * Validation for H&S attachment uploads.
 *
 * The file checks are the training-certificate ones, imported rather than
 * re-implemented: an attachment is the same kind of artefact (a document or a
 * photograph of one) and a second copy of a magic-byte table is a second place
 * for it to drift.
 *
 * Those validators throw `TrainingCertificateError`. Rather than let a
 * training-named error surface from a medicals or permits upload, this module
 * translates at the boundary, so the rest of the attachment code only ever sees
 * `HsAttachmentError`.
 */

import {
  TrainingCertificateError,
  assertValidCertificateFile,
  requireUuid as requireCertificateUuid,
  type CertificateFileFacts,
} from './trainingCertificateValidation';
import { isAttachmentSurface, type AttachmentSurface } from './hsAttachmentPolicy';

/**
 * Codes the API layer maps to status codes:
 *   invalid_input -> 400
 *   not_found     -> 404
 *   unavailable   -> 503
 */
export type HsAttachmentErrorCode = 'invalid_input' | 'not_found' | 'unavailable';

export class HsAttachmentError extends Error {
  readonly code: HsAttachmentErrorCode;

  constructor(code: HsAttachmentErrorCode, message: string) {
    super(message);
    this.name = 'HsAttachmentError';
    this.code = code;
  }
}

function invalid(message: string): HsAttachmentError {
  return new HsAttachmentError('invalid_input', message);
}

/**
 * Run a shared validator, re-throwing its error as an attachment error.
 *
 * `invalid_input` and `not_found` are the only codes the shared validators
 * raise from this path; anything else would be a training-specific state an
 * attachment upload cannot reach, so it is surfaced as `invalid_input` rather
 * than silently mapped to something more forgiving.
 */
function translating<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof TrainingCertificateError) {
      const code: HsAttachmentErrorCode = error.code === 'not_found' ? 'not_found' : 'invalid_input';
      throw new HsAttachmentError(code, error.message);
    }
    throw error;
  }
}

/** Throws `invalid_input` unless the file is an accepted attachment. */
export function assertValidAttachmentFile(file: CertificateFileFacts): void {
  translating(() => assertValidCertificateFile(file));
}

/** Throws `invalid_input` unless the value is a UUID. */
export function requireUuid(value: unknown, field: string): string {
  return translating(() => requireCertificateUuid(value, field));
}

/**
 * Narrow a caller-supplied surface name.
 *
 * The only place an arbitrary string becomes an `AttachmentSurface`, and so the
 * only place an unknown surface is refused — everything downstream reads the
 * parent table and column from the policy table by that narrowed type, never
 * from the request.
 */
export function requireAttachmentSurface(value: unknown): AttachmentSurface {
  if (!isAttachmentSurface(value)) {
    throw invalid('That record type cannot hold attachments');
  }
  return value;
}

export { MAX_CERTIFICATE_FILE_SIZE as MAX_ATTACHMENT_FILE_SIZE } from './trainingCertificateValidation';
export type { CertificateFileFacts as AttachmentFileFacts };
