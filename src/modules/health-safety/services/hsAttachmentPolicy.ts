/**
 * Which H&S records can hold uploaded documents, and where their bytes live.
 *
 * Pure: no database, no storage, no request. The rule deciding where a medical
 * certificate is written is the rule deciding whether it is reachable over the
 * public internet, so it is testable on its own rather than only through an
 * upload — the same reason `checkinClearance.ts` is a pure function.
 *
 * Every surface here is private. `VF_PRIVATE_STORAGE_TYPE` is the prefix nginx
 * refuses (`location ~* ^/storage/hs-private/ { return 403; }`), so the bytes are
 * reachable only through `/api/health-safety/attachments/download`, which
 * re-checks permission on each request. Adding a surface whose storage type is
 * not this constant silently publishes it — hence `storageCategory` is derived
 * here rather than passed in by a caller.
 */

/**
 * The storage type all H&S attachments are written under.
 *
 * Must stay in step with docs/VPS/vf-fibreflow.nginx.conf, which is the only
 * thing making it private, and with scripts/verify-storage-privacy.sh, which
 * proves the rule is live before a deploy.
 */
export const VF_PRIVATE_STORAGE_TYPE = 'hs-private';

export type AttachmentSurface =
  | 'medical'
  | 'contractor_document'
  | 'library'
  | 'talk'
  | 'capa'
  | 'letter'
  | 'permit'
  | 'ppe_acknowledgement';

interface SurfaceConfig {
  /** Column on hs_attachments holding this surface's parent id. */
  readonly parentColumn: string;
  /** Table the parent id must exist in before an attachment may reference it. */
  readonly parentTable: string;
  /** Directory under the private storage type. */
  readonly storageCategory: string;
  /** Used in operator-facing messages; never interpolated into SQL. */
  readonly label: string;
}

/**
 * The parent column and table are interpolated into SQL, so they are read from
 * this table and never taken from a request. `assertAttachmentSurface` is the
 * only way a caller-supplied string becomes an `AttachmentSurface`, which makes
 * that the single place an unknown surface is refused.
 */
const SURFACES: Record<AttachmentSurface, SurfaceConfig> = {
  medical: {
    parentColumn: 'medical_id',
    parentTable: 'hs_worker_medicals',
    storageCategory: 'medicals',
    label: 'medical record',
  },
  contractor_document: {
    parentColumn: 'contractor_document_id',
    parentTable: 'hs_contractor_documents',
    storageCategory: 'contractor_documents',
    label: 'contractor document',
  },
  library: {
    parentColumn: 'library_id',
    parentTable: 'hs_safety_library',
    storageCategory: 'library',
    label: 'safety library entry',
  },
  talk: {
    parentColumn: 'talk_id',
    parentTable: 'hs_toolbox_talks',
    storageCategory: 'toolbox_talks',
    label: 'toolbox talk',
  },
  capa: {
    parentColumn: 'capa_id',
    parentTable: 'hs_corrective_actions',
    storageCategory: 'capa',
    label: 'corrective action',
  },
  letter: {
    parentColumn: 'letter_id',
    parentTable: 'hs_appointment_letters',
    storageCategory: 'appointment_letters',
    label: 'appointment letter',
  },
  permit: {
    parentColumn: 'permit_id',
    parentTable: 'hs_permits',
    storageCategory: 'permits',
    label: 'permit',
  },
  ppe_acknowledgement: {
    parentColumn: 'ppe_acknowledgement_id',
    parentTable: 'hs_ppe_acknowledgements',
    storageCategory: 'ppe_acknowledgements',
    label: 'PPE acknowledgement sheet',
  },
};

export const ATTACHMENT_SURFACES = Object.keys(SURFACES) as AttachmentSurface[];

export function isAttachmentSurface(value: unknown): value is AttachmentSurface {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SURFACES, value);
}

export function surfaceConfig(surface: AttachmentSurface): SurfaceConfig {
  return SURFACES[surface];
}

/**
 * The storage category a surface's bytes are written to.
 *
 * Always under `VF_PRIVATE_STORAGE_TYPE`; there is no public branch, because a
 * surface added without one would be published rather than merely misfiled.
 */
export function storageLocation(surface: AttachmentSurface): {
  type: string;
  category: string;
} {
  return {
    type: VF_PRIVATE_STORAGE_TYPE,
    category: SURFACES[surface].storageCategory,
  };
}

/**
 * True when a stored path sits under the private prefix.
 *
 * The download route checks this before streaming: a row whose `file_path`
 * points somewhere else predates this design or was written by something that
 * bypassed it, and serving it would quietly hand out a file that nginx is not
 * guarding.
 */
export function isPrivateStoragePath(filePath: string): boolean {
  if (!filePath.startsWith(`${VF_PRIVATE_STORAGE_TYPE}/`)) return false;
  // A prefix check alone is satisfied by `hs-private/../staff/documents/x`,
  // which the storage service would resolve straight back out of the guarded
  // directory. Only VF Storage's own response currently reaches this column,
  // so that is not reachable today — but this is the function the download
  // route trusts before fetching, and a guard that can be walked out of is not
  // one. Backslash is rejected too: it is a path separator to some resolvers
  // and never legitimate in a storage key.
  if (filePath.includes('..') || filePath.includes('\\')) return false;
  // Control characters (NUL through US, and DEL) would change what the fetch
  // resolves to, or split the request line outright.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(filePath)) return false;
  return true;
}
